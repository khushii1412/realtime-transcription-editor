"""
MongoDB adapter for session and segment persistence.
Best-effort: if Mongo is down, app continues normally.
"""
import os
from datetime import datetime
from pymongo import MongoClient, ASCENDING

_client = None
_db = None
_indexes_done = False


def get_db():
    """Get MongoDB database connection. Returns None if not available."""
    global _client, _db, _indexes_done
    
    if _db is not None:
        return _db

    uri = os.getenv("MONGODB_URI")
    dbname = os.getenv("MONGODB_DB", "realtime_transcription")
    if not uri:
        return None

    try:
        _client = MongoClient(uri, serverSelectionTimeoutMS=3000)
        _client.admin.command("ping")
        _db = _client[dbname]

        if not _indexes_done:
            _db.sessions.create_index([("sessionId", ASCENDING)], unique=True)
            _db.segments.create_index([("sessionId", ASCENDING), ("segmentId", ASCENDING)], unique=True)
            _indexes_done = True

        return _db
    except Exception as e:
        print("[MONGO] not ready:", e)
        _db = None
        return None


def upsert_session(session_id, **fields):
    """Upsert a session document. Best-effort, silently fails if Mongo unavailable."""
    db = get_db()
    if db is None:
        return
    now = datetime.utcnow()
    db.sessions.update_one(
        {"sessionId": session_id},
        {
            "$setOnInsert": {"sessionId": session_id, "createdAt": now},
            "$set": {**fields, "updatedAt": now},
        },
        upsert=True,
    )


def upsert_segment(session_id, segment_id, is_final, words):
    """Upsert a segment document with words. Only call for FINAL segments."""
    db = get_db()
    if db is None:
        return
    now = datetime.utcnow()
    db.segments.update_one(
        {"sessionId": session_id, "segmentId": segment_id},
        {
            "$setOnInsert": {"sessionId": session_id, "segmentId": segment_id, "createdAt": now},
            "$set": {"isFinal": bool(is_final), "words": words, "updatedAt": now},
        },
        upsert=True,
    )


# --------------------------------
# Read functions for API endpoints
# --------------------------------

def list_sessions(limit=50):
    """List all sessions, latest first."""
    db = get_db()
    if db is None:
        return []
    docs = list(db.sessions.find({}, {"_id": 0}).sort("updatedAt", -1).limit(int(limit)))
    return docs


def get_session_by_id(session_id):
    """Get a single session by ID."""
    db = get_db()
    if db is None:
        return None
    return db.sessions.find_one({"sessionId": session_id}, {"_id": 0})


def list_segments(session_id):
    """List all segments for a session, ordered numerically (seg_0, seg_1, ...)."""
    db = get_db()
    if db is None:
        return []
    segs = list(db.segments.find({"sessionId": session_id}, {"_id": 0}))
    
    # Sort seg_0, seg_1, ... numerically
    def seg_num(s):
        sid = s.get("segmentId", "seg_0")
        try:
            return int(sid.split("_")[1])
        except:
            return 0
    segs.sort(key=seg_num)
    return segs
