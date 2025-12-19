/**
 * PlaybackPanel - Audio element with controls
 */
import React from "react";

export default function PlaybackPanel({ audioUrl, audioRef }) {
    if (!audioUrl) return null;

    return (
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
    );
}
