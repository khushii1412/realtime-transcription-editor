import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import FinalEditor from "./components/FinalEditor";
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

  // Microphone selection
  const [mics, setMics] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState("");

  // Elapsed timer
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef(null);

  // Past recordings from MongoDB
  const [savedSessions, setSavedSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [loadingSession, setLoadingSession] = useState(false);

  // Editable final transcript state (Slate format)
  const textToSlateValue = (text) => [
    { type: "paragraph", children: [{ text: text || "" }] },
  ];
  const slateToPlainText = (value) => {
    if (!value || !Array.isArray(value)) return "";
    return value
      .map((node) =>
        node.children?.map((child) => child.text || "").join("") || ""
      )
      .join("\n");
  };
  const [finalEditorValue, setFinalEditorValue] = useState(textToSlateValue(""));
  const [isFinalDirty, setIsFinalDirty] = useState(false);
  const isFinalDirtyRef = useRef(false);

  // Track what server text was last applied to editor (for merge logic)
  const [lastAppliedServerFinalText, setLastAppliedServerFinalText] = useState("");

  // Committed final text built from segments (live updates)
  const [committedFinalText, setCommittedFinalText] = useState("");
  const [hasNewFinalUpdate, setHasNewFinalUpdate] = useState(false);

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
      // Only update editor if user hasn't edited
      if (!isFinalDirtyRef.current) {
        setFinalEditorValue(textToSlateValue(data.text));
      } else {
        setHasNewFinalUpdate(true);
      }
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

  // Sync isFinalDirtyRef with state
  useEffect(() => {
    isFinalDirtyRef.current = isFinalDirty;
  }, [isFinalDirty]);

  // Enumerate microphones on mount
  useEffect(() => {
    const enumMics = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((d) => d.kind === "audioinput");
        setMics(audioInputs);
        if (audioInputs.length > 0 && !selectedMicId) {
          setSelectedMicId(audioInputs[0].deviceId);
        }
      } catch (err) {
        console.warn("Could not enumerate mics:", err);
      }
    };
    enumMics();
    navigator.mediaDevices.addEventListener("devicechange", enumMics);
    return () => navigator.mediaDevices.removeEventListener("devicechange", enumMics);
  }, [selectedMicId]);

  // Timer cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Build committedFinalText from finalized segments (live updates during recording)
  useEffect(() => {
    const buildCommittedTextFromSegments = () => {
      const sortedSegmentIds = Object.keys(segments).sort((a, b) => {
        const numA = parseInt(a.split("_").pop() || "0", 10);
        const numB = parseInt(b.split("_").pop() || "0", 10);
        return numA - numB;
      });

      let text = "";
      for (const segId of sortedSegmentIds) {
        const seg = segments[segId];
        if (seg && seg.isFinal && seg.words) {
          const segText = seg.words.map((w) => w.text).join(" ");
          text += (text ? " " : "") + segText;
        }
      }
      // Clean up punctuation
      text = text.replace(/\s+([.,!?;:])/g, "$1");
      return text;
    };

    const newCommitted = buildCommittedTextFromSegments();
    if (newCommitted !== committedFinalText) {
      setCommittedFinalText(newCommitted);
      // Update editor if not dirty
      if (!isFinalDirty && newCommitted) {
        setFinalEditorValue(textToSlateValue(newCommitted));
        setLastAppliedServerFinalText(newCommitted);
      } else if (isFinalDirty && newCommitted !== lastAppliedServerFinalText) {
        setHasNewFinalUpdate(true);
      }
    }
  }, [segments, committedFinalText, isFinalDirty, lastAppliedServerFinalText]);

  // Compute if new ASR is available (for merge banner)
  const newAsrAvailable = isFinalDirty && committedFinalText !== lastAppliedServerFinalText && committedFinalText.length > 0;

  // Merge handlers
  const handleAppendAsr = () => {
    // Compute delta (new text since last sync)
    const delta = committedFinalText.slice(lastAppliedServerFinalText.length).trim();
    if (delta) {
      // Get current editor plain text
      const currentEditorText = slateToPlainText(finalEditorValue);
      const newText = currentEditorText + (currentEditorText.endsWith(" ") ? "" : " ") + delta;
      setFinalEditorValue(textToSlateValue(newText));
    }
    setLastAppliedServerFinalText(committedFinalText);
    setHasNewFinalUpdate(false);
    // Keep dirty=true (user is still in manual mode)
  };

  const handleReplaceWithAsr = () => {
    setFinalEditorValue(textToSlateValue(committedFinalText));
    setLastAppliedServerFinalText(committedFinalText);
    setIsFinalDirty(false);
    isFinalDirtyRef.current = false;
    setHasNewFinalUpdate(false);
  };

  const handleIgnoreAsr = () => {
    // Keep editor content unchanged, just dismiss the banner
    setLastAppliedServerFinalText(committedFinalText);
    setHasNewFinalUpdate(false);
    // Keep dirty=true
  };

  // Fetch saved sessions from MongoDB
  const fetchSessions = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/sessions");
      const data = await res.json();
      setSavedSessions(data.sessions || []);
      log(`Fetched ${data.sessions?.length || 0} sessions`);
    } catch (err) {
      console.warn("Could not fetch sessions:", err);
    }
  };

  // Load a session from MongoDB
  const loadSession = async (sid) => {
    if (!sid) return;
    setLoadingSession(true);
    try {
      const res = await fetch(`http://localhost:8000/api/sessions/${sid}`);
      const data = await res.json();
      if (data.session) {
        setAudioUrl(`http://localhost:8000/sessions/${sid}/audio`);
        setFinalText(data.finalText || data.session.finalText || "");
        setCommittedFinalText(data.finalText || data.session.finalText || "");
        setFinalEditorValue(textToSlateValue(data.finalText || data.session.finalText || ""));
        setIsFinalDirty(false);

        // Load segments from response (returned inline)
        if (data.segments) {
          const allWords = [];
          for (const seg of data.segments) {
            if (seg.words) {
              for (const w of seg.words) {
                allWords.push({ ...w, isFinal: seg.isFinal !== false });
              }
            }
          }
          setWords(allWords);
        }
        log(`Loaded session ${sid}`);
      }
    } catch (err) {
      console.warn("Could not load session:", err);
    } finally {
      setLoadingSession(false);
    }
  };

  // Fetch sessions on mount
  useEffect(() => {
    fetchSessions();
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

      // Reset all states
      setAudioUrl(null);
      setPartialText("");
      setFinalText("");
      setCommittedFinalText("");
      setFinalEditorValue(textToSlateValue(""));
      setIsFinalDirty(false);
      setHasNewFinalUpdate(false);
      setLastAppliedServerFinalText("");
      isFinalDirtyRef.current = false;
      setWords([]);
      setSegments({});
      setElapsedMs(0);

      // Start timer
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTime);
      }, 100);

      // Get audio stream with selected mic
      const constraints = selectedMicId
        ? { audio: { deviceId: { exact: selectedMicId } } }
        : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
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

    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

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

      {/* Past Recordings + Mic Selection */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16, justifyContent: "center" }}>
        <button
          onClick={fetchSessions}
          disabled={recStatus === "recording" || loadingSession}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "var(--surface-primary)",
            color: "var(--text-primary)",
            cursor: recStatus === "recording" || loadingSession ? "not-allowed" : "pointer",
            fontSize: 13,
            opacity: recStatus === "recording" || loadingSession ? 0.5 : 1,
          }}
        >
          Refresh Sessions
        </button>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          Past Recordings:
          <select
            value={selectedSessionId}
            onChange={(e) => {
              const sid = e.target.value;
              setSelectedSessionId(sid);
              loadSession(sid);
            }}
            disabled={recStatus === "recording" || loadingSession}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "var(--surface-primary)",
              color: "var(--text-primary)",
              cursor: recStatus === "recording" || loadingSession ? "not-allowed" : "pointer",
              minWidth: 180,
              opacity: recStatus === "recording" || loadingSession ? 0.5 : 1,
            }}
          >
            <option value="">-- select --</option>
            {savedSessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.sessionId} ({s.status || "saved"})
              </option>
            ))}
          </select>
        </label>
        {loadingSession && <span style={{ fontSize: 12, opacity: 0.7 }}>Loading...</span>}
      </div>

      {/* Mic Selection + Timer */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 16, justifyContent: "center" }}>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          Microphone:
          <select
            value={selectedMicId}
            onChange={(e) => setSelectedMicId(e.target.value)}
            disabled={recStatus === "recording"}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "var(--surface-primary)",
              color: "var(--text-primary)",
              cursor: recStatus === "recording" ? "not-allowed" : "pointer",
            }}
          >
            {mics.length === 0 && <option value="">No mics found</option>}
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || `Microphone (${m.deviceId.slice(0, 6)}...)`}
              </option>
            ))}
          </select>
        </label>
        <div style={{
          fontSize: 14,
          fontFamily: "monospace",
          padding: "6px 12px",
          borderRadius: 6,
          background: recStatus === "recording" ? "rgba(239,68,68,0.15)" : "var(--surface-primary)",
          border: recStatus === "recording" ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(255,255,255,0.1)",
        }}>
          {Math.floor(elapsedMs / 60000)}:{String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, "0")}
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
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          Stop
        </button>
      </div>

      {/* Interim Transcript Box (Read-Only) */}
      <div className="card">
        <div className="card__header">
          <svg className="card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="card__title">Interim (Live)</span>
          {recStatus === "recording" && (
            <span className="live-indicator">
              <span className="live-indicator__dot" />
              Live
            </span>
          )}
        </div>
        <div className="transcript" style={{ minHeight: 80 }}>
          {!partialText ? (
            <p className="transcript__placeholder" style={{ opacity: 0.5, fontStyle: "italic" }}>
              {recStatus === "recording" ? "Listening..." : "Start recording to see live transcription..."}
            </p>
          ) : (
            <div className="transcript__content">
              <span className="transcript__partial">{partialText}</span>
            </div>
          )}
        </div>
      </div>

      {/* Final Transcript Box (Rich Text Editor) */}
      <div className="card">
        <div className="card__header">
          <svg className="card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span className="card__title">Final (Rich Text Editor)</span>
        </div>
        <div style={{ padding: "0 1rem 1rem 1rem" }}>
          <FinalEditor
            value={finalEditorValue}
            onChange={(val) => setFinalEditorValue(val)}
            onUserEdit={() => {
              setIsFinalDirty(true);
              isFinalDirtyRef.current = true;
            }}
            onResetToLatest={() => {
              setFinalEditorValue(textToSlateValue(committedFinalText));
              setIsFinalDirty(false);
              setHasNewFinalUpdate(false);
              isFinalDirtyRef.current = false;
            }}
            showNewFinalBadge={hasNewFinalUpdate}
            isFinalDirty={isFinalDirty}
          />
          {/* Merge Options Banner */}
          {newAsrAvailable && (
            <div style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
            }}>
              <div style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 8 }}>
                New ASR update available. Your edits are preserved.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={handleAppendAsr}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "1px solid rgba(16, 185, 129, 0.4)",
                    background: "rgba(16, 185, 129, 0.2)",
                    color: "#10b981",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  Append new ASR
                </button>
                <button
                  onClick={handleReplaceWithAsr}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "1px solid rgba(139, 92, 246, 0.4)",
                    background: "rgba(139, 92, 246, 0.15)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  Replace with ASR
                </button>
                <button
                  onClick={handleIgnoreAsr}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "transparent",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Ignore
                </button>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)", opacity: 0.8 }}>
                Latest from ASR: {committedFinalText.slice(0, 80)}{committedFinalText.length > 80 ? "..." : ""}
              </div>
            </div>
          )}
          {/* Show info when dirty but no new ASR */}
          {isFinalDirty && !newAsrAvailable && committedFinalText && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", opacity: 0.7 }}>
              Synced with ASR.
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
