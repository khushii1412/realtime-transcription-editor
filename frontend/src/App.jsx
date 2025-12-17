import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

export default function App() {
  const socketRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);

  const sessionIdRef = useRef(null);
  const seqRef = useRef(0);

  const [status, setStatus] = useState("disconnected");
  const [recStatus, setRecStatus] = useState("idle");

  const [audioUrl, setAudioUrl] = useState(null);
  const [partialText, setPartialText] = useState("");
  const [finalText, setFinalText] = useState("");

  // Log to browser console only
  const log = (msg) => {
    console.log(`[Transcription] ${new Date().toLocaleTimeString()} ${msg}`);
  };

  // ---------------------------
  // Socket setup
  // ---------------------------
  useEffect(() => {
    const socket = io("http://localhost:8000", {
      // Allow fallback to polling for debugging
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("connected");
      log("Connected to backend");
    });

    socket.on("disconnect", () => {
      setStatus("disconnected");
      log("Disconnected");
    });

    socket.on("audio_ack", (data) => {
      log(`audio_ack seq=${data.seq}`);
    });

    socket.on("recording_saved", (data) => {
      if (!data.ok) {
        log(`recording_saved error: ${data.error}`);
        return;
      }

      const url = `http://localhost:8000/sessions/${data.sessionId}/audio`;
      setAudioUrl(url);
      log(`recording saved size=${data.size}`);
    });

    socket.on("transcript_partial", (data) => {
      console.log("[SOCKET] transcript_partial received:", data);
      if (data.sessionId !== sessionIdRef.current) {
        console.log("[SOCKET] Ignoring - wrong sessionId. Expected:", sessionIdRef.current, "Got:", data.sessionId);
        return;
      }
      setPartialText(data.text);
      log(`transcript_partial: ${data.text}`);
    });

    socket.on("transcript_final", (data) => {
      console.log("[SOCKET] transcript_final received:", data);
      if (data.sessionId !== sessionIdRef.current) {
        console.log("[SOCKET] Ignoring - wrong sessionId. Expected:", sessionIdRef.current, "Got:", data.sessionId);
        return;
      }
      setFinalText(data.text);
      setPartialText("");
      log(`transcript_final: ${data.text}`);
    });

    socket.on("connect_error", (e) => {
      log(`connect_error: ${e.message}`);
    });

    // Debug: catch all events
    socket.onAny((eventName, ...args) => {
      console.log("[SOCKET] Event:", eventName, args);
    });

    return () => socket.disconnect();
  }, []);

  // ---------------------------
  // Helpers
  // ---------------------------
  const toBase64 = (arrayBuffer) => {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  };

  // ---------------------------
  // Start recording
  // ---------------------------
  const startRecording = async () => {
    try {
      log("startRecording clicked");

      if (status !== "connected") {
        log("backend not connected");
        return;
      }

      sessionIdRef.current = `sess_${Date.now()}`;
      seqRef.current = 0;

      setAudioUrl(null);
      setPartialText("");
      setFinalText("");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? { mimeType: "audio/webm;codecs=opus" }
        : {};

      const mr = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = async (evt) => {
        if (!evt.data || evt.data.size === 0) return;

        const seq = seqRef.current++;
        const buf = await evt.data.arrayBuffer();

        socketRef.current.emit("audio_chunk", {
          sessionId: sessionIdRef.current,
          seq,
          mime: evt.data.type,
          bytes: toBase64(buf),
        });

        log(`sent chunk seq=${seq} size=${evt.data.size}`);
      };

      // FIX #2: Start transcription FIRST (before MediaRecorder)
      // So Deepgram receives chunk 0 with the WebM header
      socketRef.current.emit("start_transcription", {
        sessionId: sessionIdRef.current,
      });
      log("start_transcription sent");

      // Small delay to ensure backend has set up the connection
      await new Promise(resolve => setTimeout(resolve, 100));

      // THEN start MediaRecorder
      mr.start(250);
      setRecStatus("recording");
      log("Recording started");

    } catch (err) {
      log(`mic error: ${err.message}`);
      setRecStatus("idle");
    }
  };

  // ---------------------------
  // Stop recording
  // ---------------------------
  const stopRecording = () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    const mr = mediaRecorderRef.current;

    // FIX #3: Stop MediaRecorder first, THEN finalize transcription
    if (mr && mr.state !== "inactive") {
      mr.addEventListener(
        "stop",
        () => {
          // Wait a bit for final chunks to be processed
          setTimeout(() => {
            socketRef.current.emit("stop_recording", { sessionId });
            socketRef.current.emit("finalize_transcription", { sessionId });
            log("stop_recording + finalize_transcription sent");
          }, 200);
        },
        { once: true }
      );

      // Flush last chunk if supported
      try { mr.requestData(); } catch { }
      mr.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    mediaRecorderRef.current = null;
    setRecStatus("idle");
    log("Recording stopped");
  };

  // ---------------------------
  // UI
  // ---------------------------
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <h1 className="header__title">Live Transcription Studio</h1>
        <p className="header__subtitle">
          Record audio and get real-time transcriptions powered by Deepgram
        </p>
      </header>

      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-item">
          <span className="status-item__label">Server</span>
          <span className="status-item__value">
            <span
              className={`status-dot ${status === "connected"
                ? "status-dot--connected"
                : "status-dot--disconnected"
                }`}
            />
            {status}
          </span>
        </div>
        <div className="status-item">
          <span className="status-item__label">Recorder</span>
          <span className="status-item__value">
            <span
              className={`status-dot ${recStatus === "recording"
                ? "status-dot--recording"
                : "status-dot--idle"
                }`}
            />
            {recStatus}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="controls">
        <button
          className={`btn-primary ${recStatus === "recording" ? "btn-recording" : ""}`}
          onClick={startRecording}
          disabled={status !== "connected" || recStatus === "recording"}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
          Start Recording
        </button>

        <button
          className="btn-danger"
          onClick={stopRecording}
          disabled={recStatus !== "recording"}
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          Stop
        </button>
      </div>

      {/* Transcript Card */}
      <div className="card">
        <div className="card__header">
          <svg
            className="card__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="card__title">Live Transcript</span>
          {recStatus === "recording" && (
            <span className="live-indicator">
              <span className="live-indicator__dot" />
              Live
            </span>
          )}
        </div>
        <div className="transcript">
          {!partialText && !finalText ? (
            <p className="transcript__placeholder">
              Start recording to see live transcription...
            </p>
          ) : (
            <div className="transcript__content">
              {partialText && (
                <span className="transcript__partial">{partialText}</span>
              )}
              {finalText && (
                <div className="transcript__final">
                  <strong>Final:</strong> {finalText}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Audio Playback */}
      {audioUrl && (
        <div className="card audio-section">
          <div className="card__header">
            <svg
              className="card__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span className="card__title">Playback</span>
          </div>
          <div className="audio-player">
            <audio controls src={audioUrl} />
          </div>
          <div className="audio-url">{audioUrl}</div>
        </div>
      )}
    </div>
  );
}
