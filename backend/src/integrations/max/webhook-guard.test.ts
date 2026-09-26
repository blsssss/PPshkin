import { describe, expect, it, vi } from 'vitest';
import { fakeLogger, fakeMaxApi } from '../../../test/max-api.ts';
import type { MaxApi } from './api.ts';
import { MaxApiError } from './errors.ts';
import type { MaxSubscription } from './types.ts';
import { MAX_UPDATE_TYPES } from './updates.ts';
import { createWebhookGuard } from './webhook-guard.ts';

const WEBHOOK_URL = 'https://ppshkin.example/max/webhook';
const SECRET = 'guard_secret-0123456789';

const subscription = (
  url: string,
  updateTypes: string[] | null = [...MAX_UPDATE_TYPES],
): MaxSubscription => ({
  url,
  time: 1,
  update_types: updateTypes,
});

function guardOver(api: MaxApi) {
  const logger = fakeLogger();
  const guard = createWebhookGuard({
    api,
    url: WEBHOOK_URL,
    secret: SECRET,
    updateTypes: MAX_UPDATE_TYPES,
    logger,
  });
  return { api, logger, guard };
}

const guardWith = (subscriptions: MaxSubscription[]) =>
  guardOver(
    fakeMaxApi({
      listSubscriptions: vi.fn(() => Promise.resolve(subscriptions)),
      subscribe: vi.fn(() => Promise.resolve()),
    }),
  );

describe('webhook guard', () => {
  it('leaves a complete subscription alone', async () => {
    const { api, logger, guard } = guardWith([
      subscription('https://other.example/hook', []),
      subscription(WEBHOOK_URL, ['message_callback', 'bot_stopped', 'message_created', 'bot_started']),
    ]);

    await expect(guard.check()).resolves.toBe('ok');

    expect(api.listSubscriptions).toHaveBeenCalledTimes(1);
    expect(api.subscribe).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('accepts a subscription with extra update types', async () => {
    const { api, guard } = guardWith([subscription(WEBHOOK_URL, [...MAX_UPDATE_TYPES, 'message_edited'])]);

    await expect(guard.check()).resolves.toBe('ok');

    expect(api.subscribe).not.toHaveBeenCalled();
  });

  it('restores a missing subscription', async () => {
    const { api, logger, guard } = guardWith([]);

    await expect(guard.check()).resolves.toBe('restored');

    expect(api.subscribe).toHaveBeenCalledExactlyOnceWith(WEBHOOK_URL, SECRET, MAX_UPDATE_TYPES);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      { url: WEBHOOK_URL },
      'webhook subscription restored',
    );
  });

  it('restores the subscription when only other addresses are subscribed', async () => {
    const { api, guard } = guardWith([
      subscription('https://old.example/max/webhook'),
      subscription(`${WEBHOOK_URL}/`),
    ]);

    await expect(guard.check()).resolves.toBe('restored');

    expect(api.subscribe).toHaveBeenCalledExactlyOnceWith(WEBHOOK_URL, SECRET, MAX_UPDATE_TYPES);
  });

  it.each<[string, MaxSubscription]>([
    ['some of the types', subscription(WEBHOOK_URL, ['message_created', 'bot_started'])],
    ['no types', subscription(WEBHOOK_URL, [])],
    ['types set to null', subscription(WEBHOOK_URL, null)],
    ['types left out', { url: WEBHOOK_URL, time: 1 }],
  ])('restores a subscription with %s', async (_label, current) => {
    const { api, logger, guard } = guardWith([current]);

    await expect(guard.check()).resolves.toBe('restored');

    expect(api.subscribe).toHaveBeenCalledExactlyOnceWith(WEBHOOK_URL, SECRET, MAX_UPDATE_TYPES);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      { url: WEBHOOK_URL },
      'webhook subscription restored',
    );
  });

  it('passes an error from listing subscriptions on', async () => {
    const failure = new MaxApiError(401, 'verify.token', 'Invalid access_token');
    const { api, logger, guard } = guardOver(
      fakeMaxApi({ listSubscriptions: vi.fn(() => Promise.reject(failure)) }),
    );

    await expect(guard.check()).rejects.toBe(failure);

    expect(api.subscribe).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('passes an error from subscribing on without reporting a restore', async () => {
    const failure = new MaxApiError(500, 'internal.error', 'MAX answered with status 500');
    const { logger, guard } = guardOver(
      fakeMaxApi({
        listSubscriptions: vi.fn(() => Promise.resolve([])),
        subscribe: vi.fn(() => Promise.reject(failure)),
      }),
    );

    await expect(guard.check()).rejects.toBe(failure);

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('never writes the secret to the log', async () => {
    const { logger, guard } = guardWith([subscription(WEBHOOK_URL, ['bot_started'])]);

    await expect(guard.check()).resolves.toBe('restored');

    const logged = JSON.stringify([
      logger.debug.mock.calls,
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logged).not.toContain(SECRET);
  });
});
