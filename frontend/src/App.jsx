import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

export default function App() {
  const socketRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioRef = useRef(null);

  const sessionIdRef = useRef(null);
  const seqRef = useRef(0);

  const [status, setStatus] = useState("disconnected");
  const [recStatus, setRecStatus] = useState("idle");

  const [audioUrl, setAudioUrl] = useState(null);
  const [partialText, setPartialText] = useState("");
  const [finalText, setFinalText] = useState("");

  // Word-level transcript data
  const [words, setWords] = useState([]);

  // Segments map: { segmentId: { words: [...], isFinal: bool } }
  const [segments, setSegments] = useState({});

  // Active word during playback (for highlighting)
  const [activeWid, setActiveWid] = useState(null);

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

    // NEW: Listen for word-level transcript patches
    socket.on("transcript_patch", (data) => {
      console.log("[SOCKET] transcript_patch received:", data);
      if (data.sessionId !== sessionIdRef.current) {
        return;
      }

      // Store segments by segmentId for click-to-seek
      setSegments((prev) => ({
        ...prev,
        [data.segmentId]: {
          words: data.words,
          isFinal: data.isFinal,
        },
      }));

      // Merge words: replace or append based on isFinal
      setWords((prevWords) => {
        if (data.isFinal) {
          // Final words - add to committed list
          const existingWids = new Set(prevWords.filter(w => w.isFinal).map(w => w.wid));
          const newWords = data.words
            .filter(w => !existingWids.has(w.wid))
            .map(w => ({ ...w, isFinal: true }));
          // Keep committed words, replace interim with new finals
          const committed = prevWords.filter(w => w.isFinal || w.edited);
          return [...committed, ...newWords];
        } else {
          // Interim words - keep committed, replace interim tail
          const committed = prevWords.filter(w => w.isFinal || w.edited);
          const interimWords = data.words.map(w => ({ ...w, isFinal: false }));
          return [...committed, ...interimWords];
        }
      });

      log(`transcript_patch: ${data.words.length} words (isFinal=${data.isFinal})`);
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
  // Click-to-seek: seek audio to word timestamp and play
  // ---------------------------
  const seekAndPlay = (t0) => {
    const audio = audioRef.current;
    console.log("[SEEK] seekAndPlay called with t0:", t0, "audioRef.current:", audio);

    if (!audio) {
      console.warn("[SEEK] No audio element!");
      return;
    }
    if (t0 == null) {
      console.warn("[SEEK] t0 is null/undefined!");
      return;
    }

    const doSeekPlay = async () => {
      try {
        console.log("[SEEK] doSeekPlay - before: currentTime=", audio.currentTime, "duration=", audio.duration);
        audio.pause(); // ensures clean restart
        audio.currentTime = Math.max(0, t0);
        console.log("[SEEK] doSeekPlay - after setting: currentTime=", audio.currentTime);
        await audio.play(); // IMPORTANT: start playback
        log(`Seeked to ${t0.toFixed(2)}s and playing`);
      } catch (err) {
        console.warn("seekAndPlay failed:", err);
        // If browser blocks autoplay for some reason, user can press Play once manually.
      }
    };

    console.log("[SEEK] audio.readyState:", audio.readyState);

    // If metadata isn't loaded, wait for it then seek+play
    if (audio.readyState < 1) {
      console.log("[SEEK] Waiting for loadedmetadata...");
      const onLoaded = () => {
        audio.removeEventListener("loadedmetadata", onLoaded);
        doSeekPlay();
      };
      audio.addEventListener("loadedmetadata", onLoaded);
      audio.load(); // helps in some browsers
      return;
    }

    // If not enough data to play yet, wait for canplay
    if (audio.readyState < 2) {
      console.log("[SEEK] Waiting for canplay...");
      const onCanPlay = () => {
        audio.removeEventListener("canplay", onCanPlay);
        doSeekPlay();
      };
      audio.addEventListener("canplay", onCanPlay);
      return;
    }

    doSeekPlay();
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
      setWords([]); // Reset word-level data
      setSegments({}); // Reset segments data
      // getting audio stream
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
  // Build flat ordered list of timestamped words (READ-ONLY)
  // ---------------------------
  const orderedWords = Object.entries(segments)
    .sort(([a], [b]) => {
      const na = parseInt((a.split("_")[1] || "0"), 10);
      const nb = parseInt((b.split("_")[1] || "0"), 10);
      return na - nb;
    })
    .flatMap(([_, seg]) => (seg?.words || []))
    .filter(w => w.t0 != null && w.t1 != null);

  // ---------------------------
  // Playback sync effect (highlight current word)
  // ---------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let rafId = null;

    const findActive = (t) => {
      for (const w of orderedWords) {
        if (w.t0 <= t && t < w.t1) return w;
      }
      return null;
    };

    const tick = () => {
      const w = findActive(audio.currentTime);
      setActiveWid(w ? w.wid : null);
      rafId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (!rafId) rafId = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    };

    const onSeeked = () => {
      const w = findActive(audio.currentTime);
      setActiveWid(w ? w.wid : null);
    };

    audio.addEventListener("play", start);
    audio.addEventListener("pause", stop);
    audio.addEventListener("ended", stop);
    audio.addEventListener("seeked", onSeeked);

    return () => {
      audio.removeEventListener("play", start);
      audio.removeEventListener("pause", stop);
      audio.removeEventListener("ended", stop);
      audio.removeEventListener("seeked", onSeeked);
      stop();
    };
  }, [orderedWords]);

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
            <audio ref={audioRef} controls src={audioUrl} />
          </div>
          <div className="audio-url">{audioUrl}</div>
        </div>
      )}

      {/* Clickable Word Spans - Click to seek audio */}
      {words.length > 0 && (
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
              <polyline points="4 7 4 4 20 4 20 7" />
              <line x1="9" y1="20" x2="15" y2="20" />
              <line x1="12" y1="4" x2="12" y2="20" />
            </svg>
            <span className="card__title">Click Words to Seek</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {words.filter(w => w.isFinal).length} words
            </span>
          </div>
          <div className="word-spans" style={{
            padding: '1rem',
            lineHeight: '2',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.25rem'
          }}>
            {words.map((word, idx) => {
              const isActive = word.wid === activeWid;
              return (
                <span
                  key={word.wid || idx}
                  onClick={() => seekAndPlay(word.t0)}
                  className={isActive ? "word word--active" : "word"}
                  style={{
                    cursor: word.t0 != null ? 'pointer' : 'default',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    backgroundColor: isActive
                      ? 'rgba(255, 255, 255, 0.25)'
                      : (word.isFinal
                        ? 'rgba(139, 92, 246, 0.15)'
                        : 'rgba(251, 191, 36, 0.15)'),
                    border: isActive
                      ? '2px solid rgba(255, 255, 255, 0.5)'
                      : (word.isFinal
                        ? '1px solid rgba(139, 92, 246, 0.3)'
                        : '1px solid rgba(251, 191, 36, 0.3)'),
                    color: word.isFinal ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontSize: '0.875rem',
                    transition: 'all 0.15s ease',
                    transform: isActive ? 'scale(1.05)' : 'scale(1)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.target.style.backgroundColor = word.isFinal
                        ? 'rgba(139, 92, 246, 0.3)'
                        : 'rgba(251, 191, 36, 0.3)';
                    }
                    e.target.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.target.style.backgroundColor = word.isFinal
                        ? 'rgba(139, 92, 246, 0.15)'
                        : 'rgba(251, 191, 36, 0.15)';
                    }
                    e.target.style.transform = isActive ? 'scale(1.05)' : 'scale(1)';
                  }}
                  title={word.t0 != null ? `Seek to ${word.t0.toFixed(2)}s` : 'No timestamp'}
                >
                  {word.text}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
