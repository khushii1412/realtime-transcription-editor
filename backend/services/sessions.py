"""
Session and transcript in-memory stores.
"""

# sessionId -> { mime, chunks, audio_bytes, closed }
SESSIONS = {}

# sessionId -> { partial, final, sid, audio_queue, running, seg_seq, current_segment_id }
TRANSCRIPTS = {}


def get_session(session_id):
    """Get session data."""
    return SESSIONS.get(session_id)


def create_session(session_id, mime=None):
    """Create a new session."""
    SESSIONS[session_id] = {
        "mime": mime,
        "chunks": [],
        "closed": False,
    }
    return SESSIONS[session_id]


def get_transcript(session_id):
    """Get transcript data."""
    return TRANSCRIPTS.get(session_id)


def create_transcript(session_id, sid):
    """Create a new transcript session."""
    TRANSCRIPTS[session_id] = {
        "partial": "",
        "final": "",
        "sid": sid,
        "audio_queue": [],
        "running": True,
        "seg_seq": 0,
        "current_segment_id": "seg_0",
    }
    return TRANSCRIPTS[session_id]


def stop_all_transcripts():
    """Stop all running transcripts (called on disconnect)."""
    for session_id, sess in list(TRANSCRIPTS.items()):
        if sess.get("running"):
            sess["running"] = False
