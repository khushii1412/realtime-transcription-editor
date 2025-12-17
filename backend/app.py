import os
import base64
import time
from datetime import datetime

import eventlet
eventlet.monkey_patch()

from flask import Flask, jsonify, Response, request
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv

# Load environment variables first
load_dotenv()

# Deepgram imports
from deepgram import DeepgramClient
from deepgram.core.events import EventType

app = Flask(__name__)
app.config["SECRET_KEY"] = "dev-secret"

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# --------------------------------
# Paths
# --------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RECORDINGS_DIR = os.path.join(BASE_DIR, "recordings")
os.makedirs(RECORDINGS_DIR, exist_ok=True)

print(f"[BOOT] BASE_DIR={BASE_DIR}")
print(f"[BOOT] RECORDINGS_DIR={RECORDINGS_DIR}")

# --------------------------------
# Deepgram setup
# --------------------------------
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")
if not DEEPGRAM_API_KEY:
    print("[WARN] DEEPGRAM_API_KEY not found in .env - transcription will not work!")
else:
    print(f"[BOOT] DEEPGRAM_API_KEY loaded (length={len(DEEPGRAM_API_KEY)})")

# --------------------------------
# In-memory stores
# --------------------------------
# sessionId -> { mime, chunks, audio_bytes, closed }
SESSIONS = {}

# sessionId -> { partial, final, sid, audio_queue, running }
TRANSCRIPTS = {}

# --------------------------------
# HTTP routes
# --------------------------------
@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/sessions/<session_id>/audio")
def get_audio(session_id):
    # Prefer in-memory playback
    sess = SESSIONS.get(session_id)
    if sess and "audio_bytes" in sess:
        return Response(sess["audio_bytes"], mimetype=sess.get("mime", "audio/webm"))

    # Fallback: find file starting with session_id
    for fname in os.listdir(RECORDINGS_DIR):
        if fname.startswith(session_id):
            path = os.path.join(RECORDINGS_DIR, fname)
            return Response(open(path, "rb").read(), mimetype="audio/webm")

    return jsonify({"error": "not found"}), 404


# --------------------------------
# Socket events
# --------------------------------
@socketio.on("connect")
def on_connect():
    print("[WS] client connected")


@socketio.on("disconnect")
def on_disconnect():
    print("[WS] client disconnected")
    # Cleanup any active transcription sessions
    for session_id, sess in list(TRANSCRIPTS.items()):
        if sess.get("running"):
            sess["running"] = False


@socketio.on("audio_chunk")
def on_audio_chunk(data):
    session_id = data["sessionId"]
    seq = data["seq"]
    mime = data.get("mime")
    b64 = data.get("bytes", "")

    raw = base64.b64decode(b64) if b64 else b""

    if session_id not in SESSIONS:
        SESSIONS[session_id] = {
            "mime": mime,
            "chunks": [],
            "closed": False,
        }

    if SESSIONS[session_id]["closed"]:
        emit("audio_ack", {"seq": seq})
        return

    if mime:
        SESSIONS[session_id]["mime"] = mime

    SESSIONS[session_id]["chunks"].append(raw)

    # Queue audio for Deepgram if transcription is active
    if session_id in TRANSCRIPTS and TRANSCRIPTS[session_id].get("running"):
        audio_queue = TRANSCRIPTS[session_id].get("audio_queue")
        if audio_queue is not None and raw:
            audio_queue.append(raw)
            print(f"[DG] Queued chunk seq={seq} for Deepgram")

    print(
        f"[AUDIO] session={session_id} seq={seq} bytes={len(raw)} "
        f"total_chunks={len(SESSIONS[session_id]['chunks'])}"
    )

    emit("audio_ack", {"seq": seq})


@socketio.on("stop_recording")
def on_stop_recording(data):
    session_id = data["sessionId"]
    sess = SESSIONS.get(session_id)

    print(f"[STOP] stop_recording received session={session_id}")

    if not sess:
        emit("recording_saved", {"ok": False, "error": "unknown session"})
        return

    sess["closed"] = True
    audio_bytes = b"".join(sess["chunks"])
    sess["audio_bytes"] = audio_bytes

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{session_id}_{ts}.webm"
    filepath = os.path.join(RECORDINGS_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(audio_bytes)

    print(f"[STOP] saved file -> {filepath} bytes={len(audio_bytes)}")

    emit(
        "recording_saved",
        {
            "ok": True,
            "sessionId": session_id,
            "size": len(audio_bytes),
            "filename": filename,
        },
    )


# --------------------------------
# Deepgram Real-time Transcription
# --------------------------------
@socketio.on("start_transcription")
def on_start_transcription(data):
    session_id = data["sessionId"]
    sid = request.sid

    print(f"[TX] start_transcription session={session_id} sid={sid}")

    if not DEEPGRAM_API_KEY:
        print("[TX] No Deepgram API key - using fallback mode")
        emit("transcript_partial", {"sessionId": session_id, "text": "[No Deepgram API key configured]"})
        return

    # Audio queue for this session
    audio_queue = []

    TRANSCRIPTS[session_id] = {
        "partial": "",
        "final": "",
        "sid": sid,
        "audio_queue": audio_queue,
        "running": True,
    }

    def run_deepgram():
        try:
            # Initialize Deepgram client - reads from DEEPGRAM_API_KEY env var
            deepgram = DeepgramClient()
            
            print(f"[DG] Created DeepgramClient for session {session_id}")
            
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
                            transcript = alternatives[0].transcript
                            if transcript:
                                is_final = getattr(message, 'is_final', False)
                                
                                if is_final:
                                    current_final = TRANSCRIPTS[session_id].get("final", "")
                                    if current_final:
                                        TRANSCRIPTS[session_id]["final"] = current_final + " " + transcript
                                    else:
                                        TRANSCRIPTS[session_id]["final"] = transcript
                                    
                                    TRANSCRIPTS[session_id]["partial"] = ""
                                    
                                    print(f"[DG] FINAL: {transcript}")
                                    # Emit to all clients - use eventlet.spawn to ensure it runs in eventlet context
                                    eventlet.spawn(lambda: socketio.emit(
                                        "transcript_partial",
                                        {"sessionId": session_id, "text": TRANSCRIPTS[session_id]["final"]},
                                    ))
                                else:
                                    TRANSCRIPTS[session_id]["partial"] = transcript
                                    full_text = TRANSCRIPTS[session_id].get("final", "")
                                    if full_text:
                                        display_text = full_text + " " + transcript
                                    else:
                                        display_text = transcript
                                        
                                    print(f"[DG] PARTIAL: {transcript}")
                                    # Emit to all clients - use eventlet.spawn to ensure it runs in eventlet context
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
                        eventlet.sleep(0.05)  # Use eventlet.sleep instead of time.sleep

                print(f"[DG] Audio send loop ended for session {session_id}, sent {chunks_sent} total chunks")

        except Exception as e:
            print(f"[DG] Exception in Deepgram greenlet: {e}")
            import traceback
            traceback.print_exc()
            if session_id in TRANSCRIPTS:
                TRANSCRIPTS[session_id]["running"] = False

    # Start Deepgram using socketio's background task (works with eventlet)
    socketio.start_background_task(run_deepgram)


@socketio.on("finalize_transcription")
def on_finalize_transcription(data):
    session_id = data["sessionId"]
    sess = TRANSCRIPTS.get(session_id)

    print(f"[TX] finalize_transcription session={session_id}")

    if not sess:
        emit("transcript_final", {"sessionId": session_id, "text": ""})
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


# --------------------------------
# Main
# --------------------------------
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=8000, debug=True, use_reloader=False)
