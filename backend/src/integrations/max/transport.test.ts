import { describe, expect, it, vi } from 'vitest';
import { fakeLogger, fakeMaxApi, waitForAbort } from '../../../test/max-api.ts';
import type { MaxApi } from './api.ts';
import type { MaxSubscription } from './types.ts';
import { createMaxTransport } from './transport.ts';
import { MAX_UPDATE_TYPES } from './updates.ts';

const WEBHOOK_URL = 'https://ppshkin.example/max/webhook';
const SECRET = 'hook_secret-1';

const subscription = (url: string): MaxSubscription => ({ url, time: 1, update_types: ['message_created'] });

function recordingApi(subscriptions: MaxSubscription[]) {
  const calls: string[] = [];
  const api = fakeMaxApi({
    listSubscriptions: vi.fn(() => {
      calls.push('listSubscriptions');
      return Promise.resolve(subscriptions);
    }),
    unsubscribe: vi.fn((url: string) => {
      calls.push(`unsubscribe ${url}`);
      return Promise.resolve();
    }),
    subscribe: vi.fn((url: string) => {
      calls.push(`subscribe ${url}`);
      return Promise.resolve();
    }),
    getUpdates: vi.fn<MaxApi['getUpdates']>((options) => {
      calls.push('getUpdates');
      return waitForAbort(options.signal);
    }),
  });
  return { api, calls };
}

describe('MAX transport in polling mode', () => {
  it('removes webhook subscriptions before it starts polling', async () => {
    const { api, calls } = recordingApi([subscription('https://a.example/hook'), subscription(WEBHOOK_URL)]);
    const logger = fakeLogger();
    const transport = createMaxTransport({ mode: 'polling', api, handler: vi.fn(), logger });
    await transport.start();
    await vi.waitFor(() => {
      expect(calls).toContain('getUpdates');
    });
    expect(calls).toEqual([
      'listSubscriptions',
      'unsubscribe https://a.example/hook',
      `unsubscribe ${WEBHOOK_URL}`,
      'getUpdates',
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      { removed: 2 },
      'max webhook subscriptions removed to allow polling',
    );
    await transport.stop();
  });

  it('starts once and stops the long poll', async () => {
    const { api } = recordingApi([]);
    const logger = fakeLogger();
    const transport = createMaxTransport({ mode: 'polling', api, handler: vi.fn(), logger });
    await transport.start();
    await transport.start();
    await vi.waitFor(() => {
      expect(api.getUpdates).toHaveBeenCalledTimes(1);
    });
    await transport.stop();
    expect(vi.mocked(api.getUpdates).mock.calls[0]![0].signal?.aborted).toBe(true);
    expect(api.listSubscriptions).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith({ mode: 'polling' }, 'max transport started');
  });

  it('logs when polling stops unexpectedly', async () => {
    const api = fakeMaxApi({
      listSubscriptions: vi.fn(() => Promise.resolve([])),
      getUpdates: vi.fn(() => Promise.resolve({ updates: [{ update_type: 'unknown' }], marker: 1 })),
    });
    const logger = fakeLogger();
    const crash = new Error('log sink is gone');
    logger.debug.mockImplementation(() => {
      throw crash;
    });
    const transport = createMaxTransport({ mode: 'polling', api, handler: vi.fn(), logger });
    await transport.start();
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith({ err: crash }, 'max polling stopped unexpectedly');
    });
    expect(api.getUpdates).toHaveBeenCalledTimes(1);
    await expect(transport.stop()).resolves.toBeUndefined();
  });

  it('can be stopped before it was started', async () => {
    const { api } = recordingApi([]);
    const transport = createMaxTransport({ mode: 'polling', api, handler: vi.fn(), logger: fakeLogger() });
    await expect(transport.stop()).resolves.toBeUndefined();
  });

  it('fails to start when MAX refuses to list subscriptions', async () => {
    const api = fakeMaxApi({ listSubscriptions: vi.fn(() => Promise.reject(new Error('verify.token'))) });
    const transport = createMaxTransport({ mode: 'polling', api, handler: vi.fn(), logger: fakeLogger() });
    await expect(transport.start()).rejects.toThrow('verify.token');
    expect(api.getUpdates).not.toHaveBeenCalled();
  });
});

describe('MAX transport in webhook mode', () => {
  it('subscribes the webhook and removes subscriptions with other URLs', async () => {
    const { api, calls } = recordingApi([
      subscription('https://old.example/hook'),
      subscription(WEBHOOK_URL),
      subscription('https://staging.example/hook'),
    ]);
    const logger = fakeLogger();
    const transport = createMaxTransport({
      mode: 'webhook',
      api,
      handler: vi.fn(),
      logger,
      webhookUrl: WEBHOOK_URL,
      webhookSecret: SECRET,
    });
    await transport.start();
    expect(calls).toEqual([
      `subscribe ${WEBHOOK_URL}`,
      'listSubscriptions',
      'unsubscribe https://old.example/hook',
      'unsubscribe https://staging.example/hook',
    ]);
    expect(api.subscribe).toHaveBeenCalledWith(WEBHOOK_URL, SECRET, MAX_UPDATE_TYPES);
    expect(logger.info).toHaveBeenCalledWith({ mode: 'webhook', removed: 2 }, 'max transport started');
  });

  it('keeps the subscription on stop so MAX delivers updates after a restart', async () => {
    const { api } = recordingApi([subscription(WEBHOOK_URL)]);
    const transport = createMaxTransport({
      mode: 'webhook',
      api,
      handler: vi.fn(),
      logger: fakeLogger(),
      webhookUrl: WEBHOOK_URL,
      webhookSecret: SECRET,
    });
    await transport.start();
    await transport.stop();
    expect(api.unsubscribe).not.toHaveBeenCalled();
    expect(api.getUpdates).not.toHaveBeenCalled();
  });

  it('needs the webhook URL and secret', () => {
    const base = { mode: 'webhook' as const, api: fakeMaxApi(), handler: vi.fn(), logger: fakeLogger() };
    expect(() => createMaxTransport({ ...base, webhookSecret: SECRET })).toThrow(
      /webhookUrl and webhookSecret/,
    );
    expect(() => createMaxTransport({ ...base, webhookUrl: WEBHOOK_URL })).toThrow(
      /webhookUrl and webhookSecret/,
    );
    expect(() => createMaxTransport({ ...base, webhookUrl: '', webhookSecret: '' })).toThrow(
      /webhookUrl and webhookSecret/,
    );
  });
});
