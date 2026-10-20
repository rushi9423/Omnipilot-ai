import assert from 'node:assert';
import {
  nativeGetBackendStatus,
  nativeGetAiReadiness,
  nativeSetAiProvider,
  nativeSetProviderAiModel,
  nativeSetAiEndpoint,
  nativeSetProviderAiEndpoint,
  nativeVerifyAiProviderConnection,
  nativeValidateAiProviderConfig,
  nativeCancelStream,
  nativeStreamAiAnswer,
  nativeStreamChat,
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_OLLAMA_MODEL,
} from '../src/utils/tauriBridge.js';

console.log('--- Running OmniPilot AI Ollama Local Provider Test Suite ---');

// 1. Initial State: Ollama is the default active provider
const initialStatus = await nativeGetBackendStatus();
assert(initialStatus && initialStatus.ai, 'Backend status must contain AI information');
assert.strictEqual(initialStatus.ai.provider, 'ollama', 'Default active provider must be Ollama');
assert.strictEqual(initialStatus.ai.ollamaModel, DEFAULT_OLLAMA_MODEL, 'Default Ollama model must be qwen2.5-coder:3b');
assert.strictEqual(initialStatus.ai.ollamaEndpoint, DEFAULT_OLLAMA_ENDPOINT, 'Default Ollama endpoint must be http://127.0.0.1:11434');
assert.strictEqual(initialStatus.ai.keyConfigured, true, 'Ollama requires no API key (keyConfigured = true)');
console.log('✓ Default provider is Ollama with qwen2.5-coder:3b and http://127.0.0.1:11434');

// 2. Direct readiness query
const readiness = await nativeGetAiReadiness();
assert.strictEqual(readiness.provider, 'ollama', 'Readiness provider must be ollama');
assert.strictEqual(readiness.model, 'qwen2.5-coder:3b', 'Readiness model must be qwen2.5-coder:3b');
assert.strictEqual(readiness.state, 'configured', 'Readiness state must be configured');
assert.strictEqual(readiness.keyConfigured, true, 'Readiness keyConfigured must be true');
console.log('✓ nativeGetAiReadiness returns Ollama ready status');

// 3. Endpoint Configuration
try {
  await nativeSetAiEndpoint('');
  assert.fail('Empty endpoint should be rejected');
} catch (err) {
  assert(err.message.includes('empty'), 'Empty endpoint should throw error');
}

try {
  await nativeSetProviderAiEndpoint('ollama', '   ');
  assert.fail('Whitespace endpoint should be rejected');
} catch (err) {
  assert(err.message.includes('empty'), 'Whitespace endpoint should throw error');
}

const customEndpoint = 'http://127.0.0.1:11434';
const updatedEndpointRes = await nativeSetProviderAiEndpoint('ollama', customEndpoint);
assert.strictEqual(updatedEndpointRes.ollamaEndpoint, customEndpoint, 'Ollama endpoint should be updated');
console.log('✓ Ollama base URL validation and updates verified');

// 4. Model Selection & Configuration
const updatedModelRes = await nativeSetProviderAiModel('ollama', 'llama3.2:3b');
assert.strictEqual(updatedModelRes.ollamaModel, 'llama3.2:3b', 'Ollama model should be updated to llama3.2:3b');

// Reset to default model
const resetModelRes = await nativeSetProviderAiModel('ollama', 'qwen2.5-coder:3b');
assert.strictEqual(resetModelRes.ollamaModel, 'qwen2.5-coder:3b', 'Ollama model reset to default');
console.log('✓ Ollama model configuration and switching verified');

// 5. Provider Switching Coexistence (Ollama -> Gemini -> OpenAI -> Ollama)
const geminiSwitch = await nativeSetAiProvider('gemini');
assert.strictEqual(geminiSwitch.provider, 'gemini', 'Switched to Gemini');

const openAiSwitch = await nativeSetAiProvider('openai');
assert.strictEqual(openAiSwitch.provider, 'openai', 'Switched to OpenAI');

const ollamaSwitch = await nativeSetAiProvider('ollama');
assert.strictEqual(ollamaSwitch.provider, 'ollama', 'Switched back to Ollama');
assert.strictEqual(ollamaSwitch.ollamaModel, 'qwen2.5-coder:3b', 'Ollama model preserved across switches');
console.log('✓ Multi-provider switching preserves Ollama configuration seamlessly');

// 6. Provider Verification
const verifyRes = await nativeVerifyAiProviderConnection('ollama');
assert.strictEqual(verifyRes.state, 'ready', 'Ollama verification must succeed');
assert.strictEqual(verifyRes.provider, 'ollama', 'Ollama verification provider must match');
assert(verifyRes.message.includes('Ollama'), 'Verification message must mention Ollama');
console.log('✓ Ollama connection verification verified');

// 7. Configuration Validation
const validOllamaConfig = await nativeValidateAiProviderConfig('ollama', 'qwen2.5-coder:3b', 'http://127.0.0.1:11434');
assert.strictEqual(validOllamaConfig.valid, true, 'Valid Ollama config should pass');

const emptyModelConfig = await nativeValidateAiProviderConfig('ollama', '   ', 'http://127.0.0.1:11434');
assert.strictEqual(emptyModelConfig.valid, false, 'Empty Ollama model should fail');

const nonHttpEndpointConfig = await nativeValidateAiProviderConfig('ollama', 'qwen2.5-coder:3b', 'ftp://127.0.0.1');
assert.strictEqual(nonHttpEndpointConfig.valid, false, 'Non-HTTP endpoint should fail');
console.log('✓ Ollama provider configuration parameter validation verified');

// 8. Streaming AI Answer with Ollama
let streamedAnswerChunks = [];
let answerDone = false;
const testAnsReqId = `ans-test-${Date.now()}`;

await nativeStreamAiAnswer({
  requestId: testAnsReqId,
  prompt: 'Write a Rust function to test IPC.',
  model: 'qwen2.5-coder:3b',
  onChunk: (chunk) => {
    streamedAnswerChunks.push(chunk);
  },
  onDone: () => {
    answerDone = true;
  },
  onError: (err) => {
    assert.fail(`Streaming answer should not fail: ${err}`);
  },
});

// Wait briefly for streaming simulation
await new Promise((resolve) => setTimeout(resolve, 350));
assert(streamedAnswerChunks.length > 0, 'Should have received token chunks');
assert.strictEqual(answerDone, true, 'Stream should complete with onDone');
console.log(`✓ Ollama answer streaming delivered ${streamedAnswerChunks.length} token chunks successfully`);

// 9. Streaming Chat Completion with Ollama
let streamedChatChunks = [];
let chatDone = false;
const testChatReqId = `chat-test-${Date.now()}`;

await nativeStreamChat({
  requestId: testChatReqId,
  messages: [
    { role: 'user', content: 'Hello local Ollama' },
  ],
  model: 'qwen2.5-coder:3b',
  onChunk: (chunk) => {
    streamedChatChunks.push(chunk);
  },
  onDone: () => {
    chatDone = true;
  },
  onError: (err) => {
    assert.fail(`Streaming chat should not fail: ${err}`);
  },
});

await new Promise((resolve) => setTimeout(resolve, 350));
assert(streamedChatChunks.length > 0, 'Should have received chat token chunks');
assert.strictEqual(chatDone, true, 'Chat stream should complete with onDone');
console.log(`✓ Ollama chat completion streaming delivered ${streamedChatChunks.length} token chunks successfully`);

// 10. Stream Cancellation
let cancelledReceived = false;
const cancelReqId = `cancel-test-${Date.now()}`;

await nativeStreamAiAnswer({
  requestId: cancelReqId,
  prompt: 'A long prompt that will be cancelled.',
  model: 'qwen2.5-coder:3b',
  onChunk: () => {},
  onDone: () => {},
  onCancelled: () => {
    cancelledReceived = true;
  },
});

await nativeCancelStream(cancelReqId);
await new Promise((resolve) => setTimeout(resolve, 80));
assert.strictEqual(cancelledReceived, true, 'Cancelled stream should invoke onCancelled');
console.log('✓ Ollama stream cancellation verified');

console.log('--- ALL OLLAMA LOCAL PROVIDER CHECKS PASSED ---');
