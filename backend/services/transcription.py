"""
Transcription service - handles Deepgram real-time transcription.
"""
import eventlet
from deepgram.core.events import EventType
from adapters.deepgram_adapter import create_client, is_available
from services.sessions import TRANSCRIPTS, get_transcript
from mongo_adapter import upsert_session, upsert_segment


def run_deepgram(session_id, socketio):
    """
    Run Deepgram real-time transcription for a session.
    Should be called via socketio.start_background_task().
    """
    try:
        # Initialize Deepgram client
        deepgram = create_client()
        
        print(f"[DG] Created DeepgramClient for session {session_id}")
        
        # Get transcript session data
        transcript_sess = get_transcript(session_id)
        if not transcript_sess:
            print(f"[DG] No transcript session found for {session_id}")
            return
        
        audio_queue = transcript_sess.get("audio_queue", [])
        
        # Use context manager with interim_results=True, punctuate, smart_format
        with deepgram.listen.v1.connect(
            model="nova-2",
            interim_results=True,
            punctuate=True,
            smart_format=True,
        ) as connection:
            print(f"[DG] Connection opened for session {session_id}")

            # Handle transcript events
            def on_message(message):
                if not TRANSCRIPTS.get(session_id, {}).get("running"):
                    return
                
                msg_type = getattr(message, "type", "Unknown")
                print(f"[DG] Received message type: {msg_type}")
                
                if hasattr(message, 'channel') and message.channel:
                    alternatives = message.channel.alternatives
                    if alternatives and len(alternatives) > 0:
                        alt = alternatives[0]
                        transcript = alt.transcript
                        
                        if transcript:
                            is_final = getattr(message, 'is_final', False)
                            
                            # --- Word-level patch with timestamps ---
                            segment_id = TRANSCRIPTS.get(session_id, {}).get("current_segment_id", "seg_0")
                            dg_words = getattr(alternatives[0], "words", None) or []

                            words_payload = []
                            for idx, w in enumerate(dg_words):
                                text = (
                                    getattr(w, "punctuated_word", None)
                                    or getattr(w, "word", None)
                                    or ""
                                )
                                t0 = getattr(w, "start", None)
                                t1 = getattr(w, "end", None)
                                conf = getattr(w, "confidence", None)

                                if text:
                                    words_payload.append({
                                        "wid": f"{session_id}:{segment_id}:{idx}",
                                        "text": text,
                                        "t0": float(t0) if t0 is not None else None,
                                        "t1": float(t1) if t1 is not None else None,
                                        "confidence": float(conf) if conf is not None else None,
                                    })

                            if words_payload:
                                patch = {
                                    "sessionId": session_id,
                                    "segmentId": segment_id,
                                    "isFinal": bool(is_final),
                                    "words": words_payload,
                                }
                                eventlet.spawn(lambda p=patch: socketio.emit("transcript_patch", p))
                                print(f"[DG] WORDS: {len(words_payload)} words extracted")
                            
                            # --- Transcript partial/final events ---
                            if is_final:
                                current_final = TRANSCRIPTS[session_id].get("final", "")
                                if current_final:
                                    TRANSCRIPTS[session_id]["final"] = current_final + " " + transcript
                                else:
                                    TRANSCRIPTS[session_id]["final"] = transcript
                                
                                TRANSCRIPTS[session_id]["partial"] = ""
                                
                                print(f"[DG] FINAL: {transcript}")
                                eventlet.spawn(lambda: socketio.emit(
                                    "transcript_partial",
                                    {"sessionId": session_id, "text": TRANSCRIPTS[session_id]["final"]},
                                ))
                                
                                # MongoDB: persist FINAL segment with words
                                try:
                                    upsert_segment(session_id, segment_id, True, words_payload)
                                except Exception as e:
                                    print(f"[MONGO] segment upsert failed: {e}")
                                
                                # Advance segment after a final utterance
                                TRANSCRIPTS[session_id]["seg_seq"] += 1
                                TRANSCRIPTS[session_id]["current_segment_id"] = f"seg_{TRANSCRIPTS[session_id]['seg_seq']}"
                            else:
                                TRANSCRIPTS[session_id]["partial"] = transcript
                                full_text = TRANSCRIPTS[session_id].get("final", "")
                                if full_text:
                                    display_text = full_text + " " + transcript
                                else:
                                    display_text = transcript
                                    
                                print(f"[DG] PARTIAL: {transcript}")
                                eventlet.spawn(lambda: socketio.emit(
                                    "transcript_partial",
                                    {"sessionId": session_id, "text": display_text},
                                ))

            def on_error(error):
                print(f"[DG] Error: {error}")

            # Register event handlers
            connection.on(EventType.MESSAGE, on_message)
            connection.on(EventType.ERROR, on_error)

            # Start the listening in a greenlet
            def listen_greenlet():
                try:
                    connection.start_listening()
                except Exception as e:
                    print(f"[DG] Listen error: {e}")

            eventlet.spawn(listen_greenlet)

            print(f"[DG] Starting audio send loop for session {session_id}")

            # Send audio from the queue
            chunks_sent = 0
            while TRANSCRIPTS.get(session_id, {}).get("running", False):
                if audio_queue:
                    chunk = audio_queue.pop(0)
                    try:
                        connection.send_media(chunk)
                        chunks_sent += 1
                        if chunks_sent % 10 == 0:
                            print(f"[DG] Sent {chunks_sent} chunks to Deepgram")
                    except Exception as e:
                        print(f"[DG] Error sending audio: {e}")
                else:
                    eventlet.sleep(0.05)

                print(f"[DG] Audio send loop ended for session {session_id}, sent {chunks_sent} total chunks")

    except Exception as e:
        print(f"[DG] Exception in Deepgram greenlet: {e}")
        import traceback
        traceback.print_exc()
        if session_id in TRANSCRIPTS:
            TRANSCRIPTS[session_id]["running"] = False


def finalize_transcription(session_id, socketio):
    """
    Finalize transcription - stop the session and emit final transcript.
    """
    sess = get_transcript(session_id)

    print(f"[TX] finalize_transcription session={session_id}")

    if not sess:
        socketio.emit("transcript_final", {"sessionId": session_id, "text": ""})
        return

    # Give a small delay for final chunks to be processed
    eventlet.sleep(0.5)
    
    # Stop the transcription
    sess["running"] = False

    final_text = sess.get("final", "") or sess.get("partial", "")
    sess["final"] = final_text

    print(f"[TX] Emitting transcript_final: {final_text}")
    
    socketio.emit(
        "transcript_final",
        {"sessionId": session_id, "text": final_text},
    )
    
    # MongoDB: persist finalized session with final text
    try:
        upsert_session(session_id, status="finalized", finalText=final_text)
    except Exception as e:
        print(f"[MONGO] finalize upsert failed: {e}")
