"""
Socket.IO event handlers.
"""
import base64
from flask import request
from flask_socketio import emit

from adapters.deepgram_adapter import is_available
from services.sessions import (
    SESSIONS, 
    TRANSCRIPTS, 
    get_session, 
    get_transcript,
    create_transcript,
    stop_all_transcripts,
)
from services.recording import append_audio_chunk, finalize_audio
from services.transcription import run_deepgram, finalize_transcription
from mongo_adapter import upsert_session


def register_socket_handlers(socketio):
    """Register all Socket.IO event handlers."""
    
    @socketio.on("connect")
    def on_connect():
        print("[WS] client connected")

    @socketio.on("disconnect")
    def on_disconnect():
        print("[WS] client disconnected")
        stop_all_transcripts()

    @socketio.on("audio_chunk")
    def on_audio_chunk(data):
        session_id = data["sessionId"]
        seq = data["seq"]
        mime = data.get("mime")
        b64 = data.get("bytes", "")

        raw = base64.b64decode(b64) if b64 else b""

        # Append to recording
        sess = append_audio_chunk(session_id, raw, mime)

        if sess["closed"]:
            emit("audio_ack", {"seq": seq})
            return

        # Queue audio for Deepgram if transcription is active
        transcript_sess = get_transcript(session_id)
        if transcript_sess and transcript_sess.get("running"):
            audio_queue = transcript_sess.get("audio_queue")
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

        print(f"[STOP] stop_recording received session={session_id}")

        sess = get_session(session_id)
        if not sess:
            emit("recording_saved", {"ok": False, "error": "unknown session"})
            return

        audio_bytes, filename, filepath = finalize_audio(session_id)

        # MongoDB: record audio stop
        try:
            upsert_session(
                session_id,
                status="stopped",
                audioPath=filepath,
                mime=SESSIONS.get(session_id, {}).get("mime"),
                chunkCount=len(SESSIONS.get(session_id, {}).get("chunks", [])),
            )
        except Exception as e:
            print(f"[MONGO] stop upsert failed: {e}")

        emit(
            "recording_saved",
            {
                "ok": True,
                "sessionId": session_id,
                "size": len(audio_bytes) if audio_bytes else 0,
                "filename": filename,
            },
        )

    @socketio.on("start_transcription")
    def on_start_transcription(data):
        session_id = data["sessionId"]
        sid = request.sid

        print(f"[TX] start_transcription session={session_id} sid={sid}")

        if not is_available():
            print("[TX] No Deepgram API key - using fallback mode")
            emit("transcript_partial", {"sessionId": session_id, "text": "[No Deepgram API key configured]"})
            return

        # Create transcript session
        create_transcript(session_id, sid)

        # MongoDB: record session start
        try:
            upsert_session(session_id, status="recording")
        except Exception as e:
            print(f"[MONGO] session upsert failed: {e}")

        # Start Deepgram in background
        socketio.start_background_task(run_deepgram, session_id, socketio)

    @socketio.on("finalize_transcription")
    def on_finalize_transcription(data):
        session_id = data["sessionId"]
        finalize_transcription(session_id, socketio)
