import { useEffect, useRef, useCallback } from 'react';
import {
  isTauriEnvironment,
  nativeSetIgnoreCursorEvents,
  getNativeCursorAndWindowBounds,
  isDraggingActive,
} from '../utils/tauriBridge.js';

/**
 * Checks whether a given client coordinate (in CSS pixels relative to the webview viewport)
 * intersects any interactive OmniPilot AI element.
 * 
 * Inspects:
 * 1. Primary UI bounding boxes (.glass-toolbar, .glass-panel, .panel-animate-in, .mic-dropdown-container)
 *    with a 6px comfort margin to prevent edge fluttering and support rapid target acquisition.
 * 2. DOM elementsFromPoint for interactive controls (buttons, inputs, dropdown menus).
 */
export function isPointInsideInteractiveUI(clientX, clientY) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  // Cursor is outside the Tauri window's bounds entirely
  if (
    clientX < 0 ||
    clientY < 0 ||
    clientX > window.innerWidth ||
    clientY > window.innerHeight
  ) {
    return false;
  }

  const ENTER_MARGIN = 6; // Comfort margin in CSS pixels

  // 1. Direct bounding rect check on all interactive UI containers
  const interactiveContainers = document.querySelectorAll(
    '.glass-toolbar, .glass-panel, .panel-animate-in, .mic-dropdown-container, [data-interactive-ui="true"]'
  );

  for (const container of interactiveContainers) {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    if (
      clientX >= rect.left - ENTER_MARGIN &&
      clientX <= rect.right + ENTER_MARGIN &&
      clientY >= rect.top - ENTER_MARGIN &&
      clientY <= rect.bottom + ENTER_MARGIN
    ) {
      return true;
    }
  }

  // 2. DOM hit-testing via elementsFromPoint for interactive controls & child popups
  try {
    const elements = document.elementsFromPoint(clientX, clientY) || [];
    for (const el of elements) {
      if (
        el.closest(
          '.glass-toolbar, .glass-panel, .panel-animate-in, .mic-dropdown-container, [data-interactive-ui="true"], [data-tauri-drag-region], button, input, select, textarea, [data-no-drag]'
        )
      ) {
        return true;
      }
    }
  } catch {
    // Fail safe on transient coordinate edge cases
  }

  return false;
}

/**
 * Custom hook to manage dynamic click-through behavior for the transparent desktop window.
 * 
 * - When pointer is outside all interactive UI elements: sets ignoreCursorEvents(true).
 * - When pointer enters the toolbar or an active panel: sets ignoreCursorEvents(false).
 * - Uses native cursor tracking when click-through is enabled so re-entry is reliably detected.
 * - Suppresses click-through during active window dragging.
 * - Handles focus, blur, shortcuts, and panel changes gracefully.
 */
export function useClickThrough({ activePanel = 'none', isMinimized = false, isDragging = false } = {}) {
  const isClickThroughRef = useRef(false);
  const exitTimerRef = useRef(null);
  const pollTimerRef = useRef(null);
  const isDraggingRef = useRef(isDragging);
  const activePanelRef = useRef(activePanel);

  isDraggingRef.current = isDragging;
  activePanelRef.current = activePanel;

  // Restore interaction immediately
  const makeInteractive = useCallback(() => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    if (isClickThroughRef.current) {
      isClickThroughRef.current = false;
      nativeSetIgnoreCursorEvents(false);
    }
  }, []);

  // Schedule transition to click-through with debounce to prevent border jitter
  const scheduleClickThrough = useCallback(() => {
    if (isDraggingRef.current || isDraggingActive()) {
      return;
    }
    if (exitTimerRef.current) return;

    exitTimerRef.current = setTimeout(async () => {
      exitTimerRef.current = null;
      if (isDraggingRef.current || isDraggingActive()) {
        return;
      }

      // Re-verify position before enabling click-through
      if (isTauriEnvironment()) {
        const bounds = await getNativeCursorAndWindowBounds();
        if (bounds) {
          const clientX = (bounds.cursorX - bounds.windowX) / bounds.scale;
          const clientY = (bounds.cursorY - bounds.windowY) / bounds.scale;
          if (isPointInsideInteractiveUI(clientX, clientY)) {
            return;
          }
        }
      }

      isClickThroughRef.current = true;
      nativeSetIgnoreCursorEvents(true);
    }, 55);
  }, []);

  // When activePanel opens, immediately restore interaction
  useEffect(() => {
    if (activePanel !== 'none') {
      makeInteractive();
    }
  }, [activePanel, makeInteractive]);

  // Main lifecycle effect for events and native polling
  useEffect(() => {
    if (!isTauriEnvironment()) {
      return;
    }

    let isDisposed = false;

    // DOM MouseMove handler when window is interactive
    function handleMouseMove(e) {
      if (isDraggingRef.current || isDraggingActive()) {
        makeInteractive();
        return;
      }

      const inside = isPointInsideInteractiveUI(e.clientX, e.clientY);
      if (inside) {
        makeInteractive();
      } else {
        scheduleClickThrough();
      }
    }

    function handleMouseLeave() {
      if (!isDraggingRef.current && !isDraggingActive()) {
        scheduleClickThrough();
      }
    }

    function handleWindowFocus() {
      makeInteractive();
    }

    function handleWindowBlur() {
      if (!isDraggingRef.current && !isDraggingActive()) {
        scheduleClickThrough();
      }
    }

    function handleKeyDown() {
      makeInteractive();
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('keydown', handleKeyDown, { passive: true });

    // Adaptive Native Cursor Tracking Loop
    // When click-through is enabled (ignore=true), OS stops sending mousemove events to the webview.
    // The native loop polls cursorPosition() and window bounds to detect re-entry.
    async function runNativeCheck() {
      if (isDisposed) return;

      const isClickThrough = isClickThroughRef.current;
      // High responsiveness (~65ms) when click-through is active; lower (~200ms) watchdog when interactive
      const nextDelay = isClickThrough ? 65 : 200;

      if (!isDraggingRef.current && !isDraggingActive()) {
        try {
          const bounds = await getNativeCursorAndWindowBounds();
          if (bounds && !isDisposed) {
            const clientX = (bounds.cursorX - bounds.windowX) / bounds.scale;
            const clientY = (bounds.cursorY - bounds.windowY) / bounds.scale;

            const inside = isPointInsideInteractiveUI(clientX, clientY);

            if (inside) {
              makeInteractive();
            } else if (!isClickThrough) {
              // Cursor moved out of window without DOM mousemove (e.g. fast jump)
              scheduleClickThrough();
            }
          }
        } catch {
          // Gracefully continue loop
        }
      }

      if (!isDisposed) {
        pollTimerRef.current = setTimeout(runNativeCheck, nextDelay);
      }
    }

    // Start native tracking loop
    pollTimerRef.current = setTimeout(runNativeCheck, 80);

    return () => {
      isDisposed = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      window.removeEventListener('mousemove', handleMouseMove);
      document.documentElement.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('keydown', handleKeyDown);

      // Restore interactive state on unmount
      nativeSetIgnoreCursorEvents(false);
    };
  }, [makeInteractive, scheduleClickThrough]);

  return {
    isClickThrough: isClickThroughRef.current,
    makeInteractive,
    scheduleClickThrough,
  };
}
