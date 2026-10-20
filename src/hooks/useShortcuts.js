import { useEffect } from 'react';
import { nativeSetIgnoreCursorEvents } from '../utils/tauriBridge';

/**
 * Global Keyboard Shortcut Hook
 * Mapped proposed shortcuts:
 * - Ctrl+Q: AI Answer
 * - Ctrl+Shift+S: Screenshot Inspector
 * - Ctrl+Shift+C: Interactive Chat
 * - Esc: Dismiss current active panel
 */
export function useShortcuts({ activePanel, setActivePanel, onTriggerNotification }) {
  useEffect(() => {
    function handleKeyDown(e) {
      // Don't intercept normal typing when an input is focused,
      // EXCEPT when modifier chords like Ctrl+Q or Ctrl+Shift+S are explicitly pressed
      const isInputFocused = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // 1. Ctrl + Q -> AI Answer
      if (isCtrlOrCmd && !e.shiftKey && (e.key === 'q' || e.key === 'Q')) {
        e.preventDefault();
        e.stopPropagation();
        nativeSetIgnoreCursorEvents(false);
        setActivePanel((prev) => {
          const next = prev === 'answer' ? 'none' : 'answer';
          onTriggerNotification?.(next === 'answer' ? 'AI Answer Opened (Ctrl+Q)' : 'Panel Closed');
          return next;
        });
        return;
      }

      // 2. Ctrl + Shift + S -> Screenshot
      if (isCtrlOrCmd && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        nativeSetIgnoreCursorEvents(false);
        setActivePanel((prev) => {
          const next = prev === 'screenshot' ? 'none' : 'screenshot';
          onTriggerNotification?.(next === 'screenshot' ? 'Screenshot Inspector Opened (Ctrl+Shift+S)' : 'Panel Closed');
          return next;
        });
        return;
      }

      // 3. Ctrl + Shift + C -> Chat
      if (isCtrlOrCmd && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        e.stopPropagation();
        nativeSetIgnoreCursorEvents(false);
        setActivePanel((prev) => {
          const next = prev === 'chat' ? 'none' : 'chat';
          onTriggerNotification?.(next === 'chat' ? 'Chat Drawer Opened (Ctrl+Shift+C)' : 'Panel Closed');
          return next;
        });
        return;
      }

      // 4. Escape -> Close any active panel
      if (e.key === 'Escape') {
        if (activePanel !== 'none') {
          e.preventDefault();
          setActivePanel('none');
          onTriggerNotification?.('Panel Closed (Esc)');
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePanel, setActivePanel, onTriggerNotification]);
}
