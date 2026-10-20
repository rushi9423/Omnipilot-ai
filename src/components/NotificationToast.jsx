import React from 'react';
import { Info } from 'lucide-react';

export function NotificationToast({ message, isVisible }) {
  if (!isVisible || !message) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'rgba(18, 20, 26, 0.95)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        padding: '6px 14px',
        borderRadius: '9999px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '11.5px',
        fontWeight: 500,
        color: 'var(--text-primary)',
        zIndex: 99999,
        pointerEvents: 'none',
        animation: 'panelFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: 'var(--accent-indigo)',
        }}
      />
      <span>{message}</span>
    </div>
  );
}
