import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, ChevronDown, Check, Volume2 } from 'lucide-react';
import { MOCK_MICROPHONES } from '../data/mockData';

/**
 * MicDropdown Component
 * Provides microphone device selection, mute toggle, and input status.
 * Standardized to 32px height to match toolbar pill button proportions.
 */
export function MicDropdown({
  selectedMic,
  setSelectedMic,
  isMuted,
  setIsMuted,
  onNotify,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const currentDevice =
    MOCK_MICROPHONES.find((m) => m.id === selectedMic) || MOCK_MICROPHONES[0];

  const handleToggleMute = (e) => {
    e.stopPropagation();
    const nextState = !isMuted;
    setIsMuted(nextState);
    onNotify?.(nextState ? 'Microphone Muted' : 'Microphone Live');
  };

  const handleSelect = (micId) => {
    setSelectedMic(micId);
    setIsOpen(false);
    const chosen = MOCK_MICROPHONES.find((m) => m.id === micId);
    onNotify?.(`Microphone switched: ${chosen?.name.split(' (')[0] || 'Default'}`);
  };

  return (
    <div
      ref={dropdownRef}
      className="mic-dropdown-container"
      data-no-drag="true"
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
    >
      {/* Mic Pill Button */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: '32px',
          backgroundColor: isMuted ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg-pill)',
          border: `1px solid ${isMuted ? 'rgba(239, 68, 68, 0.4)' : 'var(--border-subtle)'}`,
          borderRadius: '9999px',
          padding: '0 8px 0 6px',
          gap: '5px',
          cursor: 'pointer',
          transition: 'all 0.18s ease',
          boxSizing: 'border-box',
        }}
        onClick={() => setIsOpen(!isOpen)}
        title="Microphone Settings & Device Selection"
      >
        {/* Mute / Unmute Button */}
        <button
          type="button"
          onClick={handleToggleMute}
          style={{
            color: isMuted ? 'var(--accent-rose)' : 'var(--accent-emerald)',
            padding: '4px',
            borderRadius: '9999px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title={isMuted ? 'Click to Unmute' : 'Click to Mute'}
        >
          {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
        </button>

        {/* Short Label */}
        <span
          style={{
            fontSize: '12px',
            fontWeight: 500,
            maxWidth: '92px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: isMuted ? 'var(--accent-rose)' : 'var(--text-primary)',
          }}
        >
          {isMuted ? 'Muted' : 'Mic Live'}
        </span>

        <ChevronDown
          size={13}
          style={{
            color: 'var(--text-secondary)',
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.18s ease',
          }}
        />
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="panel-animate-in"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            width: '270px',
            backgroundColor: 'rgba(20, 22, 28, 0.96)',
            backdropFilter: 'blur(24px)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            boxShadow: '0 16px 36px rgba(0, 0, 0, 0.7)',
            padding: '8px',
            zIndex: 10000,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 8px 8px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              marginBottom: '6px',
            }}
          >
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              AUDIO INPUT DEVICE
            </span>
            <span className="badge-mock">Mock Devices</span>
          </div>

          {/* List of Microphones */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {MOCK_MICROPHONES.map((mic) => {
              const isSelected = mic.id === selectedMic;
              return (
                <button
                  key={mic.id}
                  type="button"
                  onClick={() => handleSelect(mic.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: '8px',
                    textAlign: 'left',
                    backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                    border: isSelected ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                    <Volume2 size={13} style={{ color: isSelected ? 'var(--accent-indigo)' : 'var(--text-muted)' }} />
                    <span
                      style={{
                        fontSize: '12px',
                        color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {mic.name}
                    </span>
                  </div>
                  {isSelected && <Check size={14} style={{ color: 'var(--accent-indigo)', flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>

          {/* Simulated Input Gain Bar */}
          <div
            style={{
              marginTop: '8px',
              padding: '6px 8px',
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
              <span>Input Level (Simulated)</span>
              <span>{isMuted ? '0%' : '78%'}</span>
            </div>
            <div
              style={{
                width: '100%',
                height: '4px',
                borderRadius: '9999px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: isMuted ? '0%' : '78%',
                  height: '100%',
                  backgroundColor: 'var(--accent-emerald)',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
