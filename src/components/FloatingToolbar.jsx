import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Camera,
  MessageSquare,
  Radio,
  MoreHorizontal,
  Minus,
  Maximize2,
  GripVertical,
  Settings,
  Shield,
  RotateCcw,
  Monitor,
} from 'lucide-react';
import { AudioVisualizer } from './AudioVisualizer';
import { MicDropdown } from './MicDropdown';

export function FloatingToolbar({
  activePanel,
  setActivePanel,
  isMinimized,
  setIsMinimized,
  selectedMic,
  setSelectedMic,
  isMuted,
  setIsMuted,
  voiceActive,
  onResetPosition,
  toggleBackdrop,
  hasBackdrop,
  privacyMode,
  setPrivacyMode,
  alwaysOnTop,
  setAlwaysOnTop,
  onNotify,
  onDragMouseDown,
}) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setShowMoreMenu(false);
      }
    }
    if (showMoreMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMoreMenu]);

  const handleTogglePanel = (panelName, displayName, shortcut) => {
    setActivePanel((prev) => {
      const next = prev === panelName ? 'none' : panelName;
      if (next !== 'none') {
        onNotify?.(`${displayName} Opened (${shortcut})`);
      }
      return next;
    });
  };

  // Minimized Toolbar Pill
  if (isMinimized) {
    return (
      <div
        className="glass-toolbar"
        data-tauri-drag-region
        onMouseDown={(e) => {
          if (!e.target.closest('button, [data-no-drag]')) {
            onDragMouseDown?.(e);
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          height: '42px',
          padding: '0 12px 0 10px',
          cursor: 'grab',
          userSelect: 'none',
          boxSizing: 'border-box',
        }}
        title="OmniPilot AI Minimized • Drag window across desktop"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', pointerEvents: 'none' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: isMuted ? 'var(--accent-rose)' : 'var(--accent-emerald)',
              boxShadow: isMuted ? 'none' : '0 0 8px rgba(16, 185, 129, 0.8)',
              animation: isMuted ? 'none' : 'pulseGlow 2s infinite',
            }}
          />
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
            OmniPilot
          </span>
        </div>

        <button
          type="button"
          data-no-drag="true"
          onClick={(e) => {
            e.stopPropagation();
            setIsMinimized(false);
            onNotify?.('Toolbar Restored');
          }}
          style={{
            width: '26px',
            height: '26px',
            borderRadius: '9999px',
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Restore Toolbar"
        >
          <Maximize2 size={13} />
        </button>
      </div>
    );
  }

  // Refined Expanded Floating Toolbar
  return (
    <div
      className="glass-toolbar"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: '48px',
        padding: '0 8px 0 10px',
        gap: '8px',
        cursor: 'default',
        userSelect: 'none',
        boxSizing: 'border-box',
      }}
    >
      {/* Brand Badge & Drag Handle (Designated Draggable Area) */}
      <div
        data-tauri-drag-region
        onMouseDown={onDragMouseDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 6px 4px 2px',
          borderRadius: '9999px',
          cursor: 'grab',
          userSelect: 'none',
        }}
        title="OmniPilot AI • Drag window across desktop"
      >
        <GripVertical size={15} style={{ color: 'var(--text-muted)', opacity: 0.8 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', pointerEvents: 'none' }}>
          <div
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: 'var(--accent-indigo)',
              boxShadow: '0 0 6px rgba(99, 102, 241, 0.8)',
            }}
          />
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              letterSpacing: '0.02em',
            }}
          >
            OmniPilot
          </span>
        </div>
      </div>

      {/* Audio Visualizer */}
      <div data-no-drag="true" style={{ display: 'flex', alignItems: 'center' }}>
        <AudioVisualizer
          state={isMuted ? 'muted' : voiceActive ? 'active' : 'idle'}
          isMuted={isMuted}
          barCount={6}
        />
      </div>

      {/* Microphone Dropdown Selector */}
      <MicDropdown
        selectedMic={selectedMic}
        setSelectedMic={setSelectedMic}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        onNotify={onNotify}
      />

      {/* Section Divider */}
      <div
        style={{
          width: '1px',
          height: '20px',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          margin: '0 1px',
        }}
      />

      {/* Action 1: AI Answer Button */}
      <div className="tooltip-wrapper" data-no-drag="true">
        <button
          type="button"
          onClick={() => handleTogglePanel('answer', 'AI Answer', 'Ctrl+Q')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: '32px',
            gap: '6px',
            padding: '0 12px',
            borderRadius: '9999px',
            backgroundColor: activePanel === 'answer' ? 'var(--bg-pill-active)' : 'var(--bg-pill)',
            border: activePanel === 'answer' ? '1px solid var(--border-pill-active)' : '1px solid var(--border-subtle)',
            color: activePanel === 'answer' ? '#ffffff' : 'var(--text-primary)',
            fontSize: '12.5px',
            fontWeight: 500,
            boxShadow: activePanel === 'answer' ? 'var(--shadow-glow)' : 'none',
            boxSizing: 'border-box',
          }}
          onMouseEnter={(e) => {
            if (activePanel !== 'answer') {
              e.currentTarget.style.backgroundColor = 'var(--bg-pill-hover)';
              e.currentTarget.style.borderColor = 'var(--border-hover)';
            }
          }}
          onMouseLeave={(e) => {
            if (activePanel !== 'answer') {
              e.currentTarget.style.backgroundColor = 'var(--bg-pill)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }
          }}
        >
          <Sparkles size={15} style={{ color: 'var(--accent-indigo)' }} />
          <span>AI Answer</span>
        </button>
        <div className="tooltip-box">
          <span>AI Answer Instant Drawer</span>
          <span className="tooltip-shortcut">Ctrl+Q</span>
        </div>
      </div>

      {/* Action 2: Screenshot Button */}
      <div className="tooltip-wrapper" data-no-drag="true">
        <button
          type="button"
          onClick={() => handleTogglePanel('screenshot', 'Screenshot Inspector', 'Ctrl+Shift+S')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: '32px',
            gap: '6px',
            padding: '0 12px',
            borderRadius: '9999px',
            backgroundColor: activePanel === 'screenshot' ? 'rgba(6, 182, 212, 0.22)' : 'var(--bg-pill)',
            border: activePanel === 'screenshot' ? '1px solid rgba(6, 182, 212, 0.5)' : '1px solid var(--border-subtle)',
            color: activePanel === 'screenshot' ? '#ffffff' : 'var(--text-primary)',
            fontSize: '12.5px',
            fontWeight: 500,
            boxShadow: activePanel === 'screenshot' ? '0 0 16px -2px rgba(6, 182, 212, 0.45)' : 'none',
            boxSizing: 'border-box',
          }}
          onMouseEnter={(e) => {
            if (activePanel !== 'screenshot') {
              e.currentTarget.style.backgroundColor = 'var(--bg-pill-hover)';
              e.currentTarget.style.borderColor = 'var(--border-hover)';
            }
          }}
          onMouseLeave={(e) => {
            if (activePanel !== 'screenshot') {
              e.currentTarget.style.backgroundColor = 'var(--bg-pill)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }
          }}
        >
          <Camera size={15} style={{ color: 'var(--accent-cyan)' }} />
          <span>Screenshot</span>
        </button>
        <div className="tooltip-box">
          <span>Screenshot & OCR Inspector</span>
          <span className="tooltip-shortcut">Ctrl+Shift+S</span>
        </div>
      </div>

      {/* Action 3: Chat Button */}
      <div className="tooltip-wrapper" data-no-drag="true">
        <button
          type="button"
          onClick={() => handleTogglePanel('chat', 'Chat Drawer', 'Ctrl+Shift+C')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: '32px',
            gap: '6px',
            padding: '0 12px',
            borderRadius: '9999px',
            backgroundColor: activePanel === 'chat' ? 'var(--bg-pill-active)' : 'var(--bg-pill)',
            border: activePanel === 'chat' ? '1px solid var(--border-pill-active)' : '1px solid var(--border-subtle)',
            color: activePanel === 'chat' ? '#ffffff' : 'var(--text-primary)',
            fontSize: '12.5px',
            fontWeight: 500,
            boxShadow: activePanel === 'chat' ? 'var(--shadow-glow)' : 'none',
            boxSizing: 'border-box',
          }}
          onMouseEnter={(e) => {
            if (activePanel !== 'chat') {
              e.currentTarget.style.backgroundColor = 'var(--bg-pill-hover)';
              e.currentTarget.style.borderColor = 'var(--border-hover)';
            }
          }}
          onMouseLeave={(e) => {
            if (activePanel !== 'chat') {
              e.currentTarget.style.backgroundColor = 'var(--bg-pill)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }
          }}
        >
          <MessageSquare size={15} style={{ color: 'var(--accent-indigo)' }} />
          <span>Chat</span>
        </button>
        <div className="tooltip-box">
          <span>Interactive Chat Drawer</span>
          <span className="tooltip-shortcut">Ctrl+Shift+C</span>
        </div>
      </div>

      {/* Action 4: Voice Assistant Button */}
      <div className="tooltip-wrapper" data-no-drag="true">
        <button
          type="button"
          onClick={() => handleTogglePanel('voice', 'Voice Intelligence', 'Voice')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            borderRadius: '9999px',
            backgroundColor: activePanel === 'voice' ? 'rgba(16, 185, 129, 0.22)' : 'var(--bg-pill)',
            border: activePanel === 'voice' ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid var(--border-subtle)',
            color: activePanel === 'voice' ? 'var(--accent-emerald)' : 'var(--text-secondary)',
            boxSizing: 'border-box',
          }}
          onMouseEnter={(e) => {
            if (activePanel !== 'voice') {
              e.currentTarget.style.backgroundColor = 'var(--bg-pill-hover)';
              e.currentTarget.style.borderColor = 'var(--border-hover)';
            }
          }}
          onMouseLeave={(e) => {
            if (activePanel !== 'voice') {
              e.currentTarget.style.backgroundColor = 'var(--bg-pill)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }
          }}
        >
          <Radio size={15} />
        </button>
        <div className="tooltip-box">
          <span>Voice Intelligence Panel</span>
        </div>
      </div>

      {/* Section Divider */}
      <div
        style={{
          width: '1px',
          height: '20px',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          margin: '0 1px',
        }}
      />

      {/* More Options Dropdown (...) */}
      <div ref={moreMenuRef} className="tooltip-wrapper" data-no-drag="true" style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setShowMoreMenu(!showMoreMenu)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            borderRadius: '9999px',
            backgroundColor: showMoreMenu ? 'rgba(255, 255, 255, 0.14)' : 'var(--bg-pill)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
            boxSizing: 'border-box',
          }}
          title="More options & preferences"
        >
          <MoreHorizontal size={15} />
        </button>

        {showMoreMenu && (
          <div
            className="panel-animate-in"
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              width: '240px',
              backgroundColor: 'rgba(20, 22, 28, 0.96)',
              backdropFilter: 'blur(24px)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              boxShadow: '0 16px 36px rgba(0, 0, 0, 0.7)',
              padding: '6px',
              zIndex: 10000,
            }}
          >
            {/* Settings */}
            <button
              type="button"
              onClick={() => {
                setShowMoreMenu(false);
                handleTogglePanel('settings', 'Preferences', 'Settings');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Settings size={14} style={{ color: 'var(--text-secondary)' }} />
              <span>Preferences & Themes</span>
            </button>

            {/* Toggle Privacy Mode Preview */}
            <button
              type="button"
              onClick={() => {
                const next = !privacyMode;
                setPrivacyMode(next);
                setShowMoreMenu(false);
                onNotify?.(next ? 'Privacy Mode Preview: Active' : 'Privacy Mode: Inactive');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Shield size={14} style={{ color: privacyMode ? 'var(--accent-amber)' : 'var(--text-secondary)' }} />
                <span>Simulated Privacy Mode</span>
              </div>
              <span className={privacyMode ? 'badge-mock' : ''} style={{ fontSize: '9px' }}>
                {privacyMode ? 'ON' : 'OFF'}
              </span>
            </button>

            {/* Always on top toggle */}
            <button
              type="button"
              onClick={() => {
                const next = !alwaysOnTop;
                setAlwaysOnTop(next);
                setShowMoreMenu(false);
                onNotify?.(next ? 'Always on Top Enabled' : 'Always on Top Disabled');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Monitor size={14} style={{ color: 'var(--text-secondary)' }} />
                <span>Always on Top</span>
              </div>
              <span style={{ fontSize: '11px', color: alwaysOnTop ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                {alwaysOnTop ? 'Yes' : 'No'}
              </span>
            </button>

            {/* Toggle Desktop Simulator Backdrop */}
            <button
              type="button"
              onClick={() => {
                toggleBackdrop?.();
                setShowMoreMenu(false);
                onNotify?.(hasBackdrop ? 'Transparent Canvas Mode' : 'Neutral Desktop Canvas Mode');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Monitor size={14} style={{ color: 'var(--accent-cyan)' }} />
              <span>{hasBackdrop ? 'Hide Desktop Canvas' : 'Show Desktop Canvas'}</span>
            </button>

            {/* Reset Position */}
            <button
              type="button"
              onClick={() => {
                onResetPosition?.();
                setShowMoreMenu(false);
                onNotify?.('Toolbar Position Reset to Center');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                color: 'var(--text-primary)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <RotateCcw size={14} style={{ color: 'var(--text-secondary)' }} />
              <span>Reset Position</span>
            </button>

            {/* Divider */}
            <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.06)', margin: '4px 0' }} />

            {/* About note */}
            <div style={{ padding: '4px 10px', fontSize: '10px', color: 'var(--text-muted)' }}>
              OmniPilot AI • Phase 1 Desktop
            </div>
          </div>
        )}
      </div>

      {/* Minimize Button */}
      <div className="tooltip-wrapper" data-no-drag="true">
        <button
          type="button"
          onClick={() => {
            setIsMinimized(true);
            onNotify?.('Toolbar Minimized');
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            borderRadius: '9999px',
            backgroundColor: 'var(--bg-pill)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
            boxSizing: 'border-box',
          }}
          title="Minimize Toolbar"
        >
          <Minus size={15} />
        </button>
        <div className="tooltip-box">
          <span>Minimize Toolbar</span>
        </div>
      </div>
    </div>
  );
}
