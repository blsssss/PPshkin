import { vi } from 'vitest';
import type { WebAppBridge } from '../src/max/bridge.ts';

export const TEST_INIT_DATA = 'query_id=AAH&user=%7B%22id%22%3A101%7D&auth_date=1790000000&hash=abc';

function fakeBackButton() {
  const callbacks: (() => void)[] = [];
  const button = {
    visible: false,
    show: vi.fn(() => {
      button.visible = true;
    }),
    hide: vi.fn(() => {
      button.visible = false;
    }),
    onClick: vi.fn((callback: () => void) => {
      callbacks.push(callback);
    }),
    offClick: vi.fn((callback: () => void) => {
      const index = callbacks.indexOf(callback);
      if (index >= 0) callbacks.splice(index, 1);
    }),
    press() {
      if (!button.visible) return;
      for (const callback of [...callbacks]) callback();
    },
  };
  return button;
}

export function fakeWebApp(overrides: Partial<WebAppBridge> = {}) {
  const base = {
    initData: TEST_INIT_DATA,
    platform: 'ios',
    version: '26.2.8',
    ready: vi.fn(),
    close: vi.fn(),
    BackButton: fakeBackButton(),
    HapticFeedback: {
      impactOccurred: vi.fn(() => Promise.resolve({})),
      notificationOccurred: vi.fn(() => Promise.resolve({})),
      selectionChanged: vi.fn(() => Promise.resolve({})),
    },
    requestScreenMaxBrightness: vi.fn(() => Promise.resolve({})),
    restoreScreenBrightness: vi.fn(() => Promise.resolve({})),
    shareMaxContent: vi.fn(() => Promise.resolve({})),
    openLink: vi.fn(),
    openMaxLink: vi.fn(),
    openCodeReader: vi.fn(() => Promise.resolve({ value: '' })),
    enableClosingConfirmation: vi.fn(),
    disableClosingConfirmation: vi.fn(),
  };
  const webApp = { ...base, ...overrides } as typeof base;
  window.WebApp = webApp;
  return webApp;
}
