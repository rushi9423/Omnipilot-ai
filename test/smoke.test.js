import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MOCK_MICROPHONES,
  MOCK_AI_ANSWERS,
  MOCK_CHAT_HISTORY,
  MOCK_SCREENSHOT_DATA,
  MOCK_SHORTCUTS,
} from '../src/data/mockData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('--- Running OmniPilot AI Phase 1 Verification Suite ---');

// 1. Verify mock data
assert(Array.isArray(MOCK_MICROPHONES) && MOCK_MICROPHONES.length >= 3, 'Mock microphones list invalid');
assert(Array.isArray(MOCK_AI_ANSWERS) && MOCK_AI_ANSWERS.length >= 2, 'Mock AI answers invalid');
assert(Array.isArray(MOCK_CHAT_HISTORY) && MOCK_CHAT_HISTORY.length >= 3, 'Mock chat history invalid');
assert(MOCK_SCREENSHOT_DATA && MOCK_SCREENSHOT_DATA.ocrText, 'Mock screenshot OCR data invalid');
assert(Array.isArray(MOCK_SHORTCUTS) && MOCK_SHORTCUTS.some(s => s.key === 'Ctrl+Q'), 'Shortcuts data missing Ctrl+Q');
console.log('✓ Mock data structures verified');

// 2. Verify build output
const distHtml = path.join(rootDir, 'dist', 'index.html');
assert(fs.existsSync(distHtml), 'dist/index.html does not exist after build');
const htmlContent = fs.readFileSync(distHtml, 'utf-8');
assert(htmlContent.includes('id="root"'), 'dist/index.html missing root element');
assert(htmlContent.includes('OmniPilot AI'), 'dist/index.html missing title/branding');
console.log('✓ Production build assets and dist/index.html verified');

// 3. Verify Tauri 2 configuration & capabilities
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
assert(fs.existsSync(tauriConfPath), 'tauri.conf.json not found');
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
assert(tauriConf.productName === 'OmniPilot AI', 'Tauri product name mismatch');
assert(tauriConf.app?.windows?.[0]?.transparent === true, 'Tauri transparent window not enabled');
assert(tauriConf.app?.windows?.[0]?.decorations === false, 'Tauri window decorations must be false for floating bar');

const capabilitiesPath = path.join(rootDir, 'src-tauri', 'capabilities', 'default.json');
assert(fs.existsSync(capabilitiesPath), 'capabilities/default.json not found');
const capabilities = JSON.parse(fs.readFileSync(capabilitiesPath, 'utf-8'));
assert(capabilities.permissions?.includes('core:window:allow-start-dragging'), 'Missing core:window:allow-start-dragging permission');
assert(capabilities.permissions?.includes('core:window:allow-set-ignore-cursor-events'), 'Missing core:window:allow-set-ignore-cursor-events permission');
assert(capabilities.permissions?.includes('core:window:allow-set-always-on-top'), 'Missing core:window:allow-set-always-on-top permission');

// Verify .taurignore watcher exclusion files
const rootTaurignore = path.join(rootDir, '.taurignore');
assert(fs.existsSync(rootTaurignore), 'Root .taurignore file not found');
const rootTaurignoreContent = fs.readFileSync(rootTaurignore, 'utf-8');
assert(rootTaurignoreContent.includes('target/'), 'Root .taurignore missing target/ exclusion');

const srcTauriTaurignore = path.join(rootDir, 'src-tauri', '.taurignore');
assert(fs.existsSync(srcTauriTaurignore), 'src-tauri/.taurignore file not found');
const srcTauriTaurignoreContent = fs.readFileSync(srcTauriTaurignore, 'utf-8');
assert(srcTauriTaurignoreContent.includes('target/'), 'src-tauri/.taurignore missing target/ exclusion');

console.log('✓ Tauri 2 configuration, capabilities, and .taurignore watcher rules valid');

// 4. Verify Component Files
const expectedFiles = [
  'src/components/FloatingToolbar.jsx',
  'src/components/AudioVisualizer.jsx',
  'src/components/MicDropdown.jsx',
  'src/components/Panels/AnswerPanel.jsx',
  'src/components/Panels/ScreenshotPanel.jsx',
  'src/components/Panels/ChatPanel.jsx',
  'src/components/Panels/VoicePanel.jsx',
  'src/components/Panels/SettingsPanel.jsx',
  'src/hooks/useShortcuts.js',
  'src/hooks/useDraggable.js',
  'src/hooks/useClickThrough.js',
  'src/utils/tauriBridge.js',
];

for (const file of expectedFiles) {
  assert(fs.existsSync(path.join(rootDir, file)), `Missing expected component: ${file}`);
}
console.log(`✓ All ${expectedFiles.length} UI components and hooks exist`);

console.log('--- ALL PHASE 1 & CLICK-THROUGH CHECKS PASSED SUCCESSFULLY ---');
