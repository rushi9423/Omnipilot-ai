import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Copy,
  Check,
  RotateCw,
  X,
  Trash2,
  ArrowUpRight,
  MessageSquare,
  Square,
  Send,
  AlertCircle,
  Settings as SettingsIcon,
  Zap,
  ExternalLink,
  CreditCard,
} from 'lucide-react';
import {
  nativeGetAiReadiness,
  nativeStreamAiAnswer,
  nativeCancelStream,
} from '../../utils/tauriBridge';

const SAMPLE_STARTER_PROMPTS = [
  'Explain Rust Tauri 2 IPC Channel streaming patterns.',
  'How to optimize acrylic glass rendering in Windows 11?',
  'What are the security benefits of Windows Credential Manager?',
];

export function AnswerPanel({ onClose, onOpenChat, onOpenSettings, onNotify }) {
  const [prompt, setPrompt] = useState('Explain Rust Tauri 2 IPC Channel streaming patterns.');
  const [inputPrompt, setInputPrompt] = useState('');
  const [streamedText, setStreamedText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState(null);
  const [error, setError] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const contentEndRef = useRef(null);

  // Load readiness status on mount
  useEffect(() => {
    let isMounted = true;
    nativeGetAiReadiness()
      .then((status) => {
        if (isMounted) setAiStatus(status);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  // Auto-scroll while streaming
  useEffect(() => {
    if (isStreaming && contentEndRef.current) {
      contentEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [streamedText, isStreaming]);

  // Clean up active stream on unmount
  useEffect(() => {
    return () => {
      if (activeRequestId) {
        nativeCancelStream(activeRequestId).catch(() => {});
      }
    };
  }, [activeRequestId]);

  const handleStartStream = async (promptToUse) => {
    const targetPrompt = (promptToUse || inputPrompt || prompt).trim();
    if (!targetPrompt) return;

    // Prevent duplicate submission
    if (isStreaming) return;

    setPrompt(targetPrompt);
    setInputPrompt('');
    setStreamedText('');
    setError(null);
    setIsStreaming(true);

    const requestId = `ans-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setActiveRequestId(requestId);

    let activeModel = aiStatus?.model;
    try {
      const freshStatus = await nativeGetAiReadiness();
      setAiStatus(freshStatus);
      activeModel =
        freshStatus?.model ||
        (freshStatus?.provider === 'openai'
          ? 'gpt-4o-mini'
          : freshStatus?.provider === 'ollama'
          ? 'qwen2.5-coder:3b'
          : 'gemini-3.8-flash');
    } catch {
      activeModel =
        activeModel ||
        (aiStatus?.provider === 'openai'
          ? 'gpt-4o-mini'
          : aiStatus?.provider === 'ollama'
          ? 'qwen2.5-coder:3b'
          : 'gemini-3.8-flash');
    }

    try {
      await nativeStreamAiAnswer({
        requestId,
        prompt: targetPrompt,
        model: activeModel,
        onChunk: (chunk) => {
          setError(null);
          setStreamedText((prev) => prev + chunk);
        },
        onDone: () => {
          setIsStreaming(false);
          setActiveRequestId(null);
          setError(null);
          onNotify?.('AI answer completed');
        },
        onError: (errMsg) => {
          setIsStreaming(false);
          setActiveRequestId(null);
          setError(errMsg || 'Streaming failed');
          onNotify?.('Streaming failed: ' + (errMsg || 'Error'));
        },
        onCancelled: () => {
          setIsStreaming(false);
          setActiveRequestId(null);
          onNotify?.('Generation stopped');
        },
      });
    } catch (err) {
      setIsStreaming(false);
      setActiveRequestId(null);
      const msg = err?.message || String(err);
      setError(msg);
      onNotify?.(`Request failed: ${msg}`);
    }
  };

  const handleStop = async () => {
    if (activeRequestId) {
      await nativeCancelStream(activeRequestId);
      setIsStreaming(false);
      setActiveRequestId(null);
      onNotify?.('Generation cancelled by user');
    }
  };

  const handleRetry = () => {
    if (isStreaming) return;
    handleStartStream(prompt);
  };

  const handleCopyAnswer = () => {
    if (!streamedText) return;
    navigator.clipboard?.writeText(streamedText);
    setCopied(true);
    onNotify?.('Answer copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyCodeSnippet = (code) => {
    navigator.clipboard?.writeText(code);
    setCodeCopied(true);
    onNotify?.('Code snippet copied');
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const handleClear = () => {
    if (isStreaming) {
      handleStop();
    }
    setStreamedText('');
    setError(null);
    onNotify?.('Cleared answer');
  };

  // Helper to parse code blocks out of streamed text
  const renderFormattedContent = () => {
    if (!streamedText) return null;

    const parts = streamedText.split(/(```[\s\S]*?```)/g);

    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const lines = part.slice(3, -3).trim().split('\n');
        const lang = lines[0].trim();
        const code = lines.slice(1).join('\n') || lines[0];

        return (
          <div
            key={index}
            style={{
              position: 'relative',
              width: '100%',
              margin: '8px 0',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(15, 17, 23, 0.95)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '5px 10px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                fontSize: '11px',
                color: 'var(--text-muted)',
              }}
            >
              <span>{lang || 'code'}</span>
              <button
                type="button"
                onClick={() => handleCopyCodeSnippet(code)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  color: codeCopied ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                }}
              >
                {codeCopied ? <Check size={12} /> : <Copy size={12} />}
                <span>{codeCopied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre
              className="code-container"
              style={{
                margin: 0,
                padding: '10px',
                overflowX: 'auto',
                fontSize: '11.5px',
                lineHeight: '1.5',
                color: '#e2e8f0',
              }}
            >
              <code>{code}</code>
            </pre>
          </div>
        );
      }

      return (
        <div
          key={index}
          style={{
            whiteSpace: 'pre-wrap',
            color: 'var(--text-primary)',
            fontSize: '12.5px',
            lineHeight: '1.6',
          }}
        >
          {part}
        </div>
      );
    });
  };

  return (
    <div
      className="glass-panel panel-animate-in"
      style={{
        width: '490px',
        maxHeight: '540px',
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
              backgroundColor: 'rgba(99, 102, 241, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-indigo)',
            }}
          >
            <Sparkles size={14} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>AI Answer</span>
              <span className="badge-info">
                {aiStatus?.provider === 'openai'
                  ? 'OpenAI • '
                  : aiStatus?.provider === 'ollama'
                  ? 'Ollama • '
                  : 'Gemini • '}
                {aiStatus?.model ||
                  (aiStatus?.provider === 'openai'
                    ? 'gpt-4o-mini'
                    : aiStatus?.provider === 'ollama'
                    ? 'qwen2.5-coder:3b'
                    : 'gemini-3.8-flash')}
              </span>
              {isStreaming && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '10.5px',
                    color: 'var(--accent-cyan)',
                  }}
                >
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--accent-cyan)',
                      boxShadow: '0 0 6px var(--accent-cyan)',
                    }}
                  />
                  Streaming
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Header Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {isStreaming ? (
            <button
              type="button"
              onClick={handleStop}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '11px',
                color: 'var(--accent-rose)',
                backgroundColor: 'rgba(244, 63, 94, 0.15)',
                border: '1px solid rgba(244, 63, 94, 0.3)',
                cursor: 'pointer',
              }}
              title="Stop response generation"
            >
              <Square size={11} fill="currentColor" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRetry}
              disabled={isStreaming || !prompt}
              style={{
                padding: '5px',
                borderRadius: '6px',
                color: 'var(--text-secondary)',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                cursor: 'pointer',
              }}
              title="Retry prompt"
            >
              <RotateCw size={13} />
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyAnswer}
            disabled={!streamedText}
            style={{
              padding: '5px',
              borderRadius: '6px',
              color: copied ? 'var(--accent-emerald)' : 'var(--text-secondary)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              opacity: streamedText ? 1 : 0.4,
              cursor: streamedText ? 'pointer' : 'default',
            }}
            title="Copy full answer"
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
              cursor: 'pointer',
            }}
            title="Clear answer"
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
              cursor: 'pointer',
            }}
            title="Close panel (Esc)"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Query Banner */}
      <div
        style={{
          flexShrink: 0,
          padding: '8px 14px',
          backgroundColor: 'rgba(0, 0, 0, 0.25)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          fontSize: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          <span style={{ color: 'var(--accent-cyan)', fontWeight: 500 }}>Prompt: </span>
          <span style={{ color: 'var(--text-secondary)' }}>{prompt}</span>
        </div>
      </div>

      {/* Content Body - Scrolls Independently */}
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
        {/* Classified Error Alert */}
        {error && (() => {
          const lower = error.toLowerCase();
          const isOllama = aiStatus?.provider === 'ollama' || lower.includes('ollama');
          const isGemini = !isOllama && (aiStatus?.provider === 'gemini' || lower.includes('gemini'));
          const providerName = isOllama ? 'Ollama' : isGemini ? 'Google Gemini' : 'OpenAI';

          const isBillingOrQuota =
            lower.includes('quota') ||
            lower.includes('credit') ||
            lower.includes('resource_exhausted') ||
            lower.includes('spend limit') ||
            lower.includes('usage limit') ||
            lower.includes('billing');

          const isRateLimit =
            !isBillingOrQuota &&
            (lower.includes('rate limit') || lower.includes('throttling') || lower.includes('retry-after'));

          const isAuth =
            lower.includes('authentication') ||
            lower.includes('unauthorized') ||
            lower.includes('invalid api key') ||
            lower.includes('api key not valid') ||
            lower.includes('no openai api key') ||
            lower.includes('no gemini api key');

          const isModel =
            lower.includes('model') && (lower.includes('not found') || lower.includes('inaccessible'));

          const handleOpenBillingOrQuota = () => {
            const targetUrl = isGemini ? 'https://aistudio.google.com/' : 'https://platform.openai.com/billing';
            try {
              window.open(targetUrl, '_blank');
              onNotify?.(`Opened ${isGemini ? 'Google AI Studio' : 'OpenAI Billing'} in browser`);
            } catch {
              navigator.clipboard?.writeText(targetUrl);
              onNotify?.('Copied link to clipboard');
            }
          };

          return (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: isBillingOrQuota
                  ? 'rgba(245, 158, 11, 0.1)'
                  : isRateLimit
                  ? 'rgba(6, 182, 212, 0.1)'
                  : 'rgba(244, 63, 94, 0.1)',
                border: `1px solid ${
                  isBillingOrQuota
                    ? 'rgba(245, 158, 11, 0.35)'
                    : isRateLimit
                    ? 'rgba(6, 182, 212, 0.35)'
                    : 'rgba(244, 63, 94, 0.3)'
                }`,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontSize: '12px',
                color: isBillingOrQuota
                  ? 'var(--accent-amber)'
                  : isRateLimit
                  ? 'var(--accent-cyan)'
                  : 'var(--accent-rose)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>
                  {isBillingOrQuota
                    ? `${providerName} Quota / Resource Limit Exhausted`
                    : isRateLimit
                    ? `${providerName} Rate Limit (Request Throttling)`
                    : isAuth
                    ? `${providerName} Authentication Failed`
                    : isModel
                    ? `${providerName} Model Not Found`
                    : `${providerName} Request Error`}
                </span>
              </div>

              <div style={{ lineHeight: '1.5', color: 'var(--text-secondary)', fontSize: '11.5px' }}>
                {error}
              </div>

              {/* Action Buttons Tailored to the Classified Error */}
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                {isBillingOrQuota && (
                  <>
                    <button
                      type="button"
                      onClick={handleOpenBillingOrQuota}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '5px 10px',
                        borderRadius: '6px',
                        backgroundColor: 'var(--accent-amber)',
                        color: '#000',
                        fontWeight: 600,
                        border: 'none',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                      title={isGemini ? 'Check Google AI Studio project quotas' : 'Open OpenAI account billing and credits page'}
                    >
                      <CreditCard size={12} />
                      <span>{isGemini ? 'Check Google AI Studio Quota' : 'Check OpenAI Billing'}</span>
                      <ExternalLink size={10} />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onClose?.();
                        onOpenSettings?.();
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '5px 10px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      <SettingsIcon size={12} />
                      <span>Update Key in Settings</span>
                    </button>
                  </>
                )}

                {isRateLimit && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'var(--accent-cyan)',
                      color: '#000',
                      fontWeight: 600,
                      border: 'none',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    <RotateCw size={12} />
                    <span>Retry Request</span>
                  </button>
                )}

                {(isAuth || isModel) && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose?.();
                      onOpenSettings?.();
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'var(--accent-indigo)',
                      color: '#fff',
                      fontWeight: 500,
                      border: 'none',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    <SettingsIcon size={12} />
                    <span>{isModel ? 'Select Model in Settings' : 'Configure Key in Settings'}</span>
                  </button>
                )}

                {!isBillingOrQuota && !isRateLimit && !isAuth && !isModel && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    <RotateCw size={12} />
                    <span>Retry</span>
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Empty state / Prompt Selection */}
        {!streamedText && !isStreaming && !error && (
          <div
            style={{
              padding: '20px 10px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-indigo)',
              }}
            >
              <Zap size={18} />
            </div>

            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Real-Time AI Answer
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Responses stream progressively through native Rust IPC channels.
              </div>
            </div>

            {/* Quick starter chips */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', marginTop: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'left' }}>
                Try asking:
              </span>
              {SAMPLE_STARTER_PROMPTS.map((sample, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleStartStream(sample)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)',
                    fontSize: '11.5px',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  "{sample}"
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Render Streamed Output */}
        {streamedText && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {renderFormattedContent()}
            {isStreaming && (
              <span
                style={{
                  display: 'inline-block',
                  width: '6px',
                  height: '14px',
                  backgroundColor: 'var(--accent-indigo)',
                  marginLeft: '2px',
                  verticalAlign: 'text-bottom',
                  animation: 'pulse 1s infinite',
                }}
              />
            )}
          </div>
        )}

        <div ref={contentEndRef} />
      </div>

      {/* Interactive Prompt Bar */}
      <div
        style={{
          flexShrink: 0,
          padding: '8px 14px',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'rgba(0, 0, 0, 0.25)',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
        }}
      >
        <input
          type="text"
          value={inputPrompt}
          onChange={(e) => setInputPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleStartStream();
            }
          }}
          disabled={isStreaming}
          placeholder="Ask a technical question to stream..."
          style={{
            flex: 1,
            padding: '6px 10px',
            borderRadius: '6px',
            backgroundColor: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
            fontSize: '11.5px',
            outline: 'none',
          }}
        />

        <button
          type="button"
          onClick={() => handleStartStream()}
          disabled={isStreaming || (!inputPrompt.trim() && !prompt)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '6px 10px',
            borderRadius: '6px',
            backgroundColor: 'var(--accent-indigo)',
            color: '#fff',
            border: 'none',
            fontSize: '11px',
            fontWeight: 500,
            cursor: isStreaming || (!inputPrompt.trim() && !prompt) ? 'not-allowed' : 'pointer',
            opacity: isStreaming || (!inputPrompt.trim() && !prompt) ? 0.5 : 1,
          }}
        >
          <Send size={12} />
          <span>Stream</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onClose?.();
            onOpenChat?.();
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            fontWeight: 500,
            color: 'var(--accent-cyan)',
            padding: '6px 8px',
            borderRadius: '6px',
            backgroundColor: 'rgba(6, 182, 212, 0.1)',
            border: '1px solid rgba(6, 182, 212, 0.25)',
            cursor: 'pointer',
          }}
          title="Continue in full Chat panel"
        >
          <MessageSquare size={12} />
          <span>Chat</span>
          <ArrowUpRight size={11} />
        </button>
      </div>
    </div>
  );
}
