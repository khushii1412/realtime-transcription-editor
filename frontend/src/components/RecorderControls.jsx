/**
 * RecorderControls - Mic dropdown, Start/Stop buttons, Timer, Status
 */
import React from "react";

export default function RecorderControls({
    // State
    status,
    recStatus,
    mics,
    selectedMicId,
    elapsedMs,
    // Handlers
    onMicChange,
    onStartRecording,
    onStopRecording,
}) {
    return (
        <>
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

            {/* Mic Selection + Timer */}
            <div
                style={{
                    display: "flex",
                    gap: 16,
                    alignItems: "center",
                    flexWrap: "wrap",
                    marginBottom: 16,
                    justifyContent: "center",
                }}
            >
                <label
                    style={{
                        fontSize: 13,
                        opacity: 0.85,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                    }}
                >
                    🎤 Microphone:
                    <select
                        value={selectedMicId}
                        onChange={(e) => onMicChange(e.target.value)}
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

                <div
                    style={{
                        fontSize: 14,
                        fontFamily: "monospace",
                        padding: "6px 12px",
                        borderRadius: 6,
                        background:
                            recStatus === "recording"
                                ? "rgba(239,68,68,0.15)"
                                : "var(--surface-primary)",
                        border:
                            recStatus === "recording"
                                ? "1px solid rgba(239,68,68,0.3)"
                                : "1px solid rgba(255,255,255,0.1)",
                    }}
                >
                    ⏱️ {Math.floor(elapsedMs / 60000)}:
                    {String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, "0")}
                </div>
            </div>

            {/* Controls */}
            <div className="controls">
                <button
                    className={`btn-primary ${recStatus === "recording" ? "btn-recording" : ""
                        }`}
                    onClick={onStartRecording}
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
                    onClick={onStopRecording}
                    disabled={recStatus !== "recording"}
                >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                    Stop
                </button>
            </div>
        </>
    );
}
