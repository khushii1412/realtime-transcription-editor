"""
Real-time Transcription Editor - Backend Entrypoint

This is the main entry point that wires together all modules.
"""
import eventlet
eventlet.monkey_patch()

from flask import Flask
from flask_socketio import SocketIO
from flask_cors import CORS

# Import route and handler registrations
from api.routes import register_routes
from ws.handlers import register_socket_handlers

# Create Flask app
app = Flask(__name__)
app.config["SECRET_KEY"] = "dev-secret"

# Enable CORS for all routes (allows frontend to fetch from different port)
CORS(app)

# Create Socket.IO instance
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# Register routes and handlers
register_routes(app)
register_socket_handlers(socketio)

# Main entry point
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=8000, debug=True, use_reloader=False)
