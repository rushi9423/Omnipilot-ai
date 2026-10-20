// Mock Data for OmniPilot AI (Phase 1 - Windows Floating Copilot)

export const MOCK_MICROPHONES = [
  { id: 'default', name: 'Default - Microphone Array (Realtek High Definition Audio)', status: 'Active' },
  { id: 'mic-hyperx', name: 'HyperX QuadCast S (USB Audio Device)', status: 'Available' },
  { id: 'mic-headset', name: 'Bluetooth Wireless Headset Hands-Free AG Audio', status: 'Available' },
  { id: 'mic-studio', name: 'Studio USB Condenser Mic (Simulated)', status: 'Available' },
];

export const MOCK_AI_ANSWERS = [
  {
    id: 'ans-1',
    query: 'Optimize Tauri 2 window drag & transparent blur performance on Windows 11',
    model: 'OmniCore-V2 (Mock Local)',
    latency: '240ms',
    summary: 'Here is an optimized architectural pattern to achieve zero-latency window dragging with acrylic/mica blur on Windows desktop shells:',
    keyPoints: [
      'Use data-tauri-drag-region on non-interactive header elements to bypass JS event loop latency.',
      'Apply hardware-accelerated CSS backdrop-filter with will-change: transform to prevent compositor redraw jitter.',
      'Ensure buttons and controls have pointer-events: auto and stopPropagation on mousedown to prevent drag conflicts.',
    ],
    codeSnippet: `// Window drag configuration in Tauri 2
import { getCurrentWindow } from '@tauri-apps/api/window';

export function handleNativeDrag(e) {
  if (e.target.closest('button, input, select, [data-no-drag]')) {
    return; // Don't trigger window drag on interactive elements
  }
  // Native Windows drag hook
  getCurrentWindow().startDragging();
}`,
    tips: 'Tip: On Windows 11 22H2+, Mica and Acrylic materials require DWM composition with transparent background enabled in tauri.conf.json.',
  },
  {
    id: 'ans-2',
    query: 'Explain memory management in asynchronous background tasks',
    model: 'OmniCore-V2 (Mock Local)',
    latency: '310ms',
    summary: 'Asynchronous event listeners in desktop overlays must be cleaned up to prevent memory leaks across long desktop sessions.',
    keyPoints: [
      'Always detach global keyboard shortcut listeners (keydown) when unmounting panels.',
      'Use AbortController signals for simulated audio stream intervals and mock typing timers.',
      'Maintain singleton state for floating panel overlays to avoid duplicate window allocations.',
    ],
    codeSnippet: `useEffect(() => {
  const controller = new AbortController();
  window.addEventListener('keydown', handleKeyCombo, { signal: controller.signal });
  return () => controller.abort();
}, []);`,
    tips: 'Tip: For long-running copilot overlays, throttle reactive audio visualizer frames using requestAnimationFrame instead of setInterval.',
  },
];

export const MOCK_CHAT_HISTORY = [
  {
    id: 'm-1',
    sender: 'user',
    timestamp: '15:42',
    text: 'Can you inspect the floating toolbar layout and tell me if the shortcuts Ctrl+Q and Ctrl+Shift+S will conflict with anything?',
  },
  {
    id: 'm-2',
    sender: 'assistant',
    timestamp: '15:42',
    model: 'OmniPilot v1.0',
    text: 'I analyzed standard Windows system shortcut bindings:\n\n• **Ctrl+Q**: Often unbound or used for "Quick View" in select IDEs. Excellent candidate for instant AI Answer popup.\n• **Ctrl+Shift+S**: Commonly used for "Save All" in IDEs. For an OS-wide global capture, ensure your desktop hook registers cleanly, or toggle to Alt+Shift+S in settings if working in VS Code.\n• **Ctrl+Shift+C**: Frequently used for DevTools inspector. In OmniPilot, it triggers your instant Chat drawer.\n\nAll 3 shortcuts are mapped in Phase 1 with automated conflict warnings in Settings!',
  },
  {
    id: 'm-3',
    sender: 'user',
    timestamp: '15:43',
    text: 'Show me how the simulated audio visualizer reacts to speech.',
  },
  {
    id: 'm-4',
    sender: 'assistant',
    timestamp: '15:43',
    model: 'OmniPilot v1.0',
    text: 'The audio visualizer responds dynamically to microphone states (Active, Idle, Muted) using a 7-band frequency generator with smooth sine interpolation. You can toggle mic mute directly from the toolbar pill to watch it transition.',
  },
];

export const MOCK_SCREENSHOT_DATA = {
  timestamp: '2026-10-18 15:44:12',
  resolution: '1920 × 1080 (Mock Active Display)',
  detectedWindow: 'VS Code - OmniPilotProject/src/App.jsx',
  detectedLanguage: 'JavaScript / React',
  ocrText: `1  import React, { useState } from 'react';
2  import { FloatingToolbar } from './components/FloatingToolbar';
3  
4  export function App() {
5    const [activePanel, setActivePanel] = useState('none');
6    return <FloatingToolbar activePanel={activePanel} />;
7  }`,
  insights: [
    'Clean component structure detected without circular imports.',
    'FloatingToolbar handles state dispatch cleanly.',
    'UI conforms to Windows 11 dark translucent aesthetic.',
  ],
};

export const MOCK_SHORTCUTS = [
  { key: 'Ctrl+Q', action: 'AI Answer Instant Drawer', conflict: 'None (Safe)' },
  { key: 'Ctrl+Shift+S', action: 'Capture Screenshot & OCR Inspector', conflict: 'Minor (VS Code Save All)' },
  { key: 'Ctrl+Shift+C', action: 'Toggle Chat Panel', conflict: 'None (Safe)' },
  { key: 'Esc', action: 'Close Active Panel', conflict: 'Standard Escape' },
];
