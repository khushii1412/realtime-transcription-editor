/**
 * TranscriptPanel - Shows partial/final transcript and clickable words
 */
import React from "react";

export default function TranscriptPanel({
    recStatus,
    partialText,
    finalText,
    words,
    activeWid,
    onSeekToWord,
}) {
    return (
        <>
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

            {/* Clickable Word Spans */}
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
                        <span
                            style={{
                                fontSize: "0.75rem",
                                color: "var(--text-muted)",
                                marginLeft: "auto",
                            }}
                        >
                            {words.filter((w) => w.isFinal).length} words
                        </span>
                    </div>
                    <div
                        className="word-spans"
                        style={{
                            padding: "1rem",
                            lineHeight: "2",
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "0.25rem",
                        }}
                    >
                        {words.map((word, idx) => {
                            const isActive = word.wid === activeWid;
                            return (
                                <span
                                    key={word.wid || idx}
                                    onClick={() => onSeekToWord(word.t0)}
                                    className={isActive ? "word word--active" : "word"}
                                    style={{
                                        cursor: word.t0 != null ? "pointer" : "default",
                                        padding: "0.25rem 0.5rem",
                                        borderRadius: "4px",
                                        backgroundColor: isActive
                                            ? "rgba(255, 255, 255, 0.25)"
                                            : word.isFinal
                                                ? "rgba(139, 92, 246, 0.15)"
                                                : "rgba(251, 191, 36, 0.15)",
                                        border: isActive
                                            ? "2px solid rgba(255, 255, 255, 0.5)"
                                            : word.isFinal
                                                ? "1px solid rgba(139, 92, 246, 0.3)"
                                                : "1px solid rgba(251, 191, 36, 0.3)",
                                        color: word.isFinal
                                            ? "var(--text-primary)"
                                            : "var(--text-muted)",
                                        fontSize: "0.875rem",
                                        transition: "all 0.15s ease",
                                        transform: isActive ? "scale(1.05)" : "scale(1)",
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isActive) {
                                            e.target.style.backgroundColor = word.isFinal
                                                ? "rgba(139, 92, 246, 0.3)"
                                                : "rgba(251, 191, 36, 0.3)";
                                        }
                                        e.target.style.transform = "translateY(-1px)";
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isActive) {
                                            e.target.style.backgroundColor = word.isFinal
                                                ? "rgba(139, 92, 246, 0.15)"
                                                : "rgba(251, 191, 36, 0.15)";
                                        }
                                        e.target.style.transform = isActive
                                            ? "scale(1.05)"
                                            : "scale(1)";
                                    }}
                                    title={
                                        word.t0 != null
                                            ? `Seek to ${word.t0.toFixed(2)}s`
                                            : "No timestamp"
                                    }
                                >
                                    {word.text}
                                </span>
                            );
                        })}
                    </div>
                </div>
            )}
        </>
    );
}
