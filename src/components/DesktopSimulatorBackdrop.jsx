import React from 'react';

/**
 * DesktopSimulatorBackdrop
 * Clean neutral desktop canvas showcasing the floating toolbar and glassmorphism panels.
 * Removed the large code-editor backdrop as requested to keep the toolbar as the main focus.
 */
export function DesktopSimulatorBackdrop({ enabled = true }) {
  if (!enabled) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(10, 12, 16, 0.98)',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #11141c 0%, #0d0f14 50%, #131620 100%)',
      }}
    >
      {/* Soft, neutral Windows 11 ambient illumination */}
      <div
        style={{
          position: 'absolute',
          width: '900px',
          height: '600px',
          borderRadius: '50%',
          top: '-180px',
          left: 'calc(50% - 450px)',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.05) 0%, transparent 65%)',
          filter: 'blur(80px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: '650px',
          height: '450px',
          borderRadius: '50%',
          bottom: '-100px',
          right: '10%',
          background: 'radial-gradient(circle, rgba(6, 182, 212, 0.035) 0%, transparent 60%)',
          filter: 'blur(70px)',
        }}
      />

      {/* Subtle modern desktop grid pattern (very faint, neutral) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.12,
          backgroundImage:
            'radial-gradient(rgba(255, 255, 255, 0.15) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />
    </div>
  );
}
