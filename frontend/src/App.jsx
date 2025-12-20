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

  // Current active session tracking
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [isNewSession, setIsNewSession] = useState(false);
  const [currentSessionStatus, setCurrentSessionStatus] = useState(null); // null, "recording", "stopped", "finalized"

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
  const committedFinalTextRef = useRef("");
  const [hasNewFinalUpdate, setHasNewFinalUpdate] = useState(false);

  // Theme toggle (light/dark)
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("theme") || "dark";
  });

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

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

    socket.on("audio_ack", () => {
      // Silently acknowledge
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
      if (data.sessionId !== sessionIdRef.current) {
        return;
      }
      // Only show the NEW portion that's not yet finalized
      // (partial text from Deepgram includes everything, so we subtract what's already in final)
      const fullPartial = data.text || "";
      const alreadyFinal = committedFinalTextRef.current || "";

      // If partial starts with what's already final, show only the tail
      if (fullPartial.startsWith(alreadyFinal)) {
        const newPortion = fullPartial.slice(alreadyFinal.length).trim();
        setPartialText(newPortion);
      } else {
        // Fallback: show full partial if it doesn't match
        setPartialText(fullPartial);
      }
      log(`transcript_partial: ${data.text}`);
    });

    socket.on("transcript_final", (data) => {
      if (data.sessionId !== sessionIdRef.current) {
        return;
      }
      setFinalText(data.text);
      setPartialText("");
      // Note: We don't update finalEditorValue here because segment-based updates 
      // already handle this and preserve user edits
      log(`transcript_final: ${data.text}`);

      // Auto-refresh session list after finalization (with small delay for DB write)
      setTimeout(() => {
        fetch("http://localhost:8000/sessions")
          .then((r) => r.json())
          .then((list) => setSavedSessions(list || []))
          .catch(() => { });
      }, 500);
    });

    // NEW: Listen for word-level transcript patches
    socket.on("transcript_patch", (data) => {
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

      // Clear partial text when segment is finalized (it's now in final editor)
      if (data.isFinal) {
        setPartialText("");
      }

      log(`transcript_patch: ${data.words.length} words (isFinal=${data.isFinal})`);
    });

    socket.on("connect_error", (e) => {
      log(`connect_error: ${e.message}`);
    });

    // Debug: catch all events (disabled for cleaner console)
    // socket.onAny((eventName, ...args) => {
    //   console.log("[SOCKET] Event:", eventName, args);
    // });

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
  // AUTO-APPEND: New transcription text is ALWAYS appended to the current editor content
  // This preserves user edits while still adding new transcription at the end
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

    // Only proceed if there's new ASR content
    if (newCommitted !== committedFinalText) {
      const oldCommitted = committedFinalText;
      setCommittedFinalText(newCommitted);
      committedFinalTextRef.current = newCommitted;

      // Calculate the NEW portion of text (delta) that was just transcribed
      if (newCommitted.length > oldCommitted.length) {
        const delta = newCommitted.slice(oldCommitted.length).trim();
        if (delta) {
          // ALWAYS APPEND to current editor content (preserves user edits)
          const currentEditorText = slateToPlainText(finalEditorValue);
          const separator = currentEditorText && !currentEditorText.endsWith(" ") ? " " : "";
          const newText = currentEditorText + separator + delta;
          setFinalEditorValue(textToSlateValue(newText));
        }
      } else if (oldCommitted === "" && newCommitted) {
        // First segment - initialize editor
        setFinalEditorValue(textToSlateValue(newCommitted));
      }
      // If newCommitted is shorter (shouldn't happen normally), don't update editor
    }
  }, [segments, committedFinalText, finalEditorValue]);

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
        // Save to localStorage for next app open
        localStorage.setItem("lastSessionId", sid);
        setCurrentSessionId(sid);
        sessionIdRef.current = sid;
        setIsNewSession(false);
        setCurrentSessionStatus(data.session.status || "finalized"); // Set status from loaded session

        setAudioUrl(`http://localhost:8000/sessions/${sid}/audio`);
        setFinalText(data.finalText || data.session.finalText || "");
        setCommittedFinalText(data.finalText || data.session.finalText || "");

        // Load Slate content with formatting if available, otherwise use plain text
        if (data.slateContent && Array.isArray(data.slateContent)) {
          setFinalEditorValue(data.slateContent);
        } else {
          setFinalEditorValue(textToSlateValue(data.finalText || data.session.finalText || ""));
        }
        setIsFinalDirty(false);

        // Load recording duration if available
        if (data.durationMs) {
          setElapsedMs(data.durationMs);
        }

        // Load segments from response (returned inline)
        if (data.segments) {
          const allWords = [];
          const loadedSegments = {};
          for (const seg of data.segments) {
            if (seg.words) {
              loadedSegments[seg.segmentId] = { words: seg.words, isFinal: seg.isFinal !== false };
              for (const w of seg.words) {
                allWords.push({ ...w, isFinal: seg.isFinal !== false });
              }
            }
          }
          setWords(allWords);
          setSegments(loadedSegments);
        }
        log(`Loaded session ${sid} (status: ${data.session.status || "finalized"}, duration: ${data.durationMs ? Math.floor(data.durationMs / 1000) + 's' : 'unknown'})`);
      }
    } catch (err) {
      console.warn("Could not load session:", err);
    } finally {
      setLoadingSession(false);
    }
  };

  // Fetch sessions on mount and auto-load last session
  useEffect(() => {
    const initializeSession = async () => {
      // First fetch all sessions
      await fetchSessions();

      // Then try to load the last session from localStorage
      const lastSid = localStorage.getItem("lastSessionId");
      if (lastSid) {
        log(`Auto-loading last session: ${lastSid}`);
        await loadSession(lastSid);
        setSelectedSessionId(lastSid);
      }
    };
    initializeSession();
  }, []);

  // Create a new session (clears all state, waits for recording to start)
  const createNewSession = () => {
    // Clear session references
    sessionIdRef.current = null;
    setCurrentSessionId(null);
    setIsNewSession(true);
    setCurrentSessionStatus(null); // Allow recording on new session

    // Clear localStorage so refresh doesn't load old session
    localStorage.removeItem("lastSessionId");

    // Clear all content state
    setAudioUrl(null);
    setPartialText("");
    setFinalText("");
    setCommittedFinalText("");
    committedFinalTextRef.current = "";
    setFinalEditorValue(textToSlateValue(""));
    setIsFinalDirty(false);
    setHasNewFinalUpdate(false);
    setLastAppliedServerFinalText("");
    isFinalDirtyRef.current = false;
    setWords([]);
    setSegments({});
    setElapsedMs(0);
    setSelectedSessionId("");

    log("New session created (waiting for recording to start)");
  };

  // Save Slate content (with formatting) and duration to database
  const saveSlateContent = async (durationMs = null) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    try {
      const plainText = slateToPlainText(finalEditorValue);
      const body = {
        slateContent: finalEditorValue,
        finalText: plainText,
      };
      if (durationMs !== null) {
        body.durationMs = durationMs;
      }
      await fetch(`http://localhost:8000/api/sessions/${sessionId}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      log("Saved formatted content to database");
    } catch (err) {
      console.warn("Failed to save slate content:", err);
    }
  };

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

      // Generate new session ID ONLY if we don't have one
      // Include random suffix to ensure uniqueness across concurrent users
      if (!sessionIdRef.current) {
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        sessionIdRef.current = `sess_${Date.now()}_${randomSuffix}`;
        setCurrentSessionId(sessionIdRef.current);
        log(`Generated new session ID: ${sessionIdRef.current}`);
      }

      // Save to localStorage immediately when recording starts
      localStorage.setItem("lastSessionId", sessionIdRef.current);

      seqRef.current = 0;

      // Reset content states for new recording
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
      setIsNewSession(false);

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
      };

      // Start transcription FIRST (before MediaRecorder)
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
    setCurrentSessionStatus("finalized"); // Mark session as finalized
    setSelectedSessionId(sessionIdRef.current); // Select the current session in dropdown

    // Capture duration before resetting
    const recordingDurationMs = elapsedMs;

    // Save formatted content and duration to database (with small delay for transcript to finalize)
    // Then refresh session list to show the new session
    setTimeout(async () => {
      await saveSlateContent(recordingDurationMs);
      // Refresh session list to show the newly saved session
      try {
        const res = await fetch("http://localhost:8000/api/sessions");
        const data = await res.json();
        setSavedSessions(data.sessions || []);
      } catch (err) {
        console.warn("Failed to refresh sessions:", err);
      }
    }, 1000);

    log(`Recording stopped (duration: ${Math.floor(recordingDurationMs / 1000)}s)`);
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
      {/* Header - spans all columns */}
      <header className="header">
        <h1 className="header__title">Live Transcription Studio</h1>
        <p className="header__subtitle">
          Record audio and get real-time transcriptions powered by Deepgram
        </p>
      </header>

      {/* ========== LEFT SIDEBAR - Session Controls ========== */}
      <aside className="sidebar sidebar-left">
        {/* Current Session */}
        <div className="sidebar-section">
          <div className="sidebar-section__title">Current Session</div>
          <div className={`session-display ${!currentSessionId ? 'session-display--empty' : ''}`}>
            <span className={`session-display__id ${!currentSessionId ? 'session-display__id--empty' : ''}`}>
              {currentSessionId || "(No session)"}
            </span>
          </div>
          <button
            className="btn-new-session"
            onClick={createNewSession}
            disabled={recStatus === "recording"}
          >
            <span>+</span> New Session
          </button>
        </div>

        {/* Past Sessions */}
        <div className="sidebar-section">
          <div className="sidebar-section__title">Load Session</div>
          <select
            className="session-select"
            value={selectedSessionId}
            onChange={(e) => {
              const sid = e.target.value;
              if (sid === "__new__") {
                createNewSession();
                return;
              }
              setSelectedSessionId(sid);
              loadSession(sid);
            }}
            disabled={recStatus === "recording" || loadingSession}
          >
            {isNewSession && !currentSessionId ? (
              <option value="">Current Session (new)</option>
            ) : (
              <option value="">-- select --</option>
            )}
            {savedSessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.sessionId.replace('sess_', '')} ({s.status || "saved"})
              </option>
            ))}
          </select>
        </div>
      </aside>

      {/* ========== MAIN CONTENT - Transcripts ========== */}
      <main className="main-content">
        {/* Final Transcript Box (Rich Text Editor) - ON TOP */}
        <div className="card card--final">
          <div className="card__header">
            <svg className="card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <span className="card__title">Final (Rich Text Editor)</span>
            {/* Theme Toggle - Right Side */}
            <button
              onClick={toggleTheme}
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 16,
                border: "1px solid var(--border-default)",
                background: "var(--surface-secondary)",
                color: "var(--text-secondary)",
                fontSize: 11,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="5" />
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                  </svg>
                  Light
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                  Dark
                </>
              )}
            </button>
          </div>
          <div style={{ padding: "0 0.5rem" }}>
            <FinalEditor
              value={finalEditorValue}
              onChange={(val) => setFinalEditorValue(val)}
            />
          </div>
        </div>

        {/* Interim Transcript Box (Read-Only) - BELOW */}
        <div className="card card--interim">
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
          <div className="transcript">
            {!partialText ? (
              <p className="transcript__placeholder">
                {recStatus === "recording" ? "Listening..." : "Start recording to see live transcription..."}
              </p>
            ) : (
              <div className="transcript__content">
                <span className="transcript__partial">{partialText}</span>
              </div>
            )}
          </div>
        </div>

        {/* Audio Playback */}
        {audioUrl && (
          <div className="card audio-section">
            <div className="card__header">
              <svg className="card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span className="card__title">Playback</span>
              {elapsedMs > 0 && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  {Math.floor(elapsedMs / 60000)}:{String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, "0")}
                </span>
              )}
            </div>
            <audio ref={audioRef} controls src={audioUrl} className="audio-player" />
          </div>
        )}

        {/* Clickable Word Spans */}
        {words.length > 0 && (
          <div className="card">
            <div className="card__header">
              <svg className="card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 7 4 4 20 4 20 7" />
                <line x1="9" y1="20" x2="15" y2="20" />
                <line x1="12" y1="4" x2="12" y2="20" />
              </svg>
              <span className="card__title">Click Words to Seek</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {words.filter(w => w.isFinal).length} words
              </span>
            </div>
            <div style={{ padding: '0.5rem', lineHeight: '2', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
              {words.map((word, idx) => {
                const isActive = word.wid === activeWid;
                return (
                  <span
                    key={word.wid || idx}
                    onClick={() => seekAndPlay(word.t0)}
                    className={isActive ? "word word--active" : "word"}
                    style={{
                      cursor: word.t0 != null ? 'pointer' : 'default',
                      padding: '0.2rem 0.4rem',
                      borderRadius: '4px',
                      backgroundColor: isActive ? 'rgba(255, 255, 255, 0.25)'
                        : (word.isFinal ? 'rgba(139, 92, 246, 0.15)' : 'rgba(251, 191, 36, 0.15)'),
                      border: isActive ? '2px solid rgba(255, 255, 255, 0.5)'
                        : (word.isFinal ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid rgba(251, 191, 36, 0.3)'),
                      color: word.isFinal ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontSize: '0.8rem',
                      transition: 'all 0.15s ease',
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
      </main>

      {/* ========== RIGHT SIDEBAR - Recording Controls ========== */}
      <aside className="sidebar sidebar-right">
        {/* Recording Timer & Buttons */}
        <div className="sidebar-section">
          <div className={`recording-timer ${recStatus === "recording" ? "recording-timer--active" : ""}`}>
            {Math.floor(elapsedMs / 60000)}:{String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, "0")}
          </div>
          <button
            className={`btn-record ${recStatus === "recording" ? "btn-record--recording" : ""}`}
            onClick={startRecording}
            disabled={
              status !== "connected" ||
              recStatus === "recording" ||
              currentSessionStatus === "finalized" ||
              currentSessionStatus === "stopped"
            }
            title={
              currentSessionStatus === "finalized" || currentSessionStatus === "stopped"
                ? "Cannot record on a finalized session. Create a new session to record."
                : undefined
            }
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
            {recStatus === "recording" ? "Recording..." : currentSessionStatus === "finalized" || currentSessionStatus === "stopped" ? "Session Finalized" : "Start Recording"}
          </button>
          <button
            className="btn-stop"
            onClick={stopRecording}
            disabled={recStatus !== "recording"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
            Stop Recording
          </button>
        </div>

        {/* Microphone Selection */}
        <div className="sidebar-section">
          <div className="sidebar-section__title">Microphone</div>
          <select
            className="mic-select"
            value={selectedMicId}
            onChange={(e) => setSelectedMicId(e.target.value)}
            disabled={recStatus === "recording"}
          >
            {mics.length === 0 && <option value="">No mics found</option>}
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || `Mic (${m.deviceId.slice(0, 8)}...)`}
              </option>
            ))}
          </select>
        </div>
      </aside>
    </div>
  );
}
