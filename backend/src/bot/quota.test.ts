import { describe, expect, it } from 'vitest';
import { createQuota } from './quota.ts';

const START = new Date('2026-09-26T09:00:00Z').getTime();
const at = (ms: number) => new Date(START + ms);

describe('recognition quota', () => {
  it('allows the limit within a sliding window per user', () => {
    const quota = createQuota({ limit: 3, windowMs: 1000 });
    expect([0, 100, 200, 300].map((ms) => quota.take(101, at(ms)))).toEqual([true, true, true, false]);
    expect(quota.take(102, at(300))).toBe(true);
    expect(quota.take(101, at(999))).toBe(false);
    expect(quota.take(101, at(1000))).toBe(true);
    expect(quota.take(101, at(1050))).toBe(false);
    expect(quota.take(101, at(1100))).toBe(true);
  });

  it('forgets idle users', () => {
    const quota = createQuota({ limit: 1, windowMs: 1000 });
    expect(quota.take(101, at(0))).toBe(true);
    expect(quota.take(101, at(10))).toBe(false);
    expect(quota.take(102, at(5000))).toBe(true);
    expect(quota.take(101, at(5000))).toBe(true);
  });
});
