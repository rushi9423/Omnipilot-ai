import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isTauriEnvironment,
  nativeGetBackendStatus,
  nativeGetAiReadiness,
  nativeValidateAiProviderConfig,
  isDraggingActive,
  nativeSetIgnoreCursorEvents,
} from '../src/utils/tauriBridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('--- Running OmniPilot AI Phase 3 Backend & AI Foundation Test Suite ---');

// 1. Verify Backend Status Contract & Expected Fields
const status = await nativeGetBackendStatus();
assert(status, 'Backend status must return a valid object');
assert.strictEqual(status.appName, 'OmniPilot AI', 'appName must match');
assert.strictEqual(typeof status.appVersion, 'string', 'appVersion must be string');
assert(['healthy', 'degraded', 'unavailable'].includes(status.status), `status must be valid health state, got ${status.status}`);
assert.strictEqual(typeof status.isTauri, 'boolean', 'isTauri must be boolean');
assert.strictEqual(typeof status.os, 'string', 'os must be string');
assert(typeof status.timestampMs === 'number' && status.timestampMs > 0, 'timestampMs must be valid positive timestamp');
console.log('✓ Backend status response structure and types verified');

// 2. Verify AI Service Foundation & Readiness State
assert(status.ai, 'status must include ai service info');
assert(['unconfigured', 'configured', 'checking', 'ready', 'error'].includes(status.ai.state), `Invalid AI state: ${status.ai.state}`);
assert(['none', 'openai', 'gemini', 'anthropic', 'custom', 'ollama'].includes(status.ai.provider), `Invalid AI provider: ${status.ai.provider}`);
assert.strictEqual(status.ai.provider, 'ollama', 'Default active provider must be ollama');
assert.strictEqual(status.ai.keyConfigured, true, 'Ollama requires no API key (keyConfigured = true)');
assert(typeof status.ai.message === 'string' && status.ai.message.length > 0, 'AI status message must be non-empty diagnostic');
console.log('✓ AI service foundation readiness states verified');

// 3. Verify nativeGetAiReadiness direct bridge query
const aiReadiness = await nativeGetAiReadiness();
assert.strictEqual(aiReadiness.state, 'configured', 'Default readiness state for Ollama must be configured');
assert.strictEqual(aiReadiness.provider, 'ollama', 'Default provider must be ollama');
assert.strictEqual(aiReadiness.model, 'qwen2.5-coder:3b', 'Default model must be qwen2.5-coder:3b');
assert.strictEqual(aiReadiness.keyConfigured, true, 'keyConfigured must be true for Ollama');
console.log('✓ nativeGetAiReadiness bridge contract verified');

// 4. Verify AI Provider Configuration Validation
const validNone = await nativeValidateAiProviderConfig('none');
assert.strictEqual(validNone.valid, true, 'Provider "none" should be valid');

const validOpenAi = await nativeValidateAiProviderConfig('openai', 'gpt-4o');
assert.strictEqual(validOpenAi.valid, true, 'Valid OpenAI model must pass');

const invalidOpenAi = await nativeValidateAiProviderConfig('openai', '   ');
assert.strictEqual(invalidOpenAi.valid, false, 'Empty OpenAI model must fail validation');

const validAnthropic = await nativeValidateAiProviderConfig('anthropic', 'claude-3-5-sonnet-20241022');
assert.strictEqual(validAnthropic.valid, true, 'Valid Anthropic model must pass');

const invalidAnthropic = await nativeValidateAiProviderConfig('anthropic', '');
assert.strictEqual(invalidAnthropic.valid, false, 'Empty Anthropic model must fail validation');

const validCustom = await nativeValidateAiProviderConfig('custom', 'mistral', 'http://127.0.0.1:11434/v1');
assert.strictEqual(validCustom.valid, true, 'Valid http/https custom endpoint must pass');

const invalidCustom = await nativeValidateAiProviderConfig('custom', 'mistral', 'ftp://invalid-endpoint');
assert.strictEqual(invalidCustom.valid, false, 'Non-http custom endpoint must fail validation');

const missingCustomEndpoint = await nativeValidateAiProviderConfig('custom', 'mistral', null);
assert.strictEqual(missingCustomEndpoint.valid, false, 'Missing custom endpoint must fail validation');
console.log('✓ Provider configuration validation & missing/invalid config checks passed');

// 5. Zero-Secrets Leakage Guard
const serializedStatus = JSON.stringify(status);
const forbiddenKeys = ['apiKey', 'secretKey', 'api_key', 'secret', 'password', 'token'];
for (const key of forbiddenKeys) {
  assert(!Object.prototype.hasOwnProperty.call(status.ai, key), `AI status must never expose raw credential property: ${key}`);
  assert(!Object.prototype.hasOwnProperty.call(status, key), `Backend status must never expose raw credential property: ${key}`);
}
assert(!serializedStatus.includes('sk-'), 'Status payload must never contain raw API key prefixes');
console.log('✓ Zero-secrets policy verified: No credentials or tokens exposed in responses');

// 6. Capabilities & Least-Privilege Verification
const capPath = path.join(rootDir, 'src-tauri', 'capabilities', 'default.json');
const cap = JSON.parse(fs.readFileSync(capPath, 'utf-8'));
assert(Array.isArray(cap.permissions), 'Capability permissions must be an array');
// Ensure no broad or dangerous permissions are granted
const disallowedBroadPermissions = [
  'core:default-all',
  'shell:all',
  'fs:all',
  'process:all',
  'global-shortcut:all',
];
for (const broad of disallowedBroadPermissions) {
  assert(!cap.permissions.includes(broad), `Overly broad permission detected: ${broad}`);
}
console.log('✓ Tauri capability least-privilege constraints verified');

// 7. Regression Protection: Click-through and Drag behavior
assert.strictEqual(isDraggingActive(), false, 'Drag must initially be idle');
const ignoreDuringNormal = await nativeSetIgnoreCursorEvents(false);
assert.strictEqual(typeof ignoreDuringNormal, 'boolean', 'nativeSetIgnoreCursorEvents must return boolean');
console.log('✓ Regression protection for click-through and drag locks verified');

console.log('--- ALL PHASE 3 BACKEND & AI FOUNDATION CHECKS PASSED ---');
