import React, { useState, useEffect } from 'react';
import { Mic, MicOff, Volume2, Radio, Sliders, X, Sparkles, RefreshCw } from 'lucide-react';

export function VoicePanel({ onClose, onNotify, isMuted, setIsMuted }) {
  const [voiceState, setVoiceState] = useState('listening'); // 'listening' | 'processing' | 'speaking' | 'paused'
  const [gain, setGain] = useState(80);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [vadMode, setVadMode] = useState(true); // Voice activity detection vs push-to-talk
  const [simulatedTranscript, setSimulatedTranscript] = useState(
    'User: "Can you analyze the memory leak in the handleEvent loop?"'
  );
  const [simulatedResponse, setSimulatedResponse] = useState(
    'OmniVoice: "Found 1 unhandled listener in the window event emitter. Recommending AbortController signal cleanup."'
  );

  useEffect(() => {
    if (isMuted) {
      setVoiceState('paused');
      return;
    }

    // Cycle through realistic voice interaction states
    const timer = setInterval(() => {
      setVoiceState((prev) => {
        if (prev === 'listening') return 'processing';
        if (prev === 'processing') return 'speaking';
        return 'listening';
      });
    }, 4500);

    return () => clearInterval(timer);
  }, [isMuted]);

  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    onNotify?.(next ? 'Voice muted' : 'Voice listening');
  };

  const handleSimulatePhrase = () => {
    const phrases = [
      {
        user: 'User: "Optimize React component render tree for performance"',
        ai: 'OmniVoice: "Use React.memo on the floating toolbar and memoize shortcut handlers to prevent unnecessary rerenders."',
      },
      {
        user: 'User: "What is the status of the Windows capture exclusion API?"',
        ai: 'OmniVoice: "Window display affinity is scheduled for Phase 2 integration via Tauri native Windows bindings."',
      },
      {
        user: 'User: "Take a screenshot and explain the active code block"',
        ai: 'OmniVoice: "Screen frame captured into memory. Bounding box detects a React useEffect hook."',
      },
    ];

    const random = phrases[Math.floor(Math.random() * phrases.length)];
    setSimulatedTranscript(random.user);
    setSimulatedResponse(random.ai);
    setVoiceState('speaking');
    onNotify?.('New simulated voice dialogue generated');
  };

  return (
    <div
      className="glass-panel panel-animate-in"
      style={{
        width: '470px',
        maxHeight: '520px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      data-no-drag="true"
    >
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '6px',
              backgroundColor: 'rgba(16, 185, 129, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-emerald)',
            }}
          >
            <Radio size={14} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>Voice Intelligence</span>
              <span className="badge-mock">Simulated Audio</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            onClick={handleSimulatePhrase}
            style={{
              padding: '5px',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            }}
            title="Generate new voice sample dialogue"
          >
            <RefreshCw size={13} />
          </button>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '5px',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            }}
            title="Close panel (Esc)"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Main Body with Large Visualizer Orb */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: '16px 14px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '14px',
          overflowY: 'auto',
        }}
      >
        {/* Pulsing Visualizer Orb */}
        <div
          style={{
            position: 'relative',
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isMuted
              ? 'rgba(239, 68, 68, 0.15)'
              : voiceState === 'listening'
              ? 'rgba(16, 185, 129, 0.15)'
              : voiceState === 'processing'
              ? 'rgba(99, 102, 241, 0.2)'
              : 'rgba(6, 182, 212, 0.2)',
            border: `2px solid ${
              isMuted
                ? 'rgba(239, 68, 68, 0.5)'
                : voiceState === 'listening'
                ? 'var(--accent-emerald)'
                : voiceState === 'processing'
                ? 'var(--accent-indigo)'
                : 'var(--accent-cyan)'
            }`,
            boxShadow:
              isMuted
                ? 'none'
                : `0 0 24px ${
                    voiceState === 'listening'
                      ? 'rgba(16, 185, 129, 0.4)'
                      : voiceState === 'processing'
                      ? 'rgba(99, 102, 241, 0.4)'
                      : 'rgba(6, 182, 212, 0.4)'
                  }`,
            transition: 'all 0.3s ease',
            cursor: 'pointer',
          }}
          onClick={handleToggleMute}
          title={isMuted ? 'Click to Unmute' : 'Click to Mute'}
        >
          {isMuted ? (
            <MicOff size={32} style={{ color: 'var(--accent-rose)' }} />
          ) : (
            <Mic
              size={32}
              style={{
                color:
                  voiceState === 'listening'
                    ? 'var(--accent-emerald)'
                    : voiceState === 'processing'
                    ? 'var(--accent-indigo)'
                    : 'var(--accent-cyan)',
              }}
            />
          )}
        </div>

        {/* State Label */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: isMuted
                ? 'var(--accent-rose)'
                : voiceState === 'listening'
                ? 'var(--accent-emerald)'
                : voiceState === 'processing'
                ? 'var(--accent-indigo)'
                : 'var(--accent-cyan)',
            }}
          >
            {isMuted
              ? 'Microphone is Muted'
              : voiceState === 'listening'
              ? 'Listening for speech (Simulated)...'
              : voiceState === 'processing'
              ? 'Synthesizing response context...'
              : 'Speaking AI voice response...'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            Click orb to toggle mute • Live frequency modulation
          </div>
        </div>

        {/* Live Simulated Dialogue Cards */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              fontSize: '11.5px',
              color: 'var(--text-secondary)',
            }}
          >
            {simulatedTranscript}
          </div>
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              backgroundColor: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              fontSize: '11.5px',
              color: '#c7d2fe',
            }}
          >
            {simulatedResponse}
          </div>
        </div>

        {/* Audio Controls */}
        <div
          style={{
            width: '100%',
            padding: '10px 12px',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {/* Gain Slider */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              <span>Microphone Sensitivity (Mock)</span>
              <span>{gain}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={gain}
              onChange={(e) => setGain(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent-emerald)', cursor: 'pointer' }}
            />
          </div>

          {/* Toggles */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>AI Noise Suppression (Mock)</span>
            <input
              type="checkbox"
              checked={noiseSuppression}
              onChange={(e) => setNoiseSuppression(e.target.checked)}
              style={{ accentColor: 'var(--accent-indigo)', cursor: 'pointer' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>Voice Activity Detection (VAD)</span>
            <input
              type="checkbox"
              checked={vadMode}
              onChange={(e) => setVadMode(e.target.checked)}
              style={{ accentColor: 'var(--accent-indigo)', cursor: 'pointer' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
