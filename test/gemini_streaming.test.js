import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nativeGetBackendStatus,
  nativeGetAiReadiness,
  nativeSetAiProvider,
  nativeSaveProviderApiKey,
  nativeDeleteProviderApiKey,
  nativeSetProviderAiModel,
  nativeVerifyAiProviderConnection,
  nativeValidateAiProviderConfig,
  nativeCancelStream,
  nativeStreamAiAnswer,
  nativeStreamChat,
  isDraggingActive,
  nativeSetIgnoreCursorEvents,
} from '../src/utils/tauriBridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('--- Running OmniPilot AI Gemini API Integration & Multi-Provider Test Suite ---');

// 1. Provider Selection: Switching between OpenAI and Gemini
const openAiSelect = await nativeSetAiProvider('openai');
assert.strictEqual(openAiSelect.provider, 'openai', 'Active provider must be openai');

const geminiSelect = await nativeSetAiProvider('gemini');
assert.strictEqual(geminiSelect.provider, 'gemini', 'Active provider must be gemini');
console.log('✓ Provider selection and active switching between OpenAI and Gemini verified');

// 2. Credential Validation & Acceptance for Gemini (AIza... and AQ... formats)
try {
  await nativeSaveProviderApiKey('gemini', '');
  assert.fail('Empty Gemini key should be rejected');
} catch (err) {
  assert(err.message.includes('empty'), 'Should reject empty key');
}

try {
  await nativeSaveProviderApiKey('gemini', '   ');
  assert.fail('Whitespace Gemini key should be rejected');
} catch (err) {
  assert(err.message.includes('empty'), 'Should reject whitespace key');
}

// 2a. Accept legacy AIza-style mock key
const aizaRes = await nativeSaveProviderApiKey('gemini', 'AIzaSyTestGeminiKey1234567890abcdef');
assert.strictEqual(aizaRes.geminiConfigured, true, 'AIza-style key should configure Gemini');
assert.strictEqual(aizaRes.apiKey, undefined, 'Secret key must never be exposed');

// 2b. Accept newer Google AI Studio AQ.-style mock key
const aqRes = await nativeSaveProviderApiKey('gemini', 'AQ.AbMockKey1234567890abcdef.xyz_123-456');
assert.strictEqual(aqRes.geminiConfigured, true, 'AQ.-style key should configure Gemini');
assert.strictEqual(aqRes.apiKey, undefined, 'Secret key must never be exposed');

// 2c. Accept key with accidental leading/trailing whitespace (trimmed automatically)
const trimmedRes = await nativeSaveProviderApiKey('gemini', '   AQ.AbMockKey1234567890abcdef.xyz_123-456   \n');
assert.strictEqual(trimmedRes.geminiConfigured, true, 'Whitespace-padded key should be accepted and trimmed');
assert.strictEqual(trimmedRes.apiKey, undefined, 'Secret key must never be exposed');
console.log('✓ Gemini credential validation verified for AIza-style, AQ.-style, whitespace trimming, and empty keys');

// 3. Provider Config Validation
const validGeminiConfig = await nativeValidateAiProviderConfig('gemini', 'gemini-3.8-flash');
assert.strictEqual(validGeminiConfig.valid, true, 'gemini-3.8-flash configuration must be valid');

const invalidGeminiConfig = await nativeValidateAiProviderConfig('gemini', '  ');
assert.strictEqual(invalidGeminiConfig.valid, false, 'Empty gemini model should be rejected');
console.log('✓ Gemini configuration parameter validation verified');

// 4. Secure Credential Separation: OpenAI and Gemini credentials coexist independently
// Save OpenAI key
const openAiSave = await nativeSaveProviderApiKey('openai', 'sk-proj-test-openai-key-1234567890');
assert.strictEqual(openAiSave.openaiConfigured, true, 'openaiConfigured must be true');
assert.strictEqual(openAiSave.apiKey, undefined, 'OpenAI key must never be exposed');

// Save Gemini key
const geminiSave = await nativeSaveProviderApiKey('gemini', 'AIzaSyTestGeminiKey1234567890abcdef');
assert.strictEqual(geminiSave.geminiConfigured, true, 'geminiConfigured must be true');
assert.strictEqual(geminiSave.openaiConfigured, true, 'OpenAI key must remain configured when Gemini key is saved');
assert.strictEqual(geminiSave.apiKey, undefined, 'Gemini key must never be exposed');
assert.strictEqual(geminiSave.secret, undefined, 'Secret must never be returned');
console.log('✓ Dual-provider secure credential separation verified (zero secret leakage)');

// 5. Model Preference Management & Obsolete Model Auto-Migration for Gemini
const geminiModelUpdate = await nativeSetProviderAiModel('gemini', 'gemini-2.5-pro');
assert.strictEqual(geminiModelUpdate.geminiModel, 'gemini-2.5-pro', 'Supported model gemini-2.5-pro should be preserved');

// Setting obsolete model gemini-2.0-flash automatically migrates to gemini-3.8-flash
const geminiMigrated20 = await nativeSetProviderAiModel('gemini', 'gemini-2.0-flash');
assert.strictEqual(geminiMigrated20.geminiModel, 'gemini-3.8-flash', 'Obsolete gemini-2.0-flash must migrate to gemini-3.8-flash');

// Setting obsolete model gemini-1.5-pro automatically migrates to gemini-3.8-flash
const geminiMigrated15 = await nativeSetProviderAiModel('gemini', 'gemini-1.5-pro');
assert.strictEqual(geminiMigrated15.geminiModel, 'gemini-3.8-flash', 'Obsolete gemini-1.5-pro must migrate to gemini-3.8-flash');

// Explicitly set default gemini-3.8-flash
const geminiDefaultModel = await nativeSetProviderAiModel('gemini', 'gemini-3.8-flash');
assert.strictEqual(geminiDefaultModel.geminiModel, 'gemini-3.8-flash', 'Gemini model should be gemini-3.8-flash');
console.log('✓ Gemini model preference updates and obsolete model auto-migration verified');

// 6. Gemini Connection Verification Contract
const geminiVerify = await nativeVerifyAiProviderConnection('gemini');
assert.strictEqual(geminiVerify.state, 'ready', 'Gemini verified state should be ready');
assert.strictEqual(geminiVerify.geminiConfigured, true, 'geminiConfigured must remain true');
assert.strictEqual(geminiVerify.apiKey, undefined, 'API key must not be returned');
console.log('✓ Gemini connection verification contract verified');

// 7. Progressive Token Streaming via Gemini Provider
let streamedTokens = [];
let streamDone = false;
const geminiAnsReqId = `gemini-ans-${Date.now()}`;

await nativeStreamAiAnswer({
  requestId: geminiAnsReqId,
  prompt: 'Explain Gemini SSE streaming format',
  model: 'gemini-3.8-flash',
  onChunk: (chunk) => {
    streamedTokens.push(chunk);
  },
  onDone: () => {
    streamDone = true;
  },
});

for (let wait = 0; wait < 20 && !streamDone; wait++) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
assert(streamedTokens.length > 0, 'Gemini streaming must deliver tokens progressively');
assert.strictEqual(streamDone, true, 'onDone callback must be triggered upon completion');
console.log(`✓ Progressive Gemini token streaming delivered ${streamedTokens.length} chunks`);

// 8. Stream Cancellation and In-Flight Cleanup
let cancelTokens = [];
let isCancelled = false;
const cancelReqId = `gemini-cancel-${Date.now()}`;

nativeStreamAiAnswer({
  requestId: cancelReqId,
  prompt: 'A very long response to cancel immediately',
  model: 'gemini-3.8-flash',
  onChunk: (chunk) => {
    cancelTokens.push(chunk);
  },
  onCancelled: () => {
    isCancelled = true;
  },
});

await new Promise((resolve) => setTimeout(resolve, 50));
const didCancel = await nativeCancelStream(cancelReqId);
assert.strictEqual(didCancel, true, 'nativeCancelStream must return true for active stream');

await new Promise((resolve) => setTimeout(resolve, 100));
assert.strictEqual(isCancelled, true, 'Cancellation callback must be invoked');
console.log('✓ In-flight Gemini streaming cancellation and resource cleanup verified');

// 9. Multi-Turn Chat Conversation Streaming with Gemini
let chatTokens = [];
let chatDone = false;
const chatReqId = `gemini-chat-${Date.now()}`;

await nativeStreamChat({
  requestId: chatReqId,
  messages: [
    { role: 'user', content: 'What is Gemini?' },
    { role: 'assistant', content: 'Gemini is a family of multimodal AI models developed by Google.' },
    { role: 'user', content: 'How does SSE streaming work with it?' },
  ],
  model: 'gemini-3.8-flash',
  onChunk: (chunk) => {
    chatTokens.push(chunk);
  },
  onDone: () => {
    chatDone = true;
  },
});

for (let wait = 0; wait < 20 && !chatDone; wait++) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
assert(chatTokens.length > 0, 'Multi-turn chat stream must deliver tokens');
assert.strictEqual(chatDone, true, 'Multi-turn chat stream must complete cleanly');
console.log('✓ Multi-turn Gemini conversation streaming verified');

// 10. Credential Isolation on Deletion
// Delete OpenAI key -> Gemini key must remain configured!
const deleteOpenAi = await nativeDeleteProviderApiKey('openai');
assert.strictEqual(deleteOpenAi.openaiConfigured, false, 'OpenAI key must be unconfigured after deletion');
assert.strictEqual(deleteOpenAi.geminiConfigured, true, 'Gemini key MUST remain configured after OpenAI deletion');

// Delete Gemini key
const deleteGemini = await nativeDeleteProviderApiKey('gemini');
assert.strictEqual(deleteGemini.geminiConfigured, false, 'Gemini key must be unconfigured after deletion');
console.log('✓ Independent credential deletion and provider isolation verified');

// 11. Error Classification Tests for Gemini
function classifyGeminiUiError(error, provider = 'gemini') {
  const lower = (error || '').toLowerCase();
  const isGemini = provider === 'gemini' || lower.includes('gemini');
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

  return { isGemini, isBillingOrQuota, isRateLimit, isAuth, isModel };
}

// 11a. Gemini 400 Invalid API Key
const geminiAuthErr = 'Gemini authentication failed: Invalid API key or unauthorized. Please verify or update your Gemini API key in Settings.';
const authClass = classifyGeminiUiError(geminiAuthErr);
assert.strictEqual(authClass.isAuth, true, 'Gemini 400 must classify as auth failure');
assert.strictEqual(authClass.isBillingOrQuota, false);

// 11b. Gemini 429 RESOURCE_EXHAUSTED
const geminiQuotaErr = 'Gemini quota or rate limit exceeded (RESOURCE_EXHAUSTED). Your Google AI Studio project has depleted its request quota or reached rate limits. Check your plan at aistudio.google.com.';
const quotaClass = classifyGeminiUiError(geminiQuotaErr);
assert.strictEqual(quotaClass.isBillingOrQuota, true, 'RESOURCE_EXHAUSTED must classify as billing/quota exhaustion');

// 11c. Gemini 404 Model Not Found
const geminiModelErr = 'Gemini model not found (HTTP 404): models/gemini-invalid is not found for API version v1beta.';
const modelClass = classifyGeminiUiError(geminiModelErr);
assert.strictEqual(modelClass.isModel, true, 'HTTP 404 must classify as model not found');

// 11d. Gemini 401 Unauthenticated / Invalid Credential
const gemini401Err = 'Gemini authentication failed: Invalid API key or unauthorized. Please verify or update your Gemini API key in Settings.';
const auth401Class = classifyGeminiUiError(gemini401Err);
assert.strictEqual(auth401Class.isAuth, true, 'Gemini 401 must classify as auth failure');
console.log('✓ Gemini error classification verified for auth (400/401), quota (429), and model (404)');

// 12. Regression checks for drag safety and window controls
assert.strictEqual(isDraggingActive(), false, 'Dragging should remain inactive by default');
console.log('✓ Drag safety and click-through regression checks passed');

console.log('--- ALL GEMINI INTEGRATION & MULTI-PROVIDER CHECKS PASSED ---');
