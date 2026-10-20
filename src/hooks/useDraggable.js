import { useState, useRef, useEffect, useCallback } from 'react';
import { nativeStartDragging, isTauriEnvironment, setDraggingActive, isDraggingActive } from '../utils/tauriBridge';

/**
 * useDraggable hook:
 * Supports smooth dragging of the floating copilot toolbar across the desktop screen,
 * ensuring button clicks, dropdown selections, and input interactions are never broken.
 */
export function useDraggable({ initialX = 0, initialY = 40 } = {}) {
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, elemX: 0, elemY: 0 });
  const hasMovedRef = useRef(false);

  // Center horizontally on initial mount
  useEffect(() => {
    if (typeof window !== 'undefined' && initialX === 0) {
      const centerX = Math.max(20, (window.innerWidth - 680) / 2);
      setPosition({ x: centerX, y: initialY });
    }
  }, [initialX, initialY]);

  const onMouseDown = useCallback((e) => {
    // Only primary (left) mouse button triggers dragging
    if (e && e.button !== undefined && e.button !== 0) {
      return;
    }

    // Check if target or any parent is an interactive control
    if (e.target.closest('button, input, select, textarea, [data-no-drag], .no-drag')) {
      return;
    }

    // If Tauri native window dragging is available, trigger native drag
    if (isTauriEnvironment()) {
      nativeStartDragging(e);
      return;
    }

    // Web emulation drag handling
    isDraggingRef.current = true;
    setIsDragging(true);
    setDraggingActive(true);
    hasMovedRef.current = false;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      elemX: position.x,
      elemY: position.y,
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grab';

    const onMouseMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = moveEvent.clientX - dragStartRef.current.mouseX;
      const deltaY = moveEvent.clientY - dragStartRef.current.mouseY;

      if (Math.hypot(deltaX, deltaY) > 3) {
        hasMovedRef.current = true;
      }

      // Constrain within viewport boundaries with safety margin
      const newX = Math.max(12, Math.min(window.innerWidth - 120, dragStartRef.current.elemX + deltaX));
      const newY = Math.max(10, Math.min(window.innerHeight - 80, dragStartRef.current.elemY + deltaY));

      setPosition({ x: newX, y: newY });
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
      setDraggingActive(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [position]);

  const resetPosition = useCallback(() => {
    if (typeof window !== 'undefined') {
      const centerX = Math.max(20, (window.innerWidth - 680) / 2);
      setPosition({ x: centerX, y: 40 });
    }
  }, []);

  return {
    position,
    setPosition,
    onMouseDown,
    resetPosition,
    isDragging: isDragging || isDraggingActive(),
  };
}
