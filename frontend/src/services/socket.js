/**
 * Socket.IO service - creates and manages the socket connection.
 */
import { io } from "socket.io-client";

// Use environment variable for backend URL, fallback to localhost for development
const BACKEND_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

/**
 * Create a new Socket.IO connection to the backend.
 * @returns {Socket} Socket.IO client instance
 */
export function createSocket() {
    return io(BACKEND_URL, {
        transports: ["websocket", "polling"],
    });
}

export { BACKEND_URL };
export default createSocket;

