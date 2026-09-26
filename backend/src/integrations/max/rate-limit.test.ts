import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter, type RateLimiter } from './rate-limit.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

function limiter(): RateLimiter {
  return createRateLimiter({
    globalPerSecond: 25,
    perKeyPerSecond: 2,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

async function grants(target: RateLimiter, keys: (string | null)[]) {
  const times: number[] = [];
  const order: number[] = [];
  const pending = keys.map((key, index) =>
    target.acquire(key).then(() => {
      times[index] = Date.now();
      order.push(index);
    }),
  );
  await vi.runAllTimersAsync();
  await Promise.all(pending);
  return { times, order };
}

const repeat = <T>(value: T, count: number): T[] => Array.from({ length: count }, () => value);

describe('rate limiter', () => {
  it('lets 25 requests a second through overall', async () => {
    const { times } = await grants(limiter(), repeat(null, 60));
    expect(times.filter((time) => time === 0)).toHaveLength(25);
    expect(times.filter((time) => time === 1000)).toHaveLength(25);
    expect(times.filter((time) => time === 2000)).toHaveLength(10);
  });

  it('lets 2 requests a second through for one key in the order they came', async () => {
    const { times, order } = await grants(limiter(), repeat('chat:1', 5));
    expect(times).toEqual([0, 0, 1000, 1000, 2000]);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('does not hold back other keys while one key waits', async () => {
    const { times, order } = await grants(limiter(), ['chat:1', 'chat:1', 'chat:1', 'chat:2', null]);
    expect(times).toEqual([0, 0, 1000, 0, 0]);
    expect(order.indexOf(2)).toBe(4);
  });

  it('shares the overall limit between keys', async () => {
    const keys = Array.from({ length: 30 }, (_, index) => `user:${index}`);
    const { times } = await grants(limiter(), keys);
    expect(times.slice(0, 25).every((time) => time === 0)).toBe(true);
    expect(times.slice(25).every((time) => time === 1000)).toBe(true);
  });

  it('counts requests of a key against the overall limit', async () => {
    const { times } = await grants(limiter(), [...repeat(null, 24), 'chat:1', 'chat:1']);
    expect(times.slice(0, 25).every((time) => time === 0)).toBe(true);
    expect(times[25]).toBe(1000);
  });

  it('uses a sliding one second window', async () => {
    const target = limiter();
    expect((await grants(target, ['chat:1', 'chat:1'])).times).toEqual([0, 0]);
    vi.advanceTimersByTime(600);
    expect((await grants(target, ['chat:1'])).times).toEqual([1000]);
    vi.advanceTimersByTime(1000);
    expect((await grants(target, ['chat:1', 'chat:1'])).times).toEqual([2000, 2000]);
  });
});
