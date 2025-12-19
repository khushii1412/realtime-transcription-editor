"""
Recording service - handles audio chunk storage and file saving.
"""
import os
from datetime import datetime
from config import RECORDINGS_DIR
from services.sessions import SESSIONS, get_session, create_session


def append_audio_chunk(session_id, chunk_bytes, mime=None):
    """
    Append an audio chunk to a session.
    Returns the session data.
    """
    if session_id not in SESSIONS:
        create_session(session_id, mime)

    sess = SESSIONS[session_id]
    
    if sess["closed"]:
        return sess

    if mime:
        sess["mime"] = mime

    sess["chunks"].append(chunk_bytes)
    return sess


def finalize_audio(session_id):
    """
    Finalize audio recording - join chunks and save to file.
    Returns (audio_bytes, filename, filepath) or (None, None, None) if session not found.
    """
    sess = get_session(session_id)
    
    if not sess:
        return None, None, None

    sess["closed"] = True
    audio_bytes = b"".join(sess["chunks"])
    sess["audio_bytes"] = audio_bytes

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{session_id}_{ts}.webm"
    filepath = os.path.join(RECORDINGS_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(audio_bytes)

    print(f"[STOP] saved file -> {filepath} bytes={len(audio_bytes)}")

    return audio_bytes, filename, filepath


def get_audio_data(session_id):
    """
    Get audio data for playback.
    Returns (data, mime) or (None, None) if not found.
    """
    sess = get_session(session_id)
    
    if sess and "audio_bytes" in sess:
        return sess["audio_bytes"], sess.get("mime", "audio/webm")
    
    # Fallback: find recording file starting with session_id
    for fname in os.listdir(RECORDINGS_DIR):
        if fname.startswith(session_id):
            path = os.path.join(RECORDINGS_DIR, fname)
            with open(path, "rb") as f:
                data = f.read()
            return data, "audio/webm"
    
    return None, None
