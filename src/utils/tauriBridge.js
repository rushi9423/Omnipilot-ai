// Tauri 2 Bridge with graceful web fallback
// Connects to native desktop capabilities when running in Tauri 2 desktop shell,
// and provides safe fallback emulation when running in Vite dev/preview.

import { getCurrentWindow, cursorPosition } from '@tauri-apps/api/window';
import { isTauri, invoke, Channel } from '@tauri-apps/api/core';

// Internal module state for click-through deduping and drag safety
let currentIgnoreState = false;
let isIpcPending = false;
let isNativeDragging = false;
let cachedOuterPosition = null;
let lastOuterPositionCheck = 0;

export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:3b';

// Ephemeral in-memory state for browser/test fallback (never persisted to storage)
let mockActiveProvider = 'ollama';
let mockOpenAiKeyConfigured = false;
let mockGeminiKeyConfigured = false;
let mockOpenAiModel = 'gpt-4o-mini';
let mockGeminiModel = 'gemini-3.8-flash';
let mockOllamaModel = 'qwen2.5-coder:3b';
let mockOllamaEndpoint = 'http://127.0.0.1:11434';
let mockActiveStreams = new Set();

/**
 * Normalizes a Gemini model identifier, migrating retired/obsolete models to gemini-3.8-flash.
 */
export function normalizeGeminiModel(model) {
  const trimmed = (model || '').trim();
  if (
    !trimmed ||
    trimmed === 'gemini-2.0-flash' ||
    trimmed === 'gemini-2.0-flash-lite' ||
    trimmed === 'gemini-1.5-flash' ||
    trimmed === 'gemini-1.5-pro' ||
    trimmed.startsWith('gemini-1.5') ||
    trimmed.startsWith('gemini-2.0')
  ) {
    return 'gemini-3.8-flash';
  }
  return trimmed;
}

export function isTauriEnvironment() {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(
      (typeof isTauri === 'function' && isTauri()) ||
      window.isTauri ||
      (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.metadata) ||
      window.__TAURI__
    );
  } catch {
    return false;
  }
}

/**
 * Checks whether an active window drag operation is currently in progress.
 */
export function isDraggingActive() {
  return isNativeDragging;
}

/**
 * Sets the active drag state flag.
 */
export function setDraggingActive(active) {
  isNativeDragging = Boolean(active);
  if (active) {
    // While dragging, cursor events must never be ignored
    nativeSetIgnoreCursorEvents(false);
  }
}

/**
 * Sets whether the native Tauri window should ignore cursor events (click-through mode).
 * - Deduplicates repeated calls with identical desired states.
 * - Prevents enabling click-through while an active drag is in progress.
 * - Handles asynchronous IPC errors safely.
 */
export async function nativeSetIgnoreCursorEvents(ignore) {
  if (!isTauriEnvironment()) return false;

  const targetState = Boolean(ignore);

  // If already in target state, skip repeated IPC call
  if (currentIgnoreState === targetState) {
    return true;
  }

  // Never enable click-through during active dragging
  if (targetState && isNativeDragging) {
    return false;
  }

  // Prevent overlapping concurrent IPC invocations
  if (isIpcPending) {
    return false;
  }

  isIpcPending = true;
  try {
    const win = getCurrentWindow();
    if (win && typeof win.setIgnoreCursorEvents === 'function') {
      await win.setIgnoreCursorEvents(targetState);
      currentIgnoreState = targetState;
      return true;
    }
  } catch (err) {
    console.warn('Tauri setIgnoreCursorEvents error:', err);
  } finally {
    isIpcPending = false;
  }
  return false;
}

/**
 * Returns current click-through ignore state in memory.
 */
export function getNativeIgnoreCursorState() {
  return currentIgnoreState;
}

/**
 * Retrieves the current native cursor position (physical screen pixels)
 * and the window's outer position and DPI scale factor.
 * Used for reliable hit-testing when click-through is enabled and DOM events are suppressed.
 */
export async function getNativeCursorAndWindowBounds() {
  if (!isTauriEnvironment()) return null;

  try {
    const win = getCurrentWindow();
    if (!win) return null;

    const now = Date.now();
    // Cache outerPosition briefly (120ms) unless invalidated by move/drag
    let outerPos = cachedOuterPosition;
    if (!outerPos || now - lastOuterPositionCheck > 120) {
      outerPos = await win.outerPosition();
      cachedOuterPosition = outerPos;
      lastOuterPositionCheck = now;
    }

    const cursor = await cursorPosition();
    const scale = window.devicePixelRatio || 1;

    return {
      cursorX: cursor.x,
      cursorY: cursor.y,
      windowX: outerPos.x,
      windowY: outerPos.y,
      scale,
    };
  } catch (err) {
    // Silently return null for transient errors during window lifecycle transitions
    return null;
  }
}

/**
 * Invalidates the cached window position (e.g. after a drag or move event).
 */
export function invalidateCachedWindowPosition() {
  cachedOuterPosition = null;
  lastOuterPositionCheck = 0;
}

/**
 * Initiates native window dragging across the Windows desktop using Tauri 2 Window API.
 * Calls getCurrentWindow().startDragging() synchronously on mousedown to ensure
 * the Windows OS message loop captures the drag operation immediately.
 */
export function nativeStartDragging(e) {
  // Only primary (left) mouse button triggers window dragging
  if (e && e.button !== undefined && e.button !== 0) {
    return false;
  }

  // Never drag if clicked on interactive controls
  if (e && e.target && e.target.closest && e.target.closest('button, input, select, textarea, [data-no-drag], .no-drag')) {
    return false;
  }

  if (isTauriEnvironment()) {
    try {
      const win = getCurrentWindow();
      if (win && typeof win.startDragging === 'function') {
        setDraggingActive(true);
        const dragPromise = win.startDragging();
        if (dragPromise && typeof dragPromise.then === 'function') {
          dragPromise
            .catch((err) => console.warn('Tauri startDragging error:', err))
            .finally(() => {
              invalidateCachedWindowPosition();
              setTimeout(() => {
                setDraggingActive(false);
              }, 80);
            });
        } else {
          setTimeout(() => {
            invalidateCachedWindowPosition();
            setDraggingActive(false);
          }, 500);
        }
        return true;
      }
    } catch (err) {
      console.warn('Tauri native startDragging error:', err);
      setDraggingActive(false);
    }
  }
  return false;
}

export async function nativeSetAlwaysOnTop(alwaysOnTop) {
  if (isTauriEnvironment()) {
    try {
      const win = getCurrentWindow();
      if (win && typeof win.setAlwaysOnTop === 'function') {
        await win.setAlwaysOnTop(alwaysOnTop);
        return true;
      }
    } catch (err) {
      console.warn('Tauri setAlwaysOnTop fallback:', err);
    }
  }
  return false;
}

export async function nativeMinimizeWindow() {
  if (isTauriEnvironment()) {
    try {
      const win = getCurrentWindow();
      if (win && typeof win.minimize === 'function') {
        await win.minimize();
        return true;
      }
    } catch (err) {
      console.warn('Tauri minimize fallback:', err);
    }
  }
  return false;
}

/**
 * Queries the native Rust backend status, including application metadata,
 * native health, environment runtime, and accurate AI service readiness.
 * Gracefully returns browser preview diagnostics when running outside Tauri.
 */
export async function nativeGetBackendStatus() {
  if (isTauriEnvironment()) {
    try {
      const status = await invoke('get_backend_status');
      return {
        ...status,
        isTauri: true,
      };
    } catch (err) {
      console.warn('Tauri get_backend_status error:', err);
      return {
        appName: 'OmniPilot AI',
        appVersion: '0.1.0',
        status: 'degraded',
        isTauri: true,
        os: 'windows',
        ai: {
          state: 'error',
          provider: 'none',
          model: null,
          message: `Backend query failed: ${err?.message || err}`,
          keyConfigured: false,
          endpoint: null,
        },
        timestampMs: Date.now(),
      };
    }
  }

  // Graceful browser development / test fallback
  const isOllama = mockActiveProvider === 'ollama';
  const activeKeyConfigured = isOllama
    ? true
    : mockActiveProvider === 'gemini'
    ? mockGeminiKeyConfigured
    : mockOpenAiKeyConfigured;
  const activeModel = isOllama
    ? mockOllamaModel
    : mockActiveProvider === 'gemini'
    ? mockGeminiModel
    : mockOpenAiModel;
  const activeEndpoint = isOllama ? mockOllamaEndpoint : null;

  return {
    appName: 'OmniPilot AI',
    appVersion: '0.1.0',
    status: 'healthy',
    isTauri: false,
    os: typeof navigator !== 'undefined' ? navigator.platform || 'web' : 'node-environment',
    ai: {
      state: isOllama ? 'configured' : activeKeyConfigured ? 'configured' : 'unconfigured',
      provider: mockActiveProvider,
      model: activeModel,
      message: isOllama
        ? `Running in browser/test preview mode. Local Ollama provider selected (${mockOllamaEndpoint}). No API key required.`
        : `Running in browser/test preview mode. ${mockActiveProvider === 'gemini' ? 'Google Gemini' : 'OpenAI'} provider selected. ${activeKeyConfigured ? 'Key configured.' : 'API key required.'}`,
      keyConfigured: activeKeyConfigured,
      endpoint: activeEndpoint,
      openaiConfigured: mockOpenAiKeyConfigured,
      geminiConfigured: mockGeminiKeyConfigured,
      ollamaConfigured: true,
      openaiModel: mockOpenAiModel,
      geminiModel: mockGeminiModel,
      ollamaModel: mockOllamaModel,
      ollamaEndpoint: mockOllamaEndpoint,
    },
    timestampMs: Date.now(),
  };
}

/**
 * Queries the AI service readiness state from the native Rust backend.
 */
export async function nativeGetAiReadiness() {
  if (isTauriEnvironment()) {
    try {
      return await invoke('get_ai_readiness');
    } catch (err) {
      console.warn('Tauri get_ai_readiness error:', err);
      return {
        state: 'error',
        provider: 'ollama',
        model: 'qwen2.5-coder:3b',
        message: `Failed to inspect AI readiness: ${err?.message || err}`,
        keyConfigured: false,
        endpoint: null,
      };
    }
  }

  const isOllama = mockActiveProvider === 'ollama';
  const activeKeyConfigured = isOllama
    ? true
    : mockActiveProvider === 'gemini'
    ? mockGeminiKeyConfigured
    : mockOpenAiKeyConfigured;
  const activeModel = isOllama
    ? mockOllamaModel
    : mockActiveProvider === 'gemini'
    ? mockGeminiModel
    : mockOpenAiModel;
  const activeEndpoint = isOllama ? mockOllamaEndpoint : null;

  return {
    state: isOllama ? 'configured' : activeKeyConfigured ? 'configured' : 'unconfigured',
    provider: mockActiveProvider,
    model: activeModel,
    message: isOllama
      ? `Local Ollama provider selected (${mockOllamaEndpoint}). Model: '${mockOllamaModel}'. No API key required.`
      : activeKeyConfigured
      ? `${mockActiveProvider === 'gemini' ? 'Gemini' : 'OpenAI'} credential securely stored in preview memory.`
      : `${mockActiveProvider === 'gemini' ? 'Gemini' : 'OpenAI'} provider selected. API key required. Please configure your API key in Settings.`,
    keyConfigured: activeKeyConfigured,
    endpoint: activeEndpoint,
    openaiConfigured: mockOpenAiKeyConfigured,
    geminiConfigured: mockGeminiKeyConfigured,
    ollamaConfigured: true,
    openaiModel: mockOpenAiModel,
    geminiModel: mockGeminiModel,
    ollamaModel: mockOllamaModel,
    ollamaEndpoint: mockOllamaEndpoint,
  };
}

/**
 * Sets the active AI provider ('ollama', 'openai', or 'gemini').
 */
export async function nativeSetAiProvider(provider) {
  const norm = (provider || '').trim().toLowerCase();
  if (norm !== 'openai' && norm !== 'gemini' && norm !== 'ollama') {
    throw new Error('Unsupported AI provider. Choose "ollama", "openai", or "gemini".');
  }

  if (isTauriEnvironment()) {
    return await invoke('set_ai_provider', { provider: norm });
  }

  mockActiveProvider = norm;
  return await nativeGetAiReadiness();
}

/**
 * Validates provider configuration parameters without sending credentials over network.
 */
export async function nativeValidateAiProviderConfig(provider, model, endpoint) {
  if (isTauriEnvironment()) {
    try {
      return await invoke('validate_ai_provider_config', { provider, model, endpoint });
    } catch (err) {
      return {
        valid: false,
        message: `Validation failed: ${err?.message || err}`,
      };
    }
  }

  // Frontend web fallback validation
  if (provider === 'none') {
    return { valid: true, message: 'Local mock mode active.' };
  }
  if (provider === 'ollama') {
    if (!model || !model.trim()) {
      return { valid: false, message: 'Ollama model identifier cannot be empty.' };
    }
    const ep = endpoint || DEFAULT_OLLAMA_ENDPOINT;
    if (!ep.startsWith('http://') && !ep.startsWith('https://')) {
      return { valid: false, message: 'Ollama base URL must begin with http:// or https://' };
    }
    return { valid: true, message: `Configuration structure valid for Ollama (${model} at ${ep}).` };
  }
  if (provider === 'openai' && (!model || !model.trim())) {
    return { valid: false, message: 'OpenAI model identifier cannot be empty.' };
  }
  if (provider === 'gemini' && (!model || !model.trim())) {
    return { valid: false, message: 'Gemini model identifier cannot be empty.' };
  }
  if (provider === 'anthropic' && (!model || !model.trim())) {
    return { valid: false, message: 'Anthropic model identifier cannot be empty.' };
  }
  if (provider === 'custom' && (!endpoint || (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')))) {
    return { valid: false, message: 'Custom endpoint must begin with http:// or https://' };
  }
  return { valid: true, message: `Configuration structure valid for ${provider}.` };
}

/**
 * Saves an API key for a specific provider ('openai' or 'gemini') securely using Windows Credential Manager.
 * The key is sent over local IPC directly to the Rust backend and is NEVER returned or stored in web storage.
 */
export async function nativeSaveProviderApiKey(provider, key) {
  const norm = (provider || '').trim().toLowerCase();
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error('API key cannot be empty.');
  }

  if (isTauriEnvironment()) {
    return await invoke('save_provider_api_key', { provider: norm, key: key.trim() });
  }

  // Fallback for browser preview / mock testing
  if (norm === 'gemini') {
    mockGeminiKeyConfigured = true;
    mockActiveProvider = 'gemini';
  } else {
    mockOpenAiKeyConfigured = true;
    mockActiveProvider = 'openai';
  }
  return await nativeGetAiReadiness();
}

/**
 * Removes the stored credential for a specific provider from Windows Credential Manager.
 */
export async function nativeDeleteProviderApiKey(provider) {
  const norm = (provider || '').trim().toLowerCase();

  if (isTauriEnvironment()) {
    return await invoke('delete_provider_api_key', { provider: norm });
  }

  if (norm === 'gemini') {
    mockGeminiKeyConfigured = false;
  } else {
    mockOpenAiKeyConfigured = false;
  }
  return await nativeGetAiReadiness();
}

/**
 * Saves the active provider's API key securely using Windows Credential Manager.
 * Backwards-compatible with previous caller signatures.
 */
export async function nativeSaveApiKey(key) {
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error('API key cannot be empty.');
  }

  if (isTauriEnvironment()) {
    return await invoke('save_api_key', { key: key.trim() });
  }

  const target = mockActiveProvider === 'gemini' ? 'gemini' : 'openai';
  return await nativeSaveProviderApiKey(target, key);
}

/**
 * Removes the stored active provider's credential from Windows Credential Manager.
 */
export async function nativeDeleteApiKey() {
  if (isTauriEnvironment()) {
    return await invoke('delete_api_key');
  }

  const target = mockActiveProvider === 'gemini' ? 'gemini' : 'openai';
  return await nativeDeleteProviderApiKey(target);
}

/**
 * Configures the active AI model identifier for the currently active provider.
 */
export async function nativeSetAiModel(model) {
  if (!model || typeof model !== 'string' || !model.trim()) {
    throw new Error('Model identifier cannot be empty.');
  }

  if (isTauriEnvironment()) {
    return await invoke('set_ai_model', { model: model.trim() });
  }

  if (mockActiveProvider === 'ollama') {
    mockOllamaModel = model.trim();
  } else if (mockActiveProvider === 'gemini') {
    mockGeminiModel = normalizeGeminiModel(model);
  } else {
    mockOpenAiModel = model.trim();
  }
  return await nativeGetAiReadiness();
}

/**
 * Configures the model identifier for a specific provider.
 */
export async function nativeSetProviderAiModel(provider, model) {
  const norm = (provider || '').trim().toLowerCase();
  if (!model || typeof model !== 'string' || !model.trim()) {
    throw new Error('Model identifier cannot be empty.');
  }

  if (isTauriEnvironment()) {
    return await invoke('set_provider_ai_model', { provider: norm, model: model.trim() });
  }

  if (norm === 'ollama') {
    mockOllamaModel = model.trim();
  } else if (norm === 'gemini') {
    mockGeminiModel = normalizeGeminiModel(model);
  } else {
    mockOpenAiModel = model.trim();
  }
  return await nativeGetAiReadiness();
}

/**
 * Configures the base endpoint URL for the active AI provider.
 */
export async function nativeSetAiEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'string' || !endpoint.trim()) {
    throw new Error('Endpoint URL cannot be empty.');
  }

  if (isTauriEnvironment()) {
    return await invoke('set_ai_endpoint', { endpoint: endpoint.trim() });
  }

  mockOllamaEndpoint = endpoint.trim().replace(/\/+$/, '');
  return await nativeGetAiReadiness();
}

/**
 * Configures the base endpoint URL for a specific AI provider.
 */
export async function nativeSetProviderAiEndpoint(provider, endpoint) {
  const norm = (provider || '').trim().toLowerCase();
  if (!endpoint || typeof endpoint !== 'string' || !endpoint.trim()) {
    throw new Error('Endpoint URL cannot be empty.');
  }

  if (isTauriEnvironment()) {
    return await invoke('set_provider_ai_endpoint', { provider: norm, endpoint: endpoint.trim() });
  }

  if (norm === 'ollama') {
    mockOllamaEndpoint = endpoint.trim().replace(/\/+$/, '');
  }
  return await nativeGetAiReadiness();
}

/**
 * Verifies the configured provider credential or local endpoint availability.
 * Optionally accepts a provider identifier ('ollama', 'openai', or 'gemini').
 */
export async function nativeVerifyAiProviderConnection(provider) {
  const targetProvider = provider ? provider.trim().toLowerCase() : null;

  if (isTauriEnvironment()) {
    return await invoke('verify_ai_provider_connection', { provider: targetProvider });
  }

  const checkProvider = targetProvider || mockActiveProvider;

  if (checkProvider === 'ollama') {
    return {
      state: 'ready',
      provider: 'ollama',
      model: mockOllamaModel,
      message: `Browser preview: Connected to local Ollama server at ${mockOllamaEndpoint}. Model '${mockOllamaModel}' ready.`,
      keyConfigured: true,
      endpoint: mockOllamaEndpoint,
      openaiConfigured: mockOpenAiKeyConfigured,
      geminiConfigured: mockGeminiKeyConfigured,
      ollamaConfigured: true,
      openaiModel: mockOpenAiModel,
      geminiModel: mockGeminiModel,
      ollamaModel: mockOllamaModel,
      ollamaEndpoint: mockOllamaEndpoint,
    };
  }

  const isConfigured =
    checkProvider === 'gemini' ? mockGeminiKeyConfigured : mockOpenAiKeyConfigured;

  if (!isConfigured) {
    throw new Error(`No ${checkProvider === 'gemini' ? 'Gemini' : 'OpenAI'} API key configured to verify.`);
  }

  return {
    state: 'ready',
    provider: checkProvider,
    model: checkProvider === 'gemini' ? mockGeminiModel : mockOpenAiModel,
    message: `Browser preview: ${checkProvider === 'gemini' ? 'Gemini' : 'OpenAI'} connection simulated as verified.`,
    keyConfigured: true,
    endpoint: null,
    openaiConfigured: mockOpenAiKeyConfigured,
    geminiConfigured: mockGeminiKeyConfigured,
    ollamaConfigured: true,
    openaiModel: mockOpenAiModel,
    geminiModel: mockGeminiModel,
    ollamaModel: mockOllamaModel,
    ollamaEndpoint: mockOllamaEndpoint,
  };
}

/**
 * Requests cancellation of an in-flight streaming response by request ID.
 */
export async function nativeCancelStream(requestId) {
  if (!requestId) return false;

  if (isTauriEnvironment()) {
    try {
      return await invoke('cancel_stream', { requestId });
    } catch (err) {
      console.warn('nativeCancelStream error:', err);
      return false;
    }
  }

  if (mockActiveStreams.has(requestId)) {
    mockActiveStreams.delete(requestId);
    return true;
  }
  return false;
}

/**
 * Streams real AI Answer generation from Rust to React via Tauri 2 IPC Channel.
 */
export async function nativeStreamAiAnswer({
  requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  prompt,
  model,
  onChunk,
  onDone,
  onError,
  onCancelled,
}) {
  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt cannot be empty.');
  }

  if (isTauriEnvironment()) {
    const channel = new Channel();
    channel.onmessage = (event) => {
      if (!event) return;
      switch (event.type) {
        case 'chunk':
          onChunk?.(event.payload);
          break;
        case 'done':
          onDone?.();
          break;
        case 'error':
          onError?.(event.payload);
          break;
        case 'cancelled':
          onCancelled?.();
          break;
        default:
          break;
      }
    };

    return await invoke('stream_ai_answer', {
      request: {
        requestId,
        prompt: prompt.trim(),
        model: model ? model.trim() : null,
      },
      onEvent: channel,
    });
  }

  // Graceful browser / test preview fallback streaming
  mockActiveStreams.add(requestId);
  const sampleTokens = [
    'Here is ', 'the synthesized ', 'solution for: "', prompt.slice(0, 30), '...":\n\n',
    '```javascript\n',
    '// Streamed via OmniPilot AI\n',
    'export function executeTask() {\n',
    '  console.log("Verified streaming logic");\n',
    '}\n',
    '```\n\n',
    'Key takeaway: Responses deliver progressively without UI freezing.',
  ];

  let i = 0;
  const interval = setInterval(() => {
    if (!mockActiveStreams.has(requestId)) {
      clearInterval(interval);
      onCancelled?.();
      return;
    }

    if (i < sampleTokens.length) {
      onChunk?.(sampleTokens[i]);
      i++;
    } else {
      clearInterval(interval);
      mockActiveStreams.delete(requestId);
      onDone?.();
    }
  }, 20);

  return { requestId };
}

/**
 * Streams multi-turn chat completions from Rust to React via Tauri 2 IPC Channel.
 */
export async function nativeStreamChat({
  requestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  messages,
  model,
  onChunk,
  onDone,
  onError,
  onCancelled,
}) {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages array cannot be empty.');
  }

  if (isTauriEnvironment()) {
    const channel = new Channel();
    channel.onmessage = (event) => {
      if (!event) return;
      switch (event.type) {
        case 'chunk':
          onChunk?.(event.payload);
          break;
        case 'done':
          onDone?.();
          break;
        case 'error':
          onError?.(event.payload);
          break;
        case 'cancelled':
          onCancelled?.();
          break;
        default:
          break;
      }
    };

    return await invoke('stream_chat_completion', {
      request: {
        requestId,
        messages: messages.map((m) => ({
          role: m.role || (m.sender === 'assistant' ? 'assistant' : 'user'),
          content: m.content || m.text || '',
        })),
        model: model ? model.trim() : null,
      },
      onEvent: channel,
    });
  }

  // Graceful browser / test preview fallback streaming
  mockActiveStreams.add(requestId);
  const lastUserMsg = messages[messages.length - 1]?.text || 'your prompt';
  const sampleTokens = [
    'I processed ', 'your message: ', `"${lastUserMsg.slice(0, 25)}".\n\n`,
    'In browser fallback mode, ', 'streaming demonstrates token-by-token ', 'rendering before native Windows Credential Manager ', 'is invoked.',
  ];

  let i = 0;
  const interval = setInterval(() => {
    if (!mockActiveStreams.has(requestId)) {
      clearInterval(interval);
      onCancelled?.();
      return;
    }

    if (i < sampleTokens.length) {
      onChunk?.(sampleTokens[i]);
      i++;
    } else {
      clearInterval(interval);
      mockActiveStreams.delete(requestId);
      onDone?.();
    }
  }, 20);

  return { requestId };
}



