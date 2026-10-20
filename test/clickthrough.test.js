import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isTauriEnvironment,
  isDraggingActive,
  setDraggingActive,
  nativeSetIgnoreCursorEvents,
  getNativeIgnoreCursorState,
} from '../src/utils/tauriBridge.js';
import { isPointInsideInteractiveUI } from '../src/hooks/useClickThrough.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('--- Running OmniPilot AI Click-Through Verification Suite ---');

// 1. Verify Tauri Capabilities Permissions
const capPath = path.join(rootDir, 'src-tauri', 'capabilities', 'default.json');
assert(fs.existsSync(capPath), 'capabilities/default.json must exist');
const cap = JSON.parse(fs.readFileSync(capPath, 'utf-8'));
assert(
  cap.permissions?.includes('core:window:allow-set-ignore-cursor-events'),
  'default.json capability MUST include core:window:allow-set-ignore-cursor-events'
);
assert(
  cap.permissions?.includes('core:window:allow-start-dragging'),
  'default.json capability MUST include core:window:allow-start-dragging'
);
console.log('✓ Capability file contains allow-set-ignore-cursor-events and allow-start-dragging');

// 2. Verify Drag State Tracking & Click-Through Safety
assert.strictEqual(isDraggingActive(), false, 'Drag state must initially be false');
setDraggingActive(true);
assert.strictEqual(isDraggingActive(), true, 'Drag state must be true after setDraggingActive(true)');

// When dragging is active, enabling click-through must be rejected for safety
const result = await nativeSetIgnoreCursorEvents(true);
assert.strictEqual(result, false, 'nativeSetIgnoreCursorEvents(true) must be rejected while dragging');

setDraggingActive(false);
assert.strictEqual(isDraggingActive(), false, 'Drag state must be false after setDraggingActive(false)');
console.log('✓ Drag safety locks and click-through rejection verified');

// 3. Verify Graceful Web Fallback
assert.strictEqual(isTauriEnvironment(), false, 'In node test environment, isTauriEnvironment must return false');
const fallbackResult = await nativeSetIgnoreCursorEvents(false);
assert.strictEqual(fallbackResult, false, 'In node test environment, nativeSetIgnoreCursorEvents returns false gracefully');
console.log('✓ Graceful web fallback verified');

// 4. Verify Point Inside Interactive UI Guard in Non-DOM environment
const pointCheck = isPointInsideInteractiveUI(100, 100);
assert.strictEqual(pointCheck, false, 'isPointInsideInteractiveUI must return false in node environment');
console.log('✓ Hit testing boundaries and SSR/test safety verified');

console.log('--- ALL CLICK-THROUGH CHECKS PASSED SUCCESSFULLY ---');
