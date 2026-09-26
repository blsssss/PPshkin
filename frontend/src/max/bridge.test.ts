import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeWebApp, TEST_INIT_DATA } from '../../test/webapp.ts';
import {
  canCloseApp,
  closeApp,
  hasSystemBackButton,
  haptic,
  initData,
  openExternalLink,
  openMaxLink,
  platform,
  ready,
  requestMaxBrightness,
  restoreBrightness,
  setClosingConfirmation,
  shareInMax,
  useBackButton,
} from './bridge.ts';

describe('without window.WebApp', () => {
  it('returns fallbacks and never throws', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(initData()).toBeNull();
    expect(platform()).toBeNull();
    expect(hasSystemBackButton()).toBe(false);
    expect(closeApp()).toBe(false);
    expect(canCloseApp()).toBe(false);
    expect(() => {
      haptic.success();
      haptic.error();
      haptic.impact('light');
      ready();
      setClosingConfirmation(true);
    }).not.toThrow();
    await expect(requestMaxBrightness()).resolves.toBe(false);
    await expect(restoreBrightness()).resolves.toBeUndefined();
    await expect(shareInMax({ text: 'x' })).resolves.toBe('unavailable');
    openExternalLink('https://yandex.ru/maps');
    openMaxLink('https://max.ru/bot');
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('treats the script loaded outside MAX as unavailable', async () => {
    const webApp = fakeWebApp({ initData: null, platform: null });
    expect(initData()).toBeNull();
    expect(platform()).toBeNull();
    await expect(shareInMax({ text: 'x' })).resolves.toBe('unavailable');
    await expect(requestMaxBrightness()).resolves.toBe(false);
    expect(webApp.shareMaxContent).not.toHaveBeenCalled();
    expect(webApp.requestScreenMaxBrightness).not.toHaveBeenCalled();
  });
});

describe('inside MAX', () => {
  it('reads initData and a known platform', () => {
    fakeWebApp({ platform: 'android' });
    expect(initData()).toBe(TEST_INIT_DATA);
    expect(platform()).toBe('android');
  });

  it('ignores an unknown platform value', () => {
    fakeWebApp({ platform: 'tv' });
    expect(platform()).toBeNull();
  });

  it('vibrates only on ios and android', () => {
    const phone = fakeWebApp({ platform: 'ios' });
    haptic.success();
    haptic.error();
    haptic.impact('rigid');
    expect(phone.HapticFeedback.notificationOccurred).toHaveBeenCalledWith('success');
    expect(phone.HapticFeedback.notificationOccurred).toHaveBeenCalledWith('error');
    expect(phone.HapticFeedback.impactOccurred).toHaveBeenCalledWith('rigid');

    for (const name of ['desktop', 'web']) {
      const client = fakeWebApp({ platform: name });
      haptic.success();
      haptic.impact('light');
      expect(client.HapticFeedback.notificationOccurred).not.toHaveBeenCalled();
      expect(client.HapticFeedback.impactOccurred).not.toHaveBeenCalled();
    }
  });

  it('swallows rejected and throwing methods', async () => {
    fakeWebApp({
      HapticFeedback: {
        impactOccurred: vi.fn(() => Promise.reject(new Error('no'))),
        notificationOccurred: vi.fn(() => {
          throw new Error('broken');
        }),
        selectionChanged: vi.fn(() => Promise.resolve({})),
      },
      requestScreenMaxBrightness: vi.fn(() =>
        Promise.reject({ error: { code: 'client.x.request_timeout' } }),
      ),
      restoreScreenBrightness: vi.fn(() => Promise.reject({ error: { code: 'client.x.failed' } })),
      close: vi.fn(() => {
        throw new Error('missing');
      }),
    });
    expect(() => {
      haptic.impact('soft');
      haptic.success();
    }).not.toThrow();
    await expect(requestMaxBrightness()).resolves.toBe(false);
    await expect(restoreBrightness()).resolves.toBeUndefined();
    expect(closeApp()).toBe(false);
  });

  it('maps share results', async () => {
    fakeWebApp();
    await expect(shareInMax({ text: 'x', link: 'https://max.ru/bot' })).resolves.toBe('shared');
    fakeWebApp({
      shareMaxContent: vi.fn(() => Promise.reject({ error: { code: 'client.web_app_max_share.cancelled' } })),
    });
    await expect(shareInMax({ text: 'x' })).resolves.toBe('cancelled');
    fakeWebApp({
      shareMaxContent: vi.fn(() =>
        Promise.reject({ error: { code: 'client.web_app_max_share.request_timeout' } }),
      ),
    });
    await expect(shareInMax({ text: 'x' })).resolves.toBe('unavailable');
  });

  it('opens links through MAX and falls back when the method is missing', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const webApp = fakeWebApp();
    openExternalLink('https://yandex.ru/maps');
    openMaxLink('https://max.ru/bot');
    expect(webApp.openLink).toHaveBeenCalledWith('https://yandex.ru/maps');
    expect(webApp.openMaxLink).toHaveBeenCalledWith('https://max.ru/bot');
    expect(open).not.toHaveBeenCalled();

    fakeWebApp({ openLink: undefined });
    openExternalLink('https://yandex.ru/maps');
    expect(open).toHaveBeenCalledWith('https://yandex.ru/maps', '_blank', 'noopener,noreferrer');
  });

  it('closes only when the method exists', () => {
    const webApp = fakeWebApp();
    expect(canCloseApp()).toBe(true);
    expect(closeApp()).toBe(true);
    expect(webApp.close).toHaveBeenCalled();
    fakeWebApp({ close: undefined });
    expect(canCloseApp()).toBe(false);
    expect(closeApp()).toBe(false);
  });

  it('toggles closing confirmation', () => {
    const webApp = fakeWebApp();
    setClosingConfirmation(true);
    setClosingConfirmation(false);
    expect(webApp.enableClosingConfirmation).toHaveBeenCalledTimes(1);
    expect(webApp.disableClosingConfirmation).toHaveBeenCalledTimes(1);
  });

  it('shows the system back button while mounted and calls the latest handler', () => {
    const webApp = fakeWebApp();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ handler }) => {
        useBackButton(handler);
      },
      { initialProps: { handler: first } },
    );
    expect(webApp.BackButton.show).toHaveBeenCalled();
    const registered = webApp.BackButton.onClick.mock.calls[0]?.[0] as () => void;
    rerender({ handler: second });
    registered();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    unmount();
    expect(webApp.BackButton.offClick).toHaveBeenCalledWith(registered);
    expect(webApp.BackButton.hide).toHaveBeenCalled();
  });

  it('reports the system back button only on phones', () => {
    fakeWebApp({ platform: 'ios' });
    expect(hasSystemBackButton()).toBe(true);
    fakeWebApp({ platform: 'web' });
    expect(hasSystemBackButton()).toBe(false);
    fakeWebApp({ platform: 'desktop' });
    expect(hasSystemBackButton()).toBe(false);
  });
});
