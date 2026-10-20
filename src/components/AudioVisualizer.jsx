import React, { useEffect, useState } from 'react';

/**
 * AudioVisualizer
 * High-density audio spectrum visualizer simulating real-time microphone & system audio input.
 * Refined vertical alignment and bar spacing for the compact floating toolbar.
 */
export function AudioVisualizer({ state = 'idle', barCount = 6, isMuted = false }) {
  const [bars, setBars] = useState(() => Array(barCount).fill(18));

  useEffect(() => {
    if (isMuted || state === 'muted') {
      setBars(Array(barCount).fill(4));
      return;
    }

    const interval = setInterval(() => {
      setBars((prevBars) =>
        prevBars.map((_, i) => {
          if (state === 'active') {
            // Simulated dynamic speech audio frequencies
            const base = Math.sin(Date.now() / 130 + i * 1.1) * 35 + 55;
            const jitter = Math.random() * 20;
            return Math.min(96, Math.max(16, Math.round(base + jitter)));
          } else {
            // Idle ambient breath
            const idleHeight = Math.sin(Date.now() / 420 + i * 0.9) * 12 + 20;
            return Math.max(10, Math.round(idleHeight));
          }
        })
      );
    }, 75);

    return () => clearInterval(interval);
  }, [state, isMuted, barCount]);

  return (
    <div
      className="audio-visualizer-container"
      title={`Audio Monitor: ${isMuted ? 'Muted' : state === 'active' ? 'Active Speech' : 'Ambient Idle'}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '3px',
        height: '32px',
        padding: '0 8px',
        borderRadius: '9999px',
        backgroundColor: 'rgba(0, 0, 0, 0.32)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxSizing: 'border-box',
      }}
    >
      {bars.map((height, idx) => (
        <span
          key={idx}
          style={{
            display: 'inline-block',
            width: '2.5px',
            height: `${height}%`,
            minHeight: '4px',
            maxHeight: '20px',
            borderRadius: '9999px',
            backgroundColor: isMuted
              ? 'rgba(239, 68, 68, 0.75)'
              : state === 'active'
              ? 'var(--accent-emerald)'
              : 'rgba(203, 213, 225, 0.55)',
            boxShadow:
              state === 'active' && !isMuted
                ? '0 0 6px rgba(16, 185, 129, 0.6)'
                : 'none',
            transition: 'height 0.08s ease, background-color 0.2s ease',
          }}
        />
      ))}
    </div>
  );
}
