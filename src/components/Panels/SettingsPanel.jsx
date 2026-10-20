import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Shield,
  Keyboard,
  Palette,
  Monitor,
  X,
  AlertTriangle,
  CheckCircle2,
  Server,
  RefreshCw,
  Cpu,
  AlertCircle,
  ShieldCheck,
  Key,
  Eye,
  EyeOff,
  Trash2,
  Zap,
  Globe,
  Sparkles,
} from 'lucide-react';
import { MOCK_SHORTCUTS } from '../../data/mockData';
import {
  nativeGetBackendStatus,
  nativeSetAiProvider,
  nativeSaveProviderApiKey,
  nativeDeleteProviderApiKey,
  nativeSetProviderAiModel,
  nativeSetProviderAiEndpoint,
  nativeVerifyAiProviderConnection,
  normalizeGeminiModel,
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_OLLAMA_MODEL,
} from '../../utils/tauriBridge';

export function SettingsPanel({
  onClose,
  theme,
  setTheme,
  alwaysOnTop,
  setAlwaysOnTop,
  privacyMode,
  setPrivacyMode,
  onNotify,
}) {
  const [backendStatus, setBackendStatus] = useState(null);
  const [isCheckingBackend, setIsCheckingBackend] = useState(false);
  const [backendError, setBackendError] = useState(null);

  // Multi-Provider AI State (Ollama, Gemini & OpenAI)
  const [selectedProviderTab, setSelectedProviderTab] = useState('ollama');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [isVerifyingKey, setIsVerifyingKey] = useState(false);
  const [isDeletingKey, setIsDeletingKey] = useState(false);
  const [isSettingActiveProvider, setIsSettingActiveProvider] = useState(false);
  const [keyOpFeedback, setKeyOpFeedback] = useState(null);
  const [selectedOpenAiModel, setSelectedOpenAiModel] = useState('gpt-4o-mini');
  const [selectedGeminiModel, setSelectedGeminiModel] = useState('gemini-3.8-flash');
  const [selectedOllamaModel, setSelectedOllamaModel] = useState(DEFAULT_OLLAMA_MODEL);
  const [ollamaEndpointInput, setOllamaEndpointInput] = useState(DEFAULT_OLLAMA_ENDPOINT);
  const [isSavingEndpoint, setIsSavingEndpoint] = useState(false);

  const fetchBackendHealth = useCallback(async (notifyOnComplete = false) => {
    setIsCheckingBackend(true);
    setBackendError(null);
    try {
      const res = await nativeGetBackendStatus();
      setBackendStatus(res);
      if (res?.ai?.openaiModel) {
        setSelectedOpenAiModel(res.ai.openaiModel);
      }
      if (res?.ai?.geminiModel) {
        setSelectedGeminiModel(normalizeGeminiModel(res.ai.geminiModel));
      }
      if (res?.ai?.ollamaModel) {
        setSelectedOllamaModel(res.ai.ollamaModel);
      }
      if (res?.ai?.ollamaEndpoint) {
        setOllamaEndpointInput(res.ai.ollamaEndpoint);
      }
      if (notifyOnComplete) {
        onNotify?.(`Backend check complete: ${res.status}`);
      }
    } catch (err) {
      const errMsg = err?.message || 'Failed to communicate with native backend';
      setBackendError(errMsg);
      if (notifyOnComplete) {
        onNotify?.(`Backend check failed: ${errMsg}`);
      }
    } finally {
      setIsCheckingBackend(false);
    }
  }, [onNotify]);

  useEffect(() => {
    fetchBackendHealth(false);
  }, [fetchBackendHealth]);

  // Synchronize initial tab with active provider
  useEffect(() => {
    if (backendStatus?.ai?.provider) {
      const activeProv = backendStatus.ai.provider.toLowerCase();
      if (activeProv === 'ollama' || activeProv === 'gemini' || activeProv === 'openai') {
        setSelectedProviderTab(activeProv);
      }
    }
  }, [backendStatus?.ai?.provider]);

  const handleTabChange = (provider) => {
    setSelectedProviderTab(provider);
    setApiKeyInput('');
    setShowKey(false);
    setKeyOpFeedback(null);
  };

  const handleSetActiveProvider = async (provider) => {
    setIsSettingActiveProvider(true);
    try {
      await nativeSetAiProvider(provider);
      const label =
        provider === 'ollama'
          ? 'Local Ollama'
          : provider === 'gemini'
          ? 'Google Gemini'
          : 'OpenAI';
      onNotify?.(`Active AI provider set to ${label}`);
      await fetchBackendHealth(false);
    } catch (err) {
      setKeyOpFeedback({ type: 'error', message: err?.message || String(err) });
    } finally {
      setIsSettingActiveProvider(false);
    }
  };

  const handleSaveEndpoint = async (e) => {
    e?.preventDefault();
    const trimmed = (ollamaEndpointInput || '').trim();
    if (!trimmed) {
      setKeyOpFeedback({ type: 'error', message: 'Ollama base URL cannot be empty.' });
      return;
    }
    setIsSavingEndpoint(true);
    setKeyOpFeedback(null);
    try {
      await nativeSetProviderAiEndpoint('ollama', trimmed);
      setKeyOpFeedback({
        type: 'success',
        message: `Ollama endpoint updated to ${trimmed}.`,
      });
      onNotify?.(`Ollama base URL set to ${trimmed}`);
      await fetchBackendHealth(false);
    } catch (err) {
      setKeyOpFeedback({ type: 'error', message: err?.message || String(err) });
    } finally {
      setIsSavingEndpoint(false);
    }
  };

  const handleSaveKey = async (e) => {
    e?.preventDefault();
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setKeyOpFeedback({ type: 'error', message: 'API key cannot be empty.' });
      return;
    }

    if (selectedProviderTab === 'openai' && !trimmed.startsWith('sk-')) {
      setKeyOpFeedback({
        type: 'error',
        message: 'API key must begin with "sk-" (standard OpenAI key format, e.g. "sk-proj-...").',
      });
      return;
    }

    setIsSavingKey(true);
    setKeyOpFeedback(null);
    try {
      await nativeSaveProviderApiKey(selectedProviderTab, trimmed);
      setApiKeyInput(''); // Clear immediately so secret does not remain in React state
      setShowKey(false);
      const providerLabel = selectedProviderTab === 'gemini' ? 'Google Gemini' : 'OpenAI';
      setKeyOpFeedback({
        type: 'success',
        message: `${providerLabel} API key saved securely to Windows Credential Manager.`,
      });
      onNotify?.(`${providerLabel} credential securely stored`);
      await fetchBackendHealth(false);
    } catch (err) {
      setKeyOpFeedback({ type: 'error', message: err?.message || String(err) });
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleDeleteKey = async () => {
    setIsDeletingKey(true);
    setKeyOpFeedback(null);
    try {
      await nativeDeleteProviderApiKey(selectedProviderTab);
      setApiKeyInput('');
      const providerLabel = selectedProviderTab === 'gemini' ? 'Google Gemini' : 'OpenAI';
      setKeyOpFeedback({
        type: 'success',
        message: `${providerLabel} credential removed from Windows Credential Manager.`,
      });
      onNotify?.(`${providerLabel} credential deleted`);
      await fetchBackendHealth(false);
    } catch (err) {
      setKeyOpFeedback({ type: 'error', message: err?.message || String(err) });
    } finally {
      setIsDeletingKey(false);
    }
  };

  const handleVerifyConnection = async () => {
    setIsVerifyingKey(true);
    setKeyOpFeedback(null);
    try {
      const res = await nativeVerifyAiProviderConnection(selectedProviderTab);
      const providerLabel =
        selectedProviderTab === 'ollama'
          ? 'Local Ollama'
          : selectedProviderTab === 'gemini'
          ? 'Google Gemini'
          : 'OpenAI';
      setKeyOpFeedback({
        type: 'success',
        message: res?.message || `${providerLabel} verified successfully!`,
      });
      onNotify?.(`${providerLabel} connection verified`);
      await fetchBackendHealth(false);
    } catch (err) {
      setKeyOpFeedback({ type: 'error', message: err?.message || String(err) });
      await fetchBackendHealth(false);
    } finally {
      setIsVerifyingKey(false);
    }
  };

  const handleModelChange = async (newModel) => {
    const targetModel =
      selectedProviderTab === 'gemini'
        ? normalizeGeminiModel(newModel)
        : newModel.trim();

    if (selectedProviderTab === 'ollama') {
      setSelectedOllamaModel(targetModel);
    } else if (selectedProviderTab === 'gemini') {
      setSelectedGeminiModel(targetModel);
    } else {
      setSelectedOpenAiModel(targetModel);
    }

    try {
      await nativeSetProviderAiModel(selectedProviderTab, targetModel);
      const providerLabel =
        selectedProviderTab === 'ollama'
          ? 'Ollama'
          : selectedProviderTab === 'gemini'
          ? 'Gemini'
          : 'OpenAI';
      onNotify?.(`${providerLabel} model set to ${targetModel}`);
      await fetchBackendHealth(false);
    } catch (err) {
      onNotify?.(`Failed to update model: ${err?.message || err}`);
    }
  };

  const themes = [
    { id: 'charcoal', name: 'Charcoal Dark', desc: 'Default translucent acrylic glass' },
    { id: 'obsidian', name: 'Obsidian OLED', desc: 'High-contrast deep black glass' },
    { id: 'midnight', name: 'Midnight Slate', desc: 'Sleek blue-gray tinted acrylic' },
    { id: 'frost', name: 'Frost Glass', desc: 'Subtle frosted high-blur aesthetic' },
  ];

  // Derived state for the currently inspected tab
  const activeRuntimeProvider = (backendStatus?.ai?.provider || 'ollama').toLowerCase();
  const isViewingActiveProvider = selectedProviderTab === activeRuntimeProvider;

  const isOllamaConfigured = Boolean(
    backendStatus?.ai?.ollamaConfigured !== undefined
      ? backendStatus.ai.ollamaConfigured
      : true
  );

  const isOpenAiConfigured = Boolean(
    backendStatus?.ai?.openaiConfigured !== undefined
      ? backendStatus.ai.openaiConfigured
      : backendStatus?.ai?.provider === 'openai' && backendStatus?.ai?.keyConfigured
  );

  const isGeminiConfigured = Boolean(
    backendStatus?.ai?.geminiConfigured !== undefined
      ? backendStatus.ai.geminiConfigured
      : backendStatus?.ai?.provider === 'gemini' && backendStatus?.ai?.keyConfigured
  );

  const isCurrentTabConfigured =
    selectedProviderTab === 'ollama'
      ? isOllamaConfigured
      : selectedProviderTab === 'gemini'
      ? isGeminiConfigured
      : isOpenAiConfigured;

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
      {/* Header */}
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
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-primary)',
            }}
          >
            <Settings size={14} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>Preferences & Diagnostics</span>
              <span className="badge-info">AI Providers • Ollama, Gemini & OpenAI</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '5px',
            borderRadius: '6px',
            color: 'var(--text-secondary)',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
          }}
          title="Close settings (Esc)"
        >
          <X size={13} />
        </button>
      </div>

      {/* Settings Scrollable Content */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: '14px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {/* Section 0: Native Backend Health & AI Providers */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Server size={14} style={{ color: 'var(--accent-emerald)' }} />
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Native Backend & AI Diagnostics
              </span>
            </div>

            <button
              type="button"
              disabled={isCheckingBackend}
              onClick={() => fetchBackendHealth(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '3px 8px',
                borderRadius: '6px',
                fontSize: '11px',
                color: 'var(--text-primary)',
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid var(--border-subtle)',
                opacity: isCheckingBackend ? 0.6 : 1,
                cursor: isCheckingBackend ? 'default' : 'pointer',
              }}
              title="Query native backend health status"
            >
              <RefreshCw
                size={11}
                style={{
                  animation: isCheckingBackend ? 'spin 1s linear infinite' : 'none',
                }}
              />
              <span>{isCheckingBackend ? 'Checking...' : 'Check Status'}</span>
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            {backendError ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  padding: '8px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(244, 63, 94, 0.1)',
                  border: '1px solid rgba(244, 63, 94, 0.25)',
                  fontSize: '11.5px',
                  color: 'var(--accent-rose)',
                }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Backend Check Failed:</strong> {backendError}
                </div>
              </div>
            ) : (
              <>
                {/* Health & Runtime Indicators */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div
                    style={{
                      padding: '8px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid rgba(255, 255, 255, 0.04)',
                    }}
                  >
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Native Backend
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                      <span
                        style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          backgroundColor: backendStatus?.status === 'healthy' ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                          boxShadow: backendStatus?.status === 'healthy' ? '0 0 6px rgba(16, 185, 129, 0.6)' : 'none',
                        }}
                      />
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {backendStatus?.status === 'healthy' ? 'Healthy (Online)' : (backendStatus?.status || 'Probing...')}
                      </span>
                    </div>
                    <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {backendStatus?.appName} v{backendStatus?.appVersion} • {backendStatus?.os || 'Windows'}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '8px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid rgba(255, 255, 255, 0.04)',
                    }}
                  >
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Tauri Runtime
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                      <Cpu size={12} style={{ color: backendStatus?.isTauri ? 'var(--accent-cyan)' : 'var(--accent-indigo)' }} />
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {backendStatus?.isTauri ? 'Tauri 2 Native Core' : 'Browser Dev Server'}
                      </span>
                    </div>
                    <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {backendStatus?.isTauri ? 'Native IPC Channel Active' : 'Web Fallback Bridge'}
                    </div>
                  </div>
                </div>

                {/* AI Providers Management Section */}
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  {/* Provider Selector Tabs */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Select AI Provider to Configure:
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        Streaming Active: <strong>{activeRuntimeProvider === 'ollama' ? 'Local Ollama' : activeRuntimeProvider === 'gemini' ? 'Google Gemini' : 'OpenAI'}</strong>
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                      {/* Ollama Tab Button */}
                      <button
                        type="button"
                        onClick={() => handleTabChange('ollama')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          borderRadius: '6px',
                          backgroundColor:
                            selectedProviderTab === 'ollama'
                              ? 'rgba(16, 185, 129, 0.2)'
                              : 'rgba(255, 255, 255, 0.03)',
                          border:
                            selectedProviderTab === 'ollama'
                              ? '1px solid var(--accent-emerald)'
                              : '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              width: '7px',
                              height: '7px',
                              borderRadius: '50%',
                              backgroundColor: 'var(--accent-emerald)',
                            }}
                          />
                          <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Ollama (Local)
                          </span>
                        </div>
                        {activeRuntimeProvider === 'ollama' && (
                          <span
                            style={{
                              fontSize: '9px',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(16, 185, 129, 0.3)',
                              color: 'var(--accent-emerald)',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                            }}
                          >
                            Active
                          </span>
                        )}
                      </button>

                      {/* Google Gemini Tab Button */}
                      <button
                        type="button"
                        onClick={() => handleTabChange('gemini')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          borderRadius: '6px',
                          backgroundColor:
                            selectedProviderTab === 'gemini'
                              ? 'rgba(6, 182, 212, 0.2)'
                              : 'rgba(255, 255, 255, 0.03)',
                          border:
                            selectedProviderTab === 'gemini'
                              ? '1px solid var(--accent-cyan)'
                              : '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              width: '7px',
                              height: '7px',
                              borderRadius: '50%',
                              backgroundColor: isGeminiConfigured ? 'var(--accent-emerald)' : 'rgba(255, 255, 255, 0.2)',
                            }}
                          />
                          <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Google Gemini
                          </span>
                        </div>
                        {activeRuntimeProvider === 'gemini' && (
                          <span
                            style={{
                              fontSize: '9px',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(6, 182, 212, 0.3)',
                              color: 'var(--accent-cyan)',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                            }}
                          >
                            Active
                          </span>
                        )}
                      </button>

                      {/* OpenAI Tab Button */}
                      <button
                        type="button"
                        onClick={() => handleTabChange('openai')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          borderRadius: '6px',
                          backgroundColor:
                            selectedProviderTab === 'openai'
                              ? 'rgba(99, 102, 241, 0.2)'
                              : 'rgba(255, 255, 255, 0.03)',
                          border:
                            selectedProviderTab === 'openai'
                              ? '1px solid var(--accent-indigo)'
                              : '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              width: '7px',
                              height: '7px',
                              borderRadius: '50%',
                              backgroundColor: isOpenAiConfigured ? 'var(--accent-emerald)' : 'rgba(255, 255, 255, 0.2)',
                            }}
                          />
                          <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            OpenAI
                          </span>
                        </div>
                        {activeRuntimeProvider === 'openai' && (
                          <span
                            style={{
                              fontSize: '9px',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(99, 102, 241, 0.3)',
                              color: 'var(--accent-indigo)',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                            }}
                          >
                            Active
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Provider Header & Active Toggle */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingTop: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Key
                        size={13}
                        style={{
                          color:
                            selectedProviderTab === 'ollama'
                              ? 'var(--accent-emerald)'
                              : selectedProviderTab === 'gemini'
                              ? 'var(--accent-cyan)'
                              : 'var(--accent-indigo)',
                        }}
                      />
                      <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {selectedProviderTab === 'ollama'
                          ? 'Ollama (Local AI) Settings'
                          : selectedProviderTab === 'gemini'
                          ? 'Google Gemini Settings'
                          : 'OpenAI Settings'}
                      </span>
                    </div>

                    {!isViewingActiveProvider ? (
                      <button
                        type="button"
                        disabled={isSettingActiveProvider}
                        onClick={() => handleSetActiveProvider(selectedProviderTab)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '10.5px',
                          fontWeight: 500,
                          color: '#fff',
                          backgroundColor:
                            selectedProviderTab === 'ollama'
                              ? 'var(--accent-emerald)'
                              : selectedProviderTab === 'gemini'
                              ? 'var(--accent-cyan)'
                              : 'var(--accent-indigo)',
                          border: 'none',
                          cursor: isSettingActiveProvider ? 'default' : 'pointer',
                          opacity: isSettingActiveProvider ? 0.6 : 1,
                        }}
                      >
                        <Sparkles size={11} />
                        <span>Set as Active Provider</span>
                      </button>
                    ) : (
                      <span
                        style={{
                          padding: '2px 7px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 600,
                          backgroundColor:
                            backendStatus?.ai?.state === 'ready'
                              ? 'rgba(16, 185, 129, 0.15)'
                              : selectedProviderTab === 'ollama'
                              ? 'rgba(16, 185, 129, 0.15)'
                              : isCurrentTabConfigured
                              ? 'rgba(6, 182, 212, 0.15)'
                              : 'rgba(245, 158, 11, 0.15)',
                          color:
                            backendStatus?.ai?.state === 'ready'
                              ? 'var(--accent-emerald)'
                              : selectedProviderTab === 'ollama'
                              ? 'var(--accent-emerald)'
                              : isCurrentTabConfigured
                              ? 'var(--accent-cyan)'
                              : 'var(--accent-amber)',
                          border: `1px solid ${
                            backendStatus?.ai?.state === 'ready'
                              ? 'rgba(16, 185, 129, 0.3)'
                              : selectedProviderTab === 'ollama'
                              ? 'rgba(16, 185, 129, 0.3)'
                              : isCurrentTabConfigured
                              ? 'rgba(6, 182, 212, 0.3)'
                              : 'rgba(245, 158, 11, 0.3)'
                          }`,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {backendStatus?.ai?.state === 'ready'
                          ? 'VERIFIED & READY'
                          : selectedProviderTab === 'ollama'
                          ? 'LOCAL RUNTIME READY'
                          : isCurrentTabConfigured
                          ? 'CONFIGURED (ACTIVE)'
                          : 'NO KEY STORED'}
                      </span>
                    )}
                  </div>

                  {/* Diagnostic / Status Message */}
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.45' }}>
                    {isViewingActiveProvider
                      ? backendStatus?.ai?.message || 'Inspecting AI readiness...'
                      : selectedProviderTab === 'ollama'
                      ? 'Local Ollama daemon runs offline on your machine. No API key required.'
                      : isCurrentTabConfigured
                      ? `${selectedProviderTab === 'gemini' ? 'Gemini' : 'OpenAI'} credential is securely stored in Windows Credential Manager.`
                      : `No ${selectedProviderTab === 'gemini' ? 'Gemini' : 'OpenAI'} credential stored yet. Add your key below.`}
                  </div>

                  {/* Provider Specific Configuration */}
                  {selectedProviderTab === 'ollama' ? (
                    <>
                      {/* Ollama Base URL Configuration */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                            Ollama Base URL (Local Daemon)
                          </label>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            Default: http://127.0.0.1:11434
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input
                            type="text"
                            value={ollamaEndpointInput}
                            onChange={(e) => setOllamaEndpointInput(e.target.value)}
                            placeholder="http://127.0.0.1:11434"
                            spellCheck="false"
                            style={{
                              flex: 1,
                              padding: '6px 10px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(0, 0, 0, 0.4)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-primary)',
                              fontSize: '11.5px',
                              fontFamily: 'monospace',
                              outline: 'none',
                            }}
                          />
                          <button
                            type="button"
                            onClick={handleSaveEndpoint}
                            disabled={isSavingEndpoint || !ollamaEndpointInput.trim()}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 500,
                              color: '#fff',
                              backgroundColor: 'var(--accent-emerald)',
                              border: 'none',
                              cursor: isSavingEndpoint || !ollamaEndpointInput.trim() ? 'not-allowed' : 'pointer',
                              opacity: isSavingEndpoint ? 0.7 : 1,
                            }}
                          >
                            <Server size={11} />
                            <span>{isSavingEndpoint ? 'Saving...' : 'Update URL'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Ollama Model Selection */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                            Ollama Model
                          </label>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            Active: {selectedOllamaModel}
                          </span>
                        </div>

                        <select
                          value={selectedOllamaModel}
                          onChange={(e) => handleModelChange(e.target.value)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            backgroundColor: 'rgba(0, 0, 0, 0.4)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-primary)',
                            fontSize: '11.5px',
                            outline: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          <option value="qwen2.5-coder:3b">
                            qwen2.5-coder:3b (Installed • Default • High-speed coding)
                          </option>
                          <option value="llama3.2:3b">
                            llama3.2:3b (Compact Llama model)
                          </option>
                          <option value="deepseek-r1:1.5b">
                            deepseek-r1:1.5b (Compact reasoning model)
                          </option>
                        </select>
                      </div>

                      {/* Ollama Actions: Verify Daemon & Model */}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '2px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={handleVerifyConnection}
                          disabled={isVerifyingKey}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 500,
                            color: '#fff',
                            backgroundColor: 'var(--accent-emerald)',
                            border: 'none',
                            cursor: isVerifyingKey ? 'default' : 'pointer',
                            opacity: isVerifyingKey ? 0.7 : 1,
                          }}
                          title="Verify local Ollama daemon and model availability via /api/tags"
                        >
                          <Zap size={12} />
                          <span>{isVerifyingKey ? 'Checking Daemon...' : 'Verify Local Connection'}</span>
                        </button>
                        <span style={{ fontSize: '11px', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={12} />
                          <span>No API Key Required (100% Local AI)</span>
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Cloud Model Selection Field */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                            {selectedProviderTab === 'gemini' ? 'Gemini Model' : 'OpenAI Model'}
                          </label>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            Selected: {selectedProviderTab === 'gemini' ? selectedGeminiModel : selectedOpenAiModel}
                          </span>
                        </div>

                        {selectedProviderTab === 'gemini' ? (
                          <select
                            value={normalizeGeminiModel(selectedGeminiModel)}
                            onChange={(e) => handleModelChange(e.target.value)}
                            style={{
                              padding: '6px 10px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(0, 0, 0, 0.4)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-primary)',
                              fontSize: '11.5px',
                              outline: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            <option value="gemini-3.8-flash">gemini-3.8-flash (Recommended default • High speed & reasoning)</option>
                            <option value="gemini-2.5-flash">gemini-2.5-flash (High efficiency, low latency)</option>
                            <option value="gemini-2.5-pro">gemini-2.5-pro (Complex reasoning & deep multimodal analysis)</option>
                          </select>
                        ) : (
                          <select
                            value={selectedOpenAiModel}
                            onChange={(e) => handleModelChange(e.target.value)}
                            style={{
                              padding: '6px 10px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(0, 0, 0, 0.4)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-primary)',
                              fontSize: '11.5px',
                              outline: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            <option value="gpt-4o-mini">gpt-4o-mini (Fast, cost-efficient default)</option>
                            <option value="gpt-4o">gpt-4o (Flagship multimodal intelligence)</option>
                            <option value="gpt-4-turbo">gpt-4-turbo (High capacity model)</option>
                            <option value="o3-mini">o3-mini (Advanced STEM reasoning)</option>
                          </select>
                        )}
                      </div>

                      {/* API Key Input Form */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                          {selectedProviderTab === 'gemini' ? 'Google Gemini API Key' : 'OpenAI API Key'}
                        </label>

                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                          <input
                            type={showKey ? 'text' : 'password'}
                            value={apiKeyInput}
                            onChange={(e) => {
                              setApiKeyInput(e.target.value);
                              if (keyOpFeedback) setKeyOpFeedback(null);
                            }}
                            placeholder={
                              isCurrentTabConfigured
                                ? 'Credential stored in Windows Vault. Enter new key to replace...'
                                : selectedProviderTab === 'gemini'
                                ? 'Enter Gemini API key (e.g. AQ... or AIza...)'
                                : 'Enter OpenAI API key (sk-...)'
                            }
                            autoComplete="off"
                            spellCheck="false"
                            style={{
                              width: '100%',
                              padding: '7px 32px 7px 10px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(0, 0, 0, 0.4)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-primary)',
                              fontSize: '11.5px',
                              fontFamily: 'monospace',
                              outline: 'none',
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKey(!showKey)}
                            style={{
                              position: 'absolute',
                              right: '6px',
                              padding: '4px',
                              color: 'var(--text-muted)',
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                            }}
                            title={showKey ? 'Mask key' : 'Show key'}
                          >
                            {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '2px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={handleSaveKey}
                            disabled={isSavingKey || !apiKeyInput.trim()}
                            style={{
                              flex: 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '5px',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 500,
                              color: '#fff',
                              backgroundColor:
                                !apiKeyInput.trim()
                                  ? selectedProviderTab === 'gemini'
                                    ? 'rgba(6, 182, 212, 0.3)'
                                    : 'rgba(99, 102, 241, 0.3)'
                                  : selectedProviderTab === 'gemini'
                                  ? 'var(--accent-cyan)'
                                  : 'var(--accent-indigo)',
                              cursor: !apiKeyInput.trim() || isSavingKey ? 'not-allowed' : 'pointer',
                              opacity: isSavingKey ? 0.7 : 1,
                            }}
                          >
                            <Key size={12} />
                            <span>{isSavingKey ? 'Saving to Vault...' : 'Save Credential'}</span>
                          </button>

                          {isCurrentTabConfigured && (
                            <>
                              <button
                                type="button"
                                onClick={handleVerifyConnection}
                                disabled={isVerifyingKey}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '6px 10px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  color: 'var(--accent-cyan)',
                                  backgroundColor: 'rgba(6, 182, 212, 0.1)',
                                  border: '1px solid rgba(6, 182, 212, 0.3)',
                                  cursor: isVerifyingKey ? 'default' : 'pointer',
                                  opacity: isVerifyingKey ? 0.6 : 1,
                                }}
                                title={`Verify authentication against ${selectedProviderTab === 'gemini' ? 'Google AI Studio models' : 'OpenAI /v1/models'}`}
                              >
                                <Zap size={12} />
                                <span>{isVerifyingKey ? 'Verifying...' : 'Verify'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={handleDeleteKey}
                                disabled={isDeletingKey}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '6px 8px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  color: 'var(--accent-rose)',
                                  backgroundColor: 'rgba(244, 63, 94, 0.1)',
                                  border: '1px solid rgba(244, 63, 94, 0.25)',
                                  cursor: isDeletingKey ? 'default' : 'pointer',
                                }}
                                title="Remove key from Windows Credential Manager"
                              >
                                <Trash2 size={12} />
                                <span>Remove</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Operation Feedback Banner */}
                  {keyOpFeedback && (
                    <div
                      style={{
                        padding: '6px 10px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        backgroundColor:
                          keyOpFeedback.type === 'success'
                            ? 'rgba(16, 185, 129, 0.1)'
                            : 'rgba(244, 63, 94, 0.1)',
                        border: `1px solid ${
                          keyOpFeedback.type === 'success'
                            ? 'rgba(16, 185, 129, 0.3)'
                            : 'rgba(244, 63, 94, 0.3)'
                        }`,
                        color:
                          keyOpFeedback.type === 'success'
                            ? 'var(--accent-emerald)'
                            : 'var(--accent-rose)',
                      }}
                    >
                      {keyOpFeedback.type === 'success' ? (
                        <CheckCircle2 size={12} style={{ flexShrink: 0 }} />
                      ) : (
                        <AlertCircle size={12} style={{ flexShrink: 0 }} />
                      )}
                      <span>{keyOpFeedback.message}</span>
                    </div>
                  )}

                  {/* Provider Billing & Privacy Disclaimers */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      paddingTop: '6px',
                      borderTop: '1px solid rgba(255, 255, 255, 0.04)',
                      fontSize: '10.5px',
                      color: 'var(--text-muted)',
                      lineHeight: '1.4',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '5px' }}>
                      {selectedProviderTab === 'ollama' ? (
                        <>
                          <ShieldCheck size={12} style={{ color: 'var(--accent-emerald)', flexShrink: 0, marginTop: '1px' }} />
                          <span>
                            <strong>100% Local & Offline Privacy:</strong> Inferences run completely on your local machine using Ollama. No prompt data, tokens, or telemetry leave your machine.
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={12} style={{ color: 'var(--accent-amber)', flexShrink: 0, marginTop: '1px' }} />
                          <span>
                            {selectedProviderTab === 'gemini' ? (
                              <>
                                <strong>Google Gemini API:</strong> Calls are made directly to <code>generativelanguage.googleapis.com</code>. Check API limits or billing in{' '}
                                <a
                                  href="https://aistudio.google.com/"
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: 'var(--accent-cyan)', textDecoration: 'underline' }}
                                >
                                  Google AI Studio
                                </a>.
                              </>
                            ) : (
                              <>
                                <strong>OpenAI API Charges:</strong> Requests make direct calls to <code>api.openai.com</code>. Check account billing at{' '}
                                <a
                                  href="https://platform.openai.com/billing"
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: 'var(--accent-indigo)', textDecoration: 'underline' }}
                                >
                                  platform.openai.com/billing
                                </a>.
                              </>
                            )}
                          </span>
                        </>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '5px' }}>
                      <ShieldCheck size={12} style={{ color: 'var(--accent-emerald)', flexShrink: 0, marginTop: '1px' }} />
                      <span>
                        <strong>Windows Credential Store:</strong> Cloud API keys (Gemini & OpenAI) remain securely encrypted in Windows Credential Manager without conflicts.
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Section 1: Appearance & Theme */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <Palette size={14} style={{ color: 'var(--accent-indigo)' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Appearance Theme
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {themes.map((t) => {
              const isSelected = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTheme(t.id);
                    onNotify?.(`Theme changed to ${t.name}`);
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                    border: isSelected ? '1px solid rgba(99, 102, 241, 0.45)' : '1px solid var(--border-subtle)',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: isSelected ? 'var(--accent-indigo)' : 'var(--text-primary)' }}>
                      {t.name}
                    </span>
                    {isSelected && <CheckCircle2 size={13} style={{ color: 'var(--accent-indigo)' }} />}
                  </div>
                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {t.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 2: Shortcuts & Conflict Check */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <Keyboard size={14} style={{ color: 'var(--accent-cyan)' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Registered Keyboard Shortcuts
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              padding: '10px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
            }}
          >
            {MOCK_SHORTCUTS.map((s, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '11.5px',
                  padding: '4px 0',
                  borderBottom: idx !== MOCK_SHORTCUTS.length - 1 ? '1px solid rgba(255, 255, 255, 0.04)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="tooltip-shortcut" style={{ padding: '2px 6px', fontSize: '11px', color: 'var(--text-primary)' }}>
                    {s.key}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{s.action}</span>
                </div>
                <span
                  style={{
                    fontSize: '10.5px',
                    color: s.conflict.includes('None') ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                  }}
                >
                  {s.conflict}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Section 3: Desktop Window Behavior */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <Monitor size={14} style={{ color: 'var(--accent-emerald)' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Window Overlay Behavior
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              padding: '10px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 500 }}>Always on Top</div>
                <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                  Keep toolbar floating above other application windows
                </div>
              </div>
              <input
                type="checkbox"
                checked={alwaysOnTop}
                onChange={(e) => {
                  setAlwaysOnTop(e.target.checked);
                  onNotify?.(e.target.checked ? 'Always on Top enabled' : 'Always on Top disabled');
                }}
                style={{ accentColor: 'var(--accent-emerald)', cursor: 'pointer' }}
              />
            </div>
          </div>
        </div>

        {/* Section 4: Privacy & Screen Share Exclusion (Strictly marked simulated) */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <Shield size={14} style={{ color: 'var(--accent-rose)' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Privacy & Screen-Share Focus Mode
            </span>
          </div>
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              backgroundColor: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#fbbf24' }}>
                  Simulated Focus Mode (Phase 1 Preview)
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Simulates toolbar invisibility during screen broadcasts.
                </div>
              </div>
              <input
                type="checkbox"
                checked={privacyMode}
                onChange={(e) => {
                  setPrivacyMode(e.target.checked);
                  onNotify?.(e.target.checked ? 'Privacy Mode Preview: ON' : 'Privacy Mode Preview: OFF');
                }}
                style={{ accentColor: 'var(--accent-amber)', cursor: 'pointer' }}
              />
            </div>

            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                lineHeight: '1.4',
                paddingTop: '6px',
                borderTop: '1px solid rgba(245, 158, 11, 0.15)',
              }}
            >
              <AlertTriangle size={12} style={{ display: 'inline', marginRight: '4px', color: '#fbbf24' }} />
              <strong>Strict Phase 1 Limitation Notice:</strong> Native Windows API exclusion (e.g.{' '}
              <code>SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)</code>) is non-functional in Phase 1 and will be
              implemented via native Tauri Rust plugins in Phase 2.
            </div>
          </div>
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
        <span>OmniPilot AI • Windows Desktop v1.0.0</span>
        <span>Original Implementation</span>
      </div>
    </div>
  );
}
