import React, { useState, useRef, useEffect } from 'react';
import {
  MessageSquare,
  Send,
  Paperclip,
  Mic,
  Copy,
  Check,
  RotateCw,
  Trash2,
  X,
  Sparkles,
  Download,
  Square,
  AlertCircle,
  Settings as SettingsIcon,
  CreditCard,
  ExternalLink,
} from 'lucide-react';
import { MOCK_CHAT_HISTORY } from '../../data/mockData';
import {
  nativeGetAiReadiness,
  nativeStreamChat,
  nativeCancelStream,
} from '../../utils/tauriBridge';

const QUICK_PROMPTS = [
  'Explain active component structure',
  'Check shortcut conflict risks',
  'Optimize translucent backdrop filter',
  'Draft clean release notes',
];

export function ChatPanel({ onClose, onOpenSettings, onNotify }) {
  const [messages, setMessages] = useState(MOCK_CHAT_HISTORY);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const messagesEndRef = useRef(null);
  const messageListRef = useRef(null);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  };

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

  useEffect(() => {
    scrollToBottom();
    const timer = setTimeout(scrollToBottom, 60);
    return () => clearTimeout(timer);
  }, [messages, isStreaming]);

  // Clean up active stream on unmount
  useEffect(() => {
    return () => {
      if (activeRequestId) {
        nativeCancelStream(activeRequestId).catch(() => {});
      }
    };
  }, [activeRequestId]);

  const handleSend = async (textToSend) => {
    const text = (textToSend || inputValue).trim();
    if (!text) return;

    // Prevent duplicate submission
    if (isStreaming) return;

    let currentStatus = aiStatus;
    try {
      currentStatus = await nativeGetAiReadiness();
      setAiStatus(currentStatus);
    } catch {
      // keep currentStatus
    }
    const activeModel =
      currentStatus?.model ||
      (currentStatus?.provider === 'openai'
        ? 'gpt-4o-mini'
        : currentStatus?.provider === 'ollama'
        ? 'qwen2.5-coder:3b'
        : 'gemini-3.8-flash');

    const userMsg = {
      id: `u-${Date.now()}`,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text,
    };

    const aiMsgId = `ai-${Date.now()}`;
    const aiMsg = {
      id: aiMsgId,
      sender: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      model: activeModel,
      text: '',
      isStreaming: true,
      error: null,
    };

    const newMessages = [...messages, userMsg, aiMsg];
    setMessages(newMessages);
    setInputValue('');
    setIsStreaming(true);

    const requestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setActiveRequestId(requestId);

    // Filter relevant conversation history (up to last 10 turns to avoid token bloat)
    const conversationHistory = [...messages, userMsg]
      .filter((m) => m.text && !m.error)
      .slice(-10)
      .map((m) => ({
        role: m.sender === 'assistant' ? 'assistant' : 'user',
        content: m.text,
      }));

    try {
      await nativeStreamChat({
        requestId,
        messages: conversationHistory,
        model: activeModel,
        onChunk: (chunk) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, text: m.text + chunk } : m))
          );
        },
        onDone: () => {
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, isStreaming: false } : m))
          );
          setIsStreaming(false);
          setActiveRequestId(null);
          onNotify?.('Assistant response finished');
        },
        onError: (errMsg) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    isStreaming: false,
                    error: errMsg || 'Failed to complete AI request.',
                    text: m.text || 'Error: ' + (errMsg || 'Request failed.'),
                  }
                : m
            )
          );
          setIsStreaming(false);
          setActiveRequestId(null);
          onNotify?.('Chat response error');
        },
        onCancelled: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    isStreaming: false,
                    text: m.text ? m.text + ' [Generation stopped]' : '[Generation stopped]',
                  }
                : m
            )
          );
          setIsStreaming(false);
          setActiveRequestId(null);
          onNotify?.('Response stopped');
        },
      });
    } catch (err) {
      const errMsg = err?.message || String(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? {
                ...m,
                isStreaming: false,
                error: errMsg,
                text: m.text || 'Error: ' + errMsg,
              }
            : m
        )
      );
      setIsStreaming(false);
      setActiveRequestId(null);
      onNotify?.(`Chat error: ${errMsg}`);
    }
  };

  const handleStop = async () => {
    if (activeRequestId) {
      await nativeCancelStream(activeRequestId);
      setIsStreaming(false);
      setActiveRequestId(null);
    }
  };

  const handleRetryLast = () => {
    if (isStreaming) return;
    // Find last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.sender === 'user');
    if (lastUserMsg) {
      handleSend(lastUserMsg.text);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) {
        handleSend();
      }
    }
  };

  const handleCopy = (id, text) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    onNotify?.('Message copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClear = () => {
    if (isStreaming) {
      handleStop();
    }
    setMessages([]);
    onNotify?.('Chat history cleared');
  };

  const handleExport = () => {
    const json = JSON.stringify(messages, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omnipilot-chat-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify?.('Exported chat session to JSON');
  };

  return (
    <div
      className="glass-panel panel-animate-in"
      style={{
        width: '480px',
        height: '520px',
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
              backgroundColor: 'rgba(99, 102, 241, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-indigo)',
            }}
          >
            <MessageSquare size={14} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>Copilot Chat</span>
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
                  Live Stream
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            onClick={handleExport}
            style={{
              padding: '5px',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              cursor: 'pointer',
            }}
            title="Export chat session"
          >
            <Download size={13} />
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
            title="Clear chat history"
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

      {/* Suggested Quick Prompt Chips */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          padding: '8px 12px',
          backgroundColor: 'rgba(0, 0, 0, 0.22)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          maxHeight: '74px',
          overflowY: 'auto',
        }}
      >
        {QUICK_PROMPTS.map((p, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSend(p)}
            disabled={isStreaming}
            style={{
              flexShrink: 0,
              fontSize: '11px',
              padding: '3px 8px',
              borderRadius: '9999px',
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap',
              lineHeight: '1.4',
              cursor: isStreaming ? 'not-allowed' : 'pointer',
              opacity: isStreaming ? 0.5 : 1,
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Messages Scroll Area */}
      <div
        ref={messageListRef}
        style={{
          flex: 1,
          minHeight: 0,
          padding: '12px 14px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              margin: 'auto',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Sparkles size={24} style={{ color: 'var(--accent-indigo)', opacity: 0.7 }} />
            <span>No messages yet. Ask a question or click a prompt above.</span>
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.sender === 'user';
            const hasError = Boolean(m.error);

            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                    backgroundColor: isUser
                      ? 'rgba(99, 102, 241, 0.28)'
                      : hasError
                      ? 'rgba(244, 63, 94, 0.15)'
                      : 'rgba(28, 32, 42, 0.85)',
                    border: `1px solid ${
                      isUser
                        ? 'rgba(99, 102, 241, 0.48)'
                        : hasError
                        ? 'rgba(244, 63, 94, 0.35)'
                        : 'rgba(255, 255, 255, 0.08)'
                    }`,
                    color: hasError ? 'var(--accent-rose)' : 'var(--text-primary)',
                    fontSize: '12.5px',
                    lineHeight: '1.5',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                  }}
                >
                  {m.text ? (
                    <>
                      {m.text}
                      {m.isStreaming && (
                        <span
                          style={{
                            display: 'inline-block',
                            width: '5px',
                            height: '13px',
                            backgroundColor: 'var(--accent-indigo)',
                            marginLeft: '3px',
                            verticalAlign: 'text-bottom',
                            animation: 'pulse 1s infinite',
                          }}
                        />
                      )}
                    </>
                  ) : m.isStreaming ? (
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', padding: '2px 0' }}>
                      <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'var(--accent-indigo)', animation: 'pulseGlow 1s infinite' }} />
                      <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'var(--accent-indigo)', animation: 'pulseGlow 1s infinite 0.2s' }} />
                      <div style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'var(--accent-indigo)', animation: 'pulseGlow 1s infinite 0.4s' }} />
                    </div>
                  ) : null}
                </div>

                {/* Subtext info */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginTop: '3px',
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>{m.timestamp}</span>
                  {!isUser && m.text && (
                    <button
                      type="button"
                      onClick={() => handleCopy(m.id, m.text)}
                      style={{
                        color: copiedId === m.id ? 'var(--accent-emerald)' : 'var(--text-muted)',
                        cursor: 'pointer',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                      }}
                      title="Copy response"
                    >
                      {copiedId === m.id ? <Check size={11} /> : <Copy size={11} />}
                    </button>
                  )}
                  {!isUser && hasError && (() => {
                    const errStr = (m.error || m.text || '').toLowerCase();
                    const isOllama = aiStatus?.provider === 'ollama' || errStr.includes('ollama');
                    const isGemini = !isOllama && (aiStatus?.provider === 'gemini' || errStr.includes('gemini'));
                    const isQuotaOrBilling =
                      errStr.includes('quota') ||
                      errStr.includes('credit') ||
                      errStr.includes('resource_exhausted') ||
                      errStr.includes('spend limit') ||
                      errStr.includes('usage limit') ||
                      errStr.includes('billing');
                    const isRateLimit =
                      !isQuotaOrBilling &&
                      (errStr.includes('rate limit') || errStr.includes('throttling') || errStr.includes('retry-after'));

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
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {isQuotaOrBilling && (
                          <>
                            <button
                              type="button"
                              onClick={handleOpenBillingOrQuota}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                color: 'var(--accent-amber)',
                                cursor: 'pointer',
                                background: 'rgba(245, 158, 11, 0.1)',
                                border: '1px solid rgba(245, 158, 11, 0.3)',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 600,
                              }}
                              title={isGemini ? 'Open Google AI Studio Quotas' : 'Open OpenAI Billing'}
                            >
                              <CreditCard size={10} />
                              <span>{isGemini ? 'AI Studio' : 'Billing'}</span>
                              <ExternalLink size={9} />
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
                                gap: '3px',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                fontSize: '10px',
                              }}
                            >
                              <SettingsIcon size={10} />
                              <span>Settings</span>
                            </button>
                          </>
                        )}

                        {isRateLimit && (
                          <button
                            type="button"
                            onClick={handleRetryLast}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '2px',
                              color: 'var(--accent-cyan)',
                              cursor: 'pointer',
                              background: 'rgba(6, 182, 212, 0.1)',
                              border: '1px solid rgba(6, 182, 212, 0.3)',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: 600,
                            }}
                            title="Retry prompt"
                          >
                            <RotateCw size={10} />
                            <span>Retry Rate Limit</span>
                          </button>
                        )}

                        {!isQuotaOrBilling && !isRateLimit && (
                          <>
                            <button
                              type="button"
                              onClick={handleRetryLast}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '2px',
                                color: 'var(--accent-indigo)',
                                cursor: 'pointer',
                                background: 'none',
                                border: 'none',
                                padding: 0,
                              }}
                              title="Retry prompt"
                            >
                              <RotateCw size={10} />
                              <span>Retry</span>
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
                                gap: '2px',
                                color: 'var(--accent-cyan)',
                                cursor: 'pointer',
                                background: 'none',
                                border: 'none',
                                padding: 0,
                              }}
                            >
                              <SettingsIcon size={10} />
                              <span>Settings</span>
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })
        )}

        <div ref={messagesEndRef} style={{ height: '1px' }} />
      </div>

      {/* Input Composer */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 14px',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'rgba(15, 17, 23, 0.95)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            padding: '4px 6px',
            gap: '6px',
          }}
        >
          <button
            type="button"
            onClick={() => onNotify?.('File attachment mock triggered')}
            style={{
              padding: '6px',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            title="Attach file / image (Mock)"
          >
            <Paperclip size={14} />
          </button>

          <input
            type="text"
            placeholder={isStreaming ? 'Generating response...' : 'Ask OmniPilot anything...'}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              padding: '6px 4px',
              fontSize: '12.5px',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />

          <button
            type="button"
            onClick={() => onNotify?.('Voice prompt simulation toggled')}
            style={{
              padding: '6px',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            title="Voice input (Mock)"
          >
            <Mic size={14} />
          </button>

          {isStreaming ? (
            <button
              type="button"
              onClick={handleStop}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 10px',
                borderRadius: '8px',
                backgroundColor: 'rgba(244, 63, 94, 0.2)',
                border: '1px solid rgba(244, 63, 94, 0.4)',
                color: 'var(--accent-rose)',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 600,
              }}
              title="Stop generation"
            >
              <Square size={12} fill="currentColor" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleSend()}
              disabled={!inputValue.trim()}
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                backgroundColor: inputValue.trim() ? 'var(--accent-indigo)' : 'rgba(255, 255, 255, 0.05)',
                color: inputValue.trim() ? '#ffffff' : 'var(--text-muted)',
                cursor: inputValue.trim() ? 'pointer' : 'default',
              }}
              title="Send message (Enter)"
            >
              <Send size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
