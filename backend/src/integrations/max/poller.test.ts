import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { fakeLogger, fakeMaxApi, waitForAbort } from '../../../test/max-api.ts';
import type { IncomingEvent } from '../../ports/messenger.ts';
import type { MaxApi } from './api.ts';
import { createPoller, type MaxLogger } from './poller.ts';
import { MAX_UPDATE_TYPES } from './updates.ts';

type Batch = Awaited<ReturnType<MaxApi['getUpdates']>>;
type Step = Batch | Error;

function textUpdate(userId: number, mid: string) {
  return {
    update_type: 'message_created',
    timestamp: 1_790_000_000_000,
    message: {
      sender: { user_id: userId, first_name: 'Гость', username: null },
      recipient: { chat_id: userId + 1000, chat_type: 'dialog' },
      body: { mid, seq: 1, text: mid, attachments: [] },
    },
  };
}

function scriptedUpdates(steps: Step[]) {
  const getUpdates = vi.fn<MaxApi['getUpdates']>((options) => {
    const step = steps.shift();
    if (step === undefined) return waitForAbort(options.signal);
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
  });
  return { api: fakeMaxApi({ getUpdates }), getUpdates };
}

function deferred() {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  return {
    promise,
    resolve: () => {
      resolve(undefined);
    },
  };
}

const idleSleep = () => vi.fn((_ms: number) => Promise.resolve());

describe('MAX poller', () => {
  it('accepts the Fastify logger', () => {
    expectTypeOf<FastifyBaseLogger>().toExtend<MaxLogger>();
  });

  it('passes the marker from MAX to the next request and keeps it when MAX returns none', async () => {
    const { api, getUpdates } = scriptedUpdates([
      { updates: [], marker: 10 },
      { updates: [], marker: null },
      { updates: [], marker: 11 },
    ]);
    const poller = createPoller({ api, handler: vi.fn(), logger: fakeLogger(), types: MAX_UPDATE_TYPES });
    const running = poller.start();
    await vi.waitFor(() => {
      expect(getUpdates).toHaveBeenCalledTimes(4);
    });
    await poller.stop();
    await running;
    expect(getUpdates.mock.calls.map(([options]) => options.marker)).toEqual([null, 10, 10, 11]);
    expect(getUpdates.mock.calls[0]![0]).toMatchObject({ timeoutSeconds: 30, types: MAX_UPDATE_TYPES });
  });

  it('handles events of one user in order and of different users in parallel', async () => {
    const { api, getUpdates } = scriptedUpdates([
      { updates: [textUpdate(1, 'a1'), textUpdate(2, 'b1'), textUpdate(1, 'a2')], marker: 5 },
    ]);
    const gates = new Map([
      ['a1', deferred()],
      ['b1', deferred()],
      ['a2', deferred()],
    ]);
    const started: string[] = [];
    const handler = vi.fn(async (event: IncomingEvent) => {
      const mid = event.type === 'message' ? event.messageId : '';
      started.push(mid);
      await gates.get(mid)?.promise;
    });
    const poller = createPoller({ api, handler, logger: fakeLogger(), types: MAX_UPDATE_TYPES });
    const running = poller.start();

    await vi.waitFor(() => {
      expect(started).toEqual(['a1', 'b1']);
    });
    gates.get('b1')!.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(started).toEqual(['a1', 'b1']);
    expect(getUpdates).toHaveBeenCalledTimes(1);

    gates.get('a1')!.resolve();
    await vi.waitFor(() => {
      expect(started).toEqual(['a1', 'b1', 'a2']);
    });
    expect(getUpdates).toHaveBeenCalledTimes(1);

    gates.get('a2')!.resolve();
    await vi.waitFor(() => {
      expect(getUpdates).toHaveBeenCalledTimes(2);
    });
    expect(getUpdates.mock.calls[1]![0].marker).toBe(5);
    await poller.stop();
    await running;
  });

  it('logs handler failures and keeps going', async () => {
    const { api, getUpdates } = scriptedUpdates([
      { updates: [textUpdate(1, 'a1'), textUpdate(1, 'a2')], marker: 1 },
      { updates: [textUpdate(1, 'a3')], marker: 2 },
    ]);
    const handled: string[] = [];
    const handler = vi.fn((event: IncomingEvent) => {
      if (event.type === 'message') handled.push(event.messageId);
      return event.type === 'message' && event.messageId === 'a1'
        ? Promise.reject(new Error('handler crashed'))
        : Promise.resolve();
    });
    const logger = fakeLogger();
    const poller = createPoller({ api, handler, logger, types: MAX_UPDATE_TYPES });
    const running = poller.start();
    await vi.waitFor(() => {
      expect(getUpdates).toHaveBeenCalledTimes(3);
    });
    await poller.stop();
    await running;
    expect(handled).toEqual(['a1', 'a2', 'a3']);
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) as unknown, key: 'message_created:a1:1790000000000' },
      'max update handler failed',
    );
  });

  it('skips updates it cannot parse', async () => {
    const { api, getUpdates } = scriptedUpdates([
      {
        updates: [{ update_type: 'message_created', timestamp: 1 }, 'garbage', textUpdate(1, 'a1')],
        marker: 1,
      },
    ]);
    const handler = vi.fn(() => Promise.resolve());
    const logger = fakeLogger();
    const poller = createPoller({ api, handler, logger, types: MAX_UPDATE_TYPES });
    const running = poller.start();
    await vi.waitFor(() => {
      expect(getUpdates).toHaveBeenCalledTimes(2);
    });
    await poller.stop();
    await running;
    expect(handler).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith({ update_type: 'message_created' }, 'max update skipped');
    expect(logger.debug).toHaveBeenCalledWith({ update_type: null }, 'max update skipped');
  });

  it('backs off from 1 to 30 seconds on API errors and resets after a success', async () => {
    const failure = new Error('MAX is down');
    const { api, getUpdates } = scriptedUpdates([
      ...Array.from({ length: 7 }, () => failure),
      { updates: [], marker: 1 },
      failure,
    ]);
    const sleep = idleSleep();
    const logger = fakeLogger();
    const poller = createPoller({ api, handler: vi.fn(), logger, types: MAX_UPDATE_TYPES, sleep });
    const running = poller.start();
    await vi.waitFor(() => {
      expect(getUpdates).toHaveBeenCalledTimes(10);
    });
    await poller.stop();
    await running;
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 1000]);
    expect(logger.warn).toHaveBeenCalledWith({ err: failure, retryInMs: 1000 }, 'max polling failed');
  });

  it('stop aborts the pending long poll and waits for the current batch', async () => {
    const { api, getUpdates } = scriptedUpdates([{ updates: [textUpdate(1, 'a1')], marker: 1 }]);
    const gate = deferred();
    let finished = false;
    const handler = vi.fn(async () => {
      await gate.promise;
      finished = true;
    });
    const poller = createPoller({ api, handler, logger: fakeLogger(), types: MAX_UPDATE_TYPES });
    const running = poller.start();
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    const stopping = poller.stop();
    gate.resolve();
    await stopping;
    expect(finished).toBe(true);
    await expect(running).resolves.toBeUndefined();
    expect(getUpdates.mock.calls.at(-1)![0].signal?.aborted).toBe(true);
  });

  it('stop interrupts the pause after an error and can be called twice', async () => {
    const { api } = scriptedUpdates([new Error('MAX is down')]);
    const sleep = vi.fn((_ms: number) => new Promise<void>(() => undefined));
    const poller = createPoller({
      api,
      handler: vi.fn(),
      logger: fakeLogger(),
      types: MAX_UPDATE_TYPES,
      sleep,
    });
    const running = poller.start();
    await vi.waitFor(() => {
      expect(sleep).toHaveBeenCalledTimes(1);
    });
    await poller.stop();
    await poller.stop();
    await expect(running).resolves.toBeUndefined();
    expect(poller.start()).toBe(running);
  });
});
