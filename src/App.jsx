import React, { useState, useEffect, useCallback } from 'react';
import { FloatingToolbar } from './components/FloatingToolbar';
import { AnswerPanel } from './components/Panels/AnswerPanel';
import { ScreenshotPanel } from './components/Panels/ScreenshotPanel';
import { ChatPanel } from './components/Panels/ChatPanel';
import { VoicePanel } from './components/Panels/VoicePanel';
import { SettingsPanel } from './components/Panels/SettingsPanel';
import { NotificationToast } from './components/NotificationToast';
import { DesktopSimulatorBackdrop } from './components/DesktopSimulatorBackdrop';
import { useShortcuts } from './hooks/useShortcuts';
import { useDraggable } from './hooks/useDraggable';
import { useClickThrough } from './hooks/useClickThrough';
import { nativeSetAlwaysOnTop } from './utils/tauriBridge';

export function App() {
  // Panel state: 'none' | 'answer' | 'screenshot' | 'chat' | 'voice' | 'settings'
  const [activePanel, setActivePanel] = useState('none');
  const [isMinimized, setIsMinimized] = useState(false);

  // Audio / Mic states
  const [selectedMic, setSelectedMic] = useState('default');
  const [isMuted, setIsMuted] = useState(false);

  // App Preferences
  const [theme, setTheme] = useState('charcoal');
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [hasBackdrop, setHasBackdrop] = useState(false);

  // Toast feedback state
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  const notify = useCallback((msg) => {
    setToastMessage(msg);
    setToastVisible(true);
    const timer = setTimeout(() => {
      setToastVisible(false);
    }, 2200);
    return () => clearTimeout(timer);
  }, []);

  // Keyboard Shortcuts Hook
  useShortcuts({
    activePanel,
    setActivePanel,
    onTriggerNotification: notify,
  });

  // Draggable Toolbar Hook
  const { position, onMouseDown, resetPosition, isDragging } = useDraggable({
    initialY: 30,
  });

  // Dynamic Click-Through Hook
  useClickThrough({
    activePanel,
    isMinimized,
    isDragging,
  });

  // Theme synchronization with DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Always on top preference sync
  useEffect(() => {
    nativeSetAlwaysOnTop(alwaysOnTop);
  }, [alwaysOnTop]);

  // Calculate panel placement relative to toolbar, bounded to viewport
  const getPanelPosition = () => {
    const margin = 16;
    const panelWidth = 470;
    const panelHeight = 520;

    let targetX = position.x;
    let targetY = position.y + (isMinimized ? 46 : 56);

    // Keep panel within screen bounds
    if (typeof window !== 'undefined') {
      if (targetX + panelWidth > window.innerWidth - margin) {
        targetX = Math.max(margin, window.innerWidth - panelWidth - margin);
      }
      if (targetY + panelHeight > window.innerHeight - margin) {
        // If overflowing bottom, anchor above toolbar if space allows
        if (position.y > panelHeight + margin) {
          targetY = position.y - panelHeight - 12;
        } else {
          targetY = Math.max(margin, window.innerHeight - panelHeight - margin);
        }
      }
    }

    return { x: Math.max(margin, targetX), y: Math.max(margin, targetY) };
  };

  const panelPos = getPanelPosition();

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background Wallpaper Simulator (for rich glassmorphism visualization) */}


      {/* Floating Toolbar Container */}
      <div
        data-interactive-ui="true"
        style={{
          position: 'absolute',
          left: `${position.x}px`,
          top: `${position.y}px`,
          zIndex: 10000,
        }}
      >
        <FloatingToolbar
          onDragMouseDown={onMouseDown}
          activePanel={activePanel}
          setActivePanel={setActivePanel}
          isMinimized={isMinimized}
          setIsMinimized={setIsMinimized}
          selectedMic={selectedMic}
          setSelectedMic={setSelectedMic}
          isMuted={isMuted}
          setIsMuted={setIsMuted}
          voiceActive={activePanel === 'voice'}
          onResetPosition={resetPosition}
          toggleBackdrop={() => setHasBackdrop(!hasBackdrop)}
          hasBackdrop={hasBackdrop}
          privacyMode={privacyMode}
          setPrivacyMode={setPrivacyMode}
          alwaysOnTop={alwaysOnTop}
          setAlwaysOnTop={setAlwaysOnTop}
          onNotify={notify}
        />
      </div>

      {/* Single Active Floating Panel (Prevents duplicate instances) */}
      {activePanel !== 'none' && (
        <div
          data-interactive-ui="true"
          style={{
            position: 'absolute',
            left: `${panelPos.x}px`,
            top: `${panelPos.y}px`,
            zIndex: 9990,
          }}
        >
          {activePanel === 'answer' && (
            <AnswerPanel
              onClose={() => setActivePanel('none')}
              onOpenChat={() => setActivePanel('chat')}
              onOpenSettings={() => setActivePanel('settings')}
              onNotify={notify}
            />
          )}

          {activePanel === 'screenshot' && (
            <ScreenshotPanel
              onClose={() => setActivePanel('none')}
              onNotify={notify}
            />
          )}

          {activePanel === 'chat' && (
            <ChatPanel
              onClose={() => setActivePanel('none')}
              onOpenSettings={() => setActivePanel('settings')}
              onNotify={notify}
            />
          )}

          {activePanel === 'voice' && (
            <VoicePanel
              onClose={() => setActivePanel('none')}
              onNotify={notify}
              isMuted={isMuted}
              setIsMuted={setIsMuted}
            />
          )}

          {activePanel === 'settings' && (
            <SettingsPanel
              onClose={() => setActivePanel('none')}
              theme={theme}
              setTheme={setTheme}
              alwaysOnTop={alwaysOnTop}
              setAlwaysOnTop={setAlwaysOnTop}
              privacyMode={privacyMode}
              setPrivacyMode={setPrivacyMode}
              onNotify={notify}
            />
          )}
        </div>
      )}

      {/* Quick Action Notification Toast */}
      <NotificationToast message={toastMessage} isVisible={toastVisible} />
    </div>
  );
}
export default App;
