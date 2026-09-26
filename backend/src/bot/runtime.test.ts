import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { guestWorld, memoryStates } from '../../test/bot.ts';
import { fakeLogger, fakeMaxApi, waitForAbort } from '../../test/max-api.ts';
import { testConfig } from '../../test/services.ts';
import type { Queryable } from '../db/pool.ts';
import type { MaxApi } from '../integrations/max/api.ts';
import { MaxApiError } from '../integrations/max/errors.ts';
import type { IncomingEvent } from '../ports/messenger.ts';
import { BOT_COMMANDS } from './commands.ts';
import { createBotRuntime, maxBotSettings, type MaxBotSettings } from './runtime.ts';

const TOKEN = 'max-bot-token-0123456789';
const BOT = { user_id: 700, first_name: 'ППшкин', username: 'ppshkin_bot' };
const POLLING: MaxBotSettings = { mode: 'polling', token: TOKEN, webhook: null };
const WEBHOOK: MaxBotSettings = {
  mode: 'webhook',
  token: TOKEN,
  webhook: { url: 'https://ppshkin.example/max/webhook', secret: 'hook_secret-1' },
};

const stopped: IncomingEvent = {
  type: 'stopped',
  key: 'bot_stopped:1:1',
  user: { id: 101, firstName: null, username: null },
};

function memoryDatabase(): Queryable {
  const keys = new Set<string>();
  return {
    query<Row extends QueryResultRow>(_text: string, values: unknown[] = []) {
      const key = String(values[0]);
      const inserted = !keys.has(key);
      keys.add(key);
      return Promise.resolve({ rowCount: inserted ? 1 : 0, rows: [] } as unknown as QueryResult<Row>);
    },
  };
}

function workingApi(overrides: Partial<MaxApi> = {}) {
  return fakeMaxApi({
    getMe: vi.fn(() => Promise.resolve(BOT)),
    listSubscriptions: vi.fn(() => Promise.resolve([])),
    unsubscribe: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => Promise.resolve()),
    getUpdates: vi.fn<MaxApi['getUpdates']>((options) => waitForAbort(options.signal)),
    setCommands: vi.fn(() => Promise.resolve()),
    ...overrides,
  });
}

function runtime(settings: MaxBotSettings, api: MaxApi, sleep = vi.fn(() => Promise.resolve())) {
  const logger = fakeLogger();
  const states = memoryStates();
  const bot = createBotRuntime({
    settings,
    api,
    pool: memoryDatabase(),
    services: guestWorld().services,
    clock: { now: () => new Date('2026-09-26T09:00:00Z') },
    logger,
    miniAppEnabled: false,
    states,
    sleep,
  });
  return { bot, logger, states, sleep };
}

describe('maxBotSettings', () => {
  it('keeps the bot off without a token or with BOT_MODE=off', () => {
    expect(maxBotSettings(testConfig())).toBeNull();
    expect(maxBotSettings(testConfig({ MAX_BOT_TOKEN: TOKEN, BOT_MODE: 'off' }))).toBeNull();
  });

  it('polls by default', () => {
    expect(maxBotSettings(testConfig({ MAX_BOT_TOKEN: TOKEN }))).toEqual(POLLING);
  });

  it('builds the webhook address from the public URL', () => {
    const webhook = { MAX_BOT_TOKEN: TOKEN, BOT_MODE: 'webhook', MAX_WEBHOOK_SECRET: 'hook_secret-1' };
    expect(maxBotSettings(testConfig({ ...webhook, PUBLIC_BASE_URL: 'https://ppshkin.example' }))).toEqual(
      WEBHOOK,
    );
    expect(
      maxBotSettings(testConfig({ ...webhook, PUBLIC_BASE_URL: 'https://ppshkin.example/app/' }))?.webhook,
    ).toEqual({ url: 'https://ppshkin.example/app/max/webhook', secret: 'hook_secret-1' });
  });
});

describe('bot runtime', () => {
  it('starts polling and registers the commands', async () => {
    const api = workingApi();
    const { bot } = runtime(POLLING, api);

    bot.start();
    bot.start();

    await vi.waitFor(() => {
      expect(api.setCommands).toHaveBeenCalledWith(BOT_COMMANDS);
    });
    expect(api.getMe).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(api.getUpdates).toHaveBeenCalled();
    });
    await bot.stop();
    expect(vi.mocked(api.getUpdates).mock.calls[0]?.[0].signal?.aborted).toBe(true);
  });

  it('hands out the messenger for notifications once the bot is up', async () => {
    const { promise: me, resolve } = Promise.withResolvers<typeof BOT>();
    const sendMessage = vi.fn(() => Promise.resolve({ mid: 'mid.1' }));
    const api = workingApi({ getMe: vi.fn(() => me), sendMessage });
    const { bot } = runtime(POLLING, api);

    expect(bot.messenger()).toBeNull();
    bot.start();
    await Promise.resolve();
    expect(bot.messenger()).toBeNull();

    resolve(BOT);
    await vi.waitFor(() => {
      expect(bot.messenger()).not.toBeNull();
    });
    await bot.messenger()?.sendToUser(101, { text: 'Бронь истекла' });
    expect(sendMessage).toHaveBeenCalledWith(
      { userId: 101 },
      expect.objectContaining({ text: 'Бронь истекла' }),
    );
    await bot.stop();
  });

  it('subscribes the webhook and handles updates once the bot is up', async () => {
    const { promise: me, resolve } = Promise.withResolvers<typeof BOT>();
    const api = workingApi({ getMe: vi.fn(() => me) });
    const { bot, states } = runtime(WEBHOOK, api);
    states.put(101, { flow: { name: 'meal_manual', expiresAt: '2026-09-26T09:30:00.000Z' } });

    bot.start();
    const handled = bot.handle(stopped);
    await Promise.resolve();
    expect(states.peek(101).flow).not.toBeNull();

    resolve(BOT);
    await handled;

    expect(api.subscribe).toHaveBeenCalledWith(
      'https://ppshkin.example/max/webhook',
      'hook_secret-1',
      expect.arrayContaining(['message_created', 'message_callback']),
    );
    expect(states.peek(101).flow).toBeNull();
    await bot.stop();
  });

  it('keeps retrying every 30 seconds while MAX is unreachable', async () => {
    const api = workingApi({
      getMe: vi
        .fn<MaxApi['getMe']>()
        .mockRejectedValueOnce(new MaxApiError(0, 'network.error', 'MAX request failed without a response'))
        .mockRejectedValueOnce(new MaxApiError(502, 'unexpected.response', 'Bad gateway'))
        .mockResolvedValue(BOT),
    });
    const { bot, logger, sleep } = runtime(POLLING, api);

    bot.start();

    await vi.waitFor(() => {
      expect(api.setCommands).toHaveBeenCalled();
    });
    expect(sleep.mock.calls).toEqual([[30_000], [30_000]]);
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(MaxApiError) as unknown, retryInMs: 30_000 },
      'max bot failed to start, retrying',
    );
    await bot.stop();
  });

  it('works on when the commands cannot be registered', async () => {
    const api = workingApi({ setCommands: vi.fn(() => Promise.reject(new MaxApiError(400, 'bad', 'bad'))) });
    const { bot, logger, states } = runtime(POLLING, api);
    states.put(101, { flow: { name: 'meal_manual', expiresAt: '2026-09-26T09:30:00.000Z' } });

    bot.start();
    await bot.handle(stopped);

    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(MaxApiError) as unknown },
      'max bot commands were not registered',
    );
    expect(states.peek(101).flow).toBeNull();
    await bot.stop();
  });

  it('stops retrying on shutdown and rejects waiting updates', async () => {
    const api = workingApi({ getMe: vi.fn(() => Promise.reject(new Error('offline'))) });
    const lifetime = Promise.withResolvers<undefined>();
    const { bot } = runtime(
      POLLING,
      api,
      vi.fn(() => lifetime.promise),
    );

    bot.start();
    const waiting = bot.handle(stopped);
    await vi.waitFor(() => {
      expect(api.getMe).toHaveBeenCalledTimes(1);
    });

    await bot.stop();

    await expect(waiting).rejects.toThrow('The bot stopped before it started');
    expect(api.getMe).toHaveBeenCalledTimes(1);
    expect(api.setCommands).not.toHaveBeenCalled();
  });

  it('stops without waiting for a start that hangs while MAX is unreachable', async () => {
    const { promise: me, resolve } = Promise.withResolvers<typeof BOT>();
    const api = workingApi({ getMe: vi.fn(() => me) });
    const { bot, logger } = runtime(POLLING, api);

    bot.start();
    const waiting = bot.handle(stopped);
    await vi.waitFor(() => {
      expect(api.getMe).toHaveBeenCalledTimes(1);
    });

    await bot.stop();
    await expect(waiting).rejects.toThrow('The bot stopped before it started');

    resolve(BOT);
    await me;
    await new Promise((settled) => setImmediate(settled));
    expect(api.listSubscriptions).not.toHaveBeenCalled();
    expect(api.getUpdates).not.toHaveBeenCalled();
    expect(api.setCommands).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('gives up quietly when the start fails after the shutdown began', async () => {
    const { promise: me, reject } = Promise.withResolvers<typeof BOT>();
    const api = workingApi({ getMe: vi.fn(() => me) });
    const { bot, logger, sleep } = runtime(POLLING, api);

    bot.start();
    await vi.waitFor(() => {
      expect(api.getMe).toHaveBeenCalledTimes(1);
    });
    await bot.stop();

    reject(new MaxApiError(0, 'network.error', 'MAX request failed without a response'));
    await me.catch(() => undefined);
    await new Promise((settled) => setImmediate(settled));
    expect(logger.error).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(api.getMe).toHaveBeenCalledTimes(1);
  });

  it('does not keep a transport that started after the shutdown began', async () => {
    const { promise: subscriptions, resolve } = Promise.withResolvers<[]>();
    const api = workingApi({ listSubscriptions: vi.fn(() => subscriptions) });
    const { bot } = runtime(POLLING, api);

    bot.start();
    await vi.waitFor(() => {
      expect(api.listSubscriptions).toHaveBeenCalled();
    });
    const stopping = bot.stop();
    resolve([]);
    await stopping;

    expect(api.setCommands).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(vi.mocked(api.getUpdates).mock.calls.every(([options]) => options.signal?.aborted)).toBe(true);
    });
  });
});
