import React, { useState } from 'react';
import { Camera, Crop, Copy, Check, RotateCw, X, Trash2, Eye, FileText, AlertTriangle, Crosshair } from 'lucide-react';
import { MOCK_SCREENSHOT_DATA } from '../../data/mockData';

export function ScreenshotPanel({ onClose, onNotify }) {
  const [data, setData] = useState(MOCK_SCREENSHOT_DATA);
  const [activeTab, setActiveTab] = useState('preview'); // 'preview' | 'ocr' | 'insights'
  const [copied, setCopied] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cropMode, setCropMode] = useState(false);

  const handleRetake = () => {
    setIsCapturing(true);
    setCropMode(false);
    onNotify?.('Simulating active screen capture buffer...');
    setTimeout(() => {
      setIsCapturing(false);
      setData({
        ...MOCK_SCREENSHOT_DATA,
        timestamp: new Date().toLocaleTimeString(),
      });
      onNotify?.('New mock screen capture loaded');
    }, 600);
  };

  const handleToggleCrop = () => {
    const nextState = !cropMode;
    setCropMode(nextState);
    if (nextState) {
      onNotify?.('Mock Crop Region: Active [X: 42, Y: 60, 380x210]');
    } else {
      onNotify?.('Full Window Capture Restored');
    }
  };

  const handleCopyOcr = () => {
    navigator.clipboard?.writeText(data.ocrText);
    setCopied(true);
    onNotify?.('Extracted OCR text copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    onNotify?.('Cleared screenshot buffer');
    onClose?.();
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
      {/* Panel Header */}
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
              backgroundColor: 'rgba(6, 182, 212, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-cyan)',
            }}
          >
            <Camera size={14} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>Visual Screen Inspector</span>
              <span className="badge-mock">Mock Capture Buffer</span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            onClick={handleRetake}
            disabled={isCapturing}
            style={{
              padding: '5px',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            }}
            title="Retake screen capture (Simulated)"
          >
            <RotateCw size={13} className={isCapturing ? 'animate-spin' : ''} />
          </button>

          <button
            type="button"
            onClick={handleCopyOcr}
            style={{
              padding: '5px',
              borderRadius: '6px',
              color: copied ? 'var(--accent-emerald)' : 'var(--text-secondary)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            }}
            title="Copy extracted text (OCR)"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>

          <button
            type="button"
            onClick={handleClear}
            style={{
              padding: '5px',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            }}
            title="Clear capture buffer"
          >
            <Trash2 size={13} />
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

      {/* Tabs / Subheader */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px',
          backgroundColor: 'rgba(0, 0, 0, 0.22)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        }}
      >
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('preview')}
            style={{
              padding: '3px 10px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 500,
              backgroundColor: activeTab === 'preview' ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
              color: activeTab === 'preview' ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            <Eye size={12} style={{ marginRight: '5px' }} />
            Preview Canvas
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ocr')}
            style={{
              padding: '3px 10px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 500,
              backgroundColor: activeTab === 'ocr' ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
              color: activeTab === 'ocr' ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            <FileText size={12} style={{ marginRight: '5px' }} />
            Extracted Code / OCR
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('insights')}
            style={{
              padding: '3px 10px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 500,
              backgroundColor: activeTab === 'insights' ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
              color: activeTab === 'insights' ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            AI Insights ({data.insights.length})
          </button>
        </div>

        <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{data.resolution}</span>
      </div>

      {/* Content Area - Scrolls Independently */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: '14px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {isCapturing ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <div
              style={{
                display: 'inline-block',
                width: '20px',
                height: '20px',
                border: '2px solid var(--accent-cyan)',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                marginBottom: '10px',
              }}
            />
            <div>Freezing screen viewport buffer...</div>
          </div>
        ) : activeTab === 'preview' ? (
          <>
            {/* Visual Screenshot Mock Display (Constrained overflow) */}
            <div
              style={{
                position: 'relative',
                borderRadius: '10px',
                overflow: 'hidden',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                backgroundColor: '#181b22',
                aspectRatio: '16 / 9',
                maxHeight: '190px',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Mock Window Title Bar */}
              <div
                style={{
                  height: '22px',
                  backgroundColor: '#12141a',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 8px',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div style={{ display: 'flex', gap: '5px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                </div>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{data.detectedWindow}</span>
                <span style={{ fontSize: '9px', color: cropMode ? 'var(--accent-amber)' : 'var(--accent-cyan)' }}>
                  {cropMode ? 'Custom Crop Box' : 'Full Frame'}
                </span>
              </div>

              {/* Mock Code Screen Body */}
              <div
                style={{
                  padding: '10px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  lineHeight: '1.45',
                  color: '#93c5fd',
                  flex: 1,
                  position: 'relative',
                  background: 'linear-gradient(180deg, #161820 0%, #11131a 100%)',
                  overflow: 'hidden',
                }}
              >
                <div style={{ color: '#64748b' }}>// Active window frame ({data.timestamp})</div>
                <div><span style={{ color: '#f43f5e' }}>import</span> React, &#123; useState &#125; <span style={{ color: '#f43f5e' }}>from</span> <span style={{ color: '#a7f3d0' }}>'react'</span>;</div>
                <div><span style={{ color: '#f43f5e' }}>import</span> &#123; FloatingToolbar &#125; <span style={{ color: '#f43f5e' }}>from</span> <span style={{ color: '#a7f3d0' }}>'./components/FloatingToolbar'</span>;</div>
                <br />
                <div><span style={{ color: '#818cf8' }}>export function</span> <span style={{ color: '#fbbf24' }}>App</span>() &#123;</div>
                <div>&nbsp;&nbsp;<span style={{ color: '#818cf8' }}>const</span> [activePanel, setActivePanel] = useState(<span style={{ color: '#a7f3d0' }}>'none'</span>);</div>
                <div>&nbsp;&nbsp;<span style={{ color: '#f43f5e' }}>return</span> &lt;<span style={{ color: '#38bdf8' }}>FloatingToolbar</span> /&gt;;</div>
                <div>&#125;</div>

                {/* Simulated Bounding Box Overlay */}
                <div
                  style={{
                    position: 'absolute',
                    top: cropMode ? '24px' : '30px',
                    left: cropMode ? '25px' : '10px',
                    right: cropMode ? '80px' : '35px',
                    bottom: cropMode ? '16px' : '10px',
                    border: `1.5px dashed ${cropMode ? 'var(--accent-amber)' : 'var(--accent-cyan)'}`,
                    backgroundColor: cropMode ? 'rgba(245, 158, 11, 0.08)' : 'rgba(6, 182, 212, 0.08)',
                    borderRadius: '4px',
                    pointerEvents: 'none',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    padding: '4px',
                    transition: 'all 0.25s ease',
                  }}
                >
                  <span
                    style={{
                      background: cropMode ? 'var(--accent-amber)' : 'var(--accent-cyan)',
                      color: '#000',
                      fontSize: '9px',
                      fontWeight: 700,
                      padding: '1px 4px',
                      borderRadius: '3px',
                      height: 'fit-content',
                    }}
                  >
                    {cropMode ? 'CROP REGION' : 'FOCUS REGION'}
                  </span>
                </div>
              </div>
            </div>

            {/* Region Selection Action Buttons */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={handleToggleCrop}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '7px 12px',
                  borderRadius: '8px',
                  backgroundColor: cropMode ? 'rgba(245, 158, 11, 0.18)' : 'rgba(255, 255, 255, 0.06)',
                  border: `1px solid ${cropMode ? 'rgba(245, 158, 11, 0.45)' : 'var(--border-subtle)'}`,
                  color: cropMode ? '#fbbf24' : 'var(--text-primary)',
                  fontSize: '11.5px',
                  fontWeight: 500,
                }}
              >
                <Crosshair size={13} />
                <span>{cropMode ? 'Reset to Full Window' : 'Select Custom Crop Area (Mock)'}</span>
              </button>
              <button
                type="button"
                onClick={handleCopyOcr}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 12px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(6, 182, 212, 0.15)',
                  border: '1px solid rgba(6, 182, 212, 0.3)',
                  color: 'var(--accent-cyan)',
                  fontSize: '11.5px',
                  fontWeight: 500,
                }}
              >
                {copied ? <Check size={13} /> : <FileText size={13} />}
                <span>{copied ? 'Copied' : 'Extract Text'}</span>
              </button>
            </div>
          </>
        ) : activeTab === 'ocr' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                RECOGNIZED TEXT BUFFER (OCR SIMULATION)
              </span>
              <button
                type="button"
                onClick={handleCopyOcr}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  color: copied ? 'var(--accent-emerald)' : 'var(--accent-cyan)',
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied ? 'Copied to Clipboard' : 'Copy Text'}</span>
              </button>
            </div>
            <pre className="code-container" style={{ maxHeight: '200px', overflowX: 'auto', whiteSpace: 'pre' }}>
              <code>{data.ocrText}</code>
            </pre>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>
              DETECTED SCREEN CONTEXT:
            </div>
            {data.insights.map((insight, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  padding: '8px 10px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              >
                <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>#{idx + 1}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{insight}</span>
              </div>
            ))}
          </div>
        )}

        {/* Phase 1 Limitation Notice */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            padding: '8px 10px',
            borderRadius: '8px',
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            fontSize: '11px',
            color: '#fbbf24',
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            <strong>Phase 1 Mock Buffer:</strong> Real display capture and native Windows Graphics Capture / exclusion APIs are planned for Phase 2.
          </span>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          flexShrink: 0,
          padding: '8px 14px',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '11px',
          color: 'var(--text-muted)',
        }}
      >
        <span>Active Target: {data.detectedWindow}</span>
        <span>Shortcuts: Ctrl+Shift+S</span>
      </div>
    </div>
  );
}
