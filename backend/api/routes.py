"""
HTTP API routes.
"""
import re
from flask import jsonify, Response, request
from services.recording import get_audio_data
from mongo_adapter import list_sessions, get_session_by_id, list_segments


def register_routes(app):
    """Register all HTTP routes on the Flask app."""
    
    @app.get("/health")
    def health():
        return jsonify({"status": "ok"})

    @app.get("/sessions/<session_id>/audio")
    def get_audio(session_id):
        data, mime = get_audio_data(session_id)
        
        if data is None:
            return jsonify({"error": "not found"}), 404

        total = len(data)
        range_header = request.headers.get("Range")

        # Always advertise seeking support
        if not range_header:
            resp = Response(data, mimetype=mime)
            resp.headers["Accept-Ranges"] = "bytes"
            resp.headers["Content-Length"] = str(total)
            resp.headers["Cache-Control"] = "no-store"
            return resp

        m = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if not m:
            resp = Response(data, mimetype=mime)
            resp.headers["Accept-Ranges"] = "bytes"
            resp.headers["Content-Length"] = str(total)
            resp.headers["Cache-Control"] = "no-store"
            return resp

        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else total - 1
        end = min(end, total - 1)

        if start >= total or start > end:
            return Response(status=416)

        chunk = data[start:end + 1]
        resp = Response(chunk, status=206, mimetype=mime)
        resp.headers["Content-Range"] = f"bytes {start}-{end}/{total}"
        resp.headers["Accept-Ranges"] = "bytes"
        resp.headers["Content-Length"] = str(end - start + 1)
        resp.headers["Cache-Control"] = "no-store"
        return resp

    # --------------------------------
    # MongoDB Read APIs
    # --------------------------------
    
    @app.get("/api/sessions")
    def api_list_sessions():
        """List all sessions, latest first."""
        try:
            items = list_sessions(limit=50)
            return jsonify({"sessions": items})
        except Exception as e:
            return jsonify({"error": str(e), "sessions": []}), 500

    @app.get("/api/sessions/<session_id>")
    def api_get_session(session_id):
        """Get a single session with its segments and words."""
        try:
            sess = get_session_by_id(session_id)
            if not sess:
                return jsonify({"error": "not found"}), 404

            segs = list_segments(session_id)

            return jsonify({
                "session": sess,
                "segments": segs,
                # Convenience fields (frontend friendly)
                "finalText": sess.get("finalText", ""),
                "slateContent": sess.get("slateContent"),  # Slate JSON for rich text formatting
                "durationMs": sess.get("durationMs"),  # Recording duration in milliseconds
                "audioPath": sess.get("audioPath"),
                "mime": sess.get("mime", "audio/webm"),
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.put("/api/sessions/<session_id>/content")
    def api_save_session_content(session_id):
        """Save formatted content (Slate JSON) and duration for a session."""
        from mongo_adapter import upsert_session
        try:
            data = request.get_json()
            slate_content = data.get("slateContent")
            final_text = data.get("finalText", "")
            duration_ms = data.get("durationMs")
            
            if slate_content is not None:
                update_fields = {"slateContent": slate_content, "finalText": final_text}
                if duration_ms is not None:
                    update_fields["durationMs"] = duration_ms
                upsert_session(session_id, **update_fields)
                return jsonify({"ok": True})
            else:
                return jsonify({"error": "slateContent required"}), 400
        except Exception as e:
            return jsonify({"error": str(e)}), 500
