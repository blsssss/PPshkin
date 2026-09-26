import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../../test/database.ts';
import type { IncomingEvent } from '../../ports/messenger.ts';
import { createDedupingHandler } from './dedupe.ts';

const pool = testPool();

beforeEach(async () => {
  await resetDatabase(pool);
});

afterAll(async () => {
  await closeTestPool();
});

const stopped = (key: string): IncomingEvent => ({
  type: 'stopped',
  key,
  user: { id: 101, firstName: null, username: null },
});

describe('deduplicating update handler', () => {
  it('handles each event key once', async () => {
    const handler = vi.fn((_event: IncomingEvent) => Promise.resolve());
    const deduped = createDedupingHandler(pool, handler);
    await deduped(stopped('bot_stopped:1:1'));
    await deduped(stopped('bot_stopped:1:1'));
    await deduped(stopped('bot_stopped:1:2'));
    expect(handler.mock.calls.map(([event]) => event.key)).toEqual(['bot_stopped:1:1', 'bot_stopped:1:2']);
  });

  it('does not handle a redelivered event again after the first attempt failed', async () => {
    const handler = vi.fn(() => Promise.reject(new Error('handler crashed')));
    const deduped = createDedupingHandler(pool, handler);
    await expect(deduped(stopped('bot_stopped:1:3'))).rejects.toThrow('handler crashed');
    await expect(deduped(stopped('bot_stopped:1:3'))).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('handles concurrent deliveries of one event once', async () => {
    const handler = vi.fn(() => Promise.resolve());
    const deduped = createDedupingHandler(pool, handler);
    await Promise.all(Array.from({ length: 5 }, () => deduped(stopped('bot_stopped:1:4'))));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
