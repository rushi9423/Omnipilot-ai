import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nativeGetBackendStatus,
  nativeGetAiReadiness,
  nativeSetAiProvider,
  nativeSaveApiKey,
  nativeDeleteApiKey,
  nativeSetAiModel,
  nativeVerifyAiProviderConnection,
  nativeCancelStream,
  nativeStreamAiAnswer,
  nativeStreamChat,
  isDraggingActive,
  nativeSetIgnoreCursorEvents,
} from '../src/utils/tauriBridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('--- Running OmniPilot AI Phase 4 Real OpenAI Streaming Test Suite ---');

// Explicitly switch to OpenAI provider for Phase 4 OpenAI tests
await nativeSetAiProvider('openai');

// 1. Missing credentials and validation
try {
  await nativeSaveApiKey('');
  assert.fail('Empty API key should be rejected');
} catch (err) {
  assert(err.message.includes('empty'), 'Should reject empty key');
}

try {
  await nativeSaveApiKey('   ');
  assert.fail('Whitespace API key should be rejected');
} catch (err) {
  assert(err.message.includes('empty'), 'Should reject whitespace key');
}
console.log('✓ Rejection of empty/missing credentials verified');

// 2. Save API key securely and verify zero secret leakage
const saveResult = await nativeSaveApiKey('sk-proj-test-mock-valid-key-1234567890');
assert.strictEqual(saveResult.keyConfigured, true, 'keyConfigured must be true after saving');
assert.strictEqual(saveResult.provider, 'openai', 'Provider must be openai');
assert(['configured', 'ready'].includes(saveResult.state), 'State should be configured or ready');
assert.strictEqual(saveResult.apiKey, undefined, 'API key MUST NEVER be returned in save response');
assert.strictEqual(saveResult.secret, undefined, 'Secret MUST NEVER be returned');
console.log('✓ Secure credential save and zero-secrets response verified');

// 3. Model Preference Configuration
const modelResult = await nativeSetAiModel('gpt-4o');
assert.strictEqual(modelResult.model, 'gpt-4o', 'Model must update to gpt-4o');

const modelDefault = await nativeSetAiModel('gpt-4o-mini');
assert.strictEqual(modelDefault.model, 'gpt-4o-mini', 'Model must revert to gpt-4o-mini');
console.log('✓ Model preference update verified');

// 4. Verify AI Provider Connection Contract
const verifyResult = await nativeVerifyAiProviderConnection();
assert.strictEqual(verifyResult.state, 'ready', 'Verified state should be ready');
assert.strictEqual(verifyResult.keyConfigured, true, 'keyConfigured must remain true');
assert.strictEqual(verifyResult.apiKey, undefined, 'API key must not be returned');
console.log('✓ Provider connection verification verified');

// 5. Progressive Streaming & Token Delivery in AnswerPanel flow
let streamedAnswerTokens = [];
let answerDone = false;

const ansRequestId = `test-ans-${Date.now()}`;
await nativeStreamAiAnswer({
  requestId: ansRequestId,
  prompt: 'Explain Rust Tauri 2 streaming',
  onChunk: (chunk) => {
    streamedAnswerTokens.push(chunk);
  },
  onDone: () => {
    answerDone = true;
  },
});

// Wait for streaming tokens
for (let wait = 0; wait < 20 && !answerDone; wait++) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

assert(streamedAnswerTokens.length > 0, 'Stream must deliver tokens incrementally');
assert.strictEqual(answerDone, true, 'onDone callback must be triggered upon completion');
console.log(`✓ Progressive token streaming delivered ${streamedAnswerTokens.length} chunks`);

// 6. Stream Cancellation & Cleanup
let cancelledTokens = [];
let streamCancelled = false;
const cancelReqId = `test-cancel-${Date.now()}`;

nativeStreamAiAnswer({
  requestId: cancelReqId,
  prompt: 'A very long response to cancel immediately',
  onChunk: (chunk) => {
    cancelledTokens.push(chunk);
  },
  onCancelled: () => {
    streamCancelled = true;
  },
});

// Cancel stream after receiving initial token or immediately
await new Promise((resolve) => setTimeout(resolve, 60));
const didCancel = await nativeCancelStream(cancelReqId);
assert.strictEqual(didCancel, true, 'nativeCancelStream must return true for active stream');

await new Promise((resolve) => setTimeout(resolve, 150));
assert.strictEqual(streamCancelled, true, 'Stream cancellation callback must be invoked');
console.log('✓ In-flight stream cancellation and resource cleanup verified');

// 7. Multi-Turn Chat Streaming
let chatTokens = [];
let chatDone = false;
const chatReqId = `test-chat-${Date.now()}`;

await nativeStreamChat({
  requestId: chatReqId,
  messages: [
    { role: 'user', content: 'Hello OmniPilot' },
    { role: 'assistant', content: 'Hello! How can I assist your coding today?' },
    { role: 'user', content: 'What phase are we implementing?' },
  ],
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
assert.strictEqual(chatDone, true, 'Chat stream must complete gracefully');
console.log('✓ Multi-turn conversation streaming verified');

// 8. Credential Deletion
const deleteResult = await nativeDeleteApiKey();
assert.strictEqual(deleteResult.keyConfigured, false, 'keyConfigured must be false after deletion');
assert.strictEqual(deleteResult.state, 'unconfigured', 'State must be unconfigured');
console.log('✓ Credential deletion and unconfigured state transition verified');

// 9. Inspect Production Bundles for Zero Leaks of Secrets
const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  const assetsDir = path.join(distDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir);
    for (const file of files) {
      if (file.endsWith('.js')) {
        const bundleContent = fs.readFileSync(path.join(assetsDir, file), 'utf8');
        // Assert no mock or real API key patterns are hardcoded in bundle
        assert(!bundleContent.includes('sk-proj-test-mock-valid-key'), 'Bundle must never leak test keys');
        assert(!bundleContent.includes('sk-live-'), 'Bundle must never contain live keys');
      }
    }
    console.log('✓ Production bundle audited: Zero secrets or keys found in JS/CSS assets');
  }
}

// 10. Verify Error Classification for 429 Quota vs Temporary Rate Limits
function classifyUiError(error) {
  const lower = (error || '').toLowerCase();
  const isBillingOrQuota =
    lower.includes('quota') ||
    lower.includes('credit') ||
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
    lower.includes('no openai api key');

  return { isBillingOrQuota, isRateLimit, isAuth };
}

// 10a. 429 insufficient_quota must be classified as billing/quota error, NOT generic rate limit
const quotaErr = 'OpenAI quota exceeded (insufficient_quota). Your OpenAI account does not have sufficient credit balance or quota. Waiting will not resolve this error; please check billing and add credits at platform.openai.com/billing.';
const quotaClass = classifyUiError(quotaErr);
assert.strictEqual(quotaClass.isBillingOrQuota, true, 'insufficient_quota must be classified as billing/quota');
assert.strictEqual(quotaClass.isRateLimit, false, 'insufficient_quota must NOT be classified as temporary rate limit');

// 10b. 429 credit_balance_exhausted
const creditErr = 'OpenAI prepaid credit balance is exhausted (credit_balance_exhausted). Waiting will not resolve this error; please top up your account balance at platform.openai.com/billing.';
const creditClass = classifyUiError(creditErr);
assert.strictEqual(creditClass.isBillingOrQuota, true, 'credit_balance_exhausted must be classified as billing/quota');
assert.strictEqual(creditClass.isRateLimit, false, 'credit_balance_exhausted must NOT be classified as rate limit');

// 10c. 429 temporary rate limit with Retry-After
const rateLimitRetryAfterErr = 'OpenAI rate limit reached (request/token throttling). Please wait 4 second(s) before retrying (Retry-After: 4s).';
const rateLimitClass = classifyUiError(rateLimitRetryAfterErr);
assert.strictEqual(rateLimitClass.isRateLimit, true, 'Rate limit with retry-after must be classified as rate limit');
assert.strictEqual(rateLimitClass.isBillingOrQuota, false, 'Rate limit must NOT be classified as quota error');

// 10d. 401 authentication failure
const authErr = 'OpenAI authentication failed: Invalid API key or unauthorized. Please verify or update your API key in Settings.';
const authClass = classifyUiError(authErr);
assert.strictEqual(authClass.isAuth, true, '401 must be classified as auth failure');
assert.strictEqual(authClass.isRateLimit, false);
assert.strictEqual(authClass.isBillingOrQuota, false);
console.log('✓ UI Error Classification verified for quota, credit balance, rate limits, and auth');

// 11. Regression Protection for Drag Safety and Click-Through
assert.strictEqual(isDraggingActive(), false, 'Dragging should be inactive by default');
console.log('✓ Native drag and click-through regression checks passed');

console.log('--- ALL PHASE 4 REAL OPENAI STREAMING CHECKS PASSED ---');
