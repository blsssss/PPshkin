import { describe, expect, it, vi } from 'vitest';
import type { Pool } from '../db/pool.ts';
import { createAdvisoryLock } from './lock.ts';

type Answer = () => Promise<{ rows: { acquired: boolean }[] }>;

const acquired: Answer = () => Promise.resolve({ rows: [{ acquired: true }] });
const busy: Answer = () => Promise.resolve({ rows: [{ acquired: false }] });

function failing(message: string): Answer {
  return () => Promise.reject(new Error(message));
}

function setup(answers: { lock?: Answer; unlock?: Answer } = {}) {
  const lockAnswer = answers.lock ?? acquired;
  const unlockAnswer = answers.unlock ?? (() => Promise.resolve({ rows: [] }));
  const query = vi.fn((text: string, _values: unknown[]) =>
    text.includes('pg_try_advisory_lock') ? lockAnswer() : unlockAnswer(),
  );
  const release = vi.fn<(destroy?: boolean) => void>();
  const connect = vi.fn(() => Promise.resolve({ query, release }));
  const pool = { connect } as unknown as Pool;
  return { lock: createAdvisoryLock(pool), query, release, connect };
}

describe('advisory job lock connection handling', () => {
  it('unlocks on the same connection and returns it to the pool', async () => {
    const { lock, query, release, connect } = setup();
    const task = vi.fn(() => Promise.resolve());

    expect(await lock('expire_bookings', task)).toBe(true);

    expect(task).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.map(([text, values]) => [text.includes('pg_advisory_unlock'), values])).toEqual([
      [false, ['expire_bookings']],
      [true, ['expire_bookings']],
    ]);
    expect(release.mock.calls).toEqual([[undefined]]);
  });

  it('returns the connection without unlocking when the lock is busy', async () => {
    const { lock, query, release } = setup({ lock: busy });
    const task = vi.fn(() => Promise.resolve());

    expect(await lock('expire_bookings', task)).toBe(false);

    expect(task).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(release.mock.calls).toEqual([[]]);
  });

  it('destroys the connection and rethrows when taking the lock fails', async () => {
    const { lock, query, release } = setup({ lock: failing('connection reset') });
    const task = vi.fn(() => Promise.resolve());

    await expect(lock('expire_bookings', task)).rejects.toThrow('connection reset');

    expect(task).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(release.mock.calls).toEqual([[true]]);
  });

  it('destroys the connection when unlocking fails after the task', async () => {
    const { lock, release } = setup({ unlock: failing('connection reset') });
    const task = vi.fn(() => Promise.resolve());

    expect(await lock('expire_bookings', task)).toBe(true);

    expect(task).toHaveBeenCalledTimes(1);
    expect(release.mock.calls).toEqual([[true]]);
  });

  it('keeps the task error when unlocking also fails', async () => {
    const { lock, release } = setup({ unlock: failing('connection reset') });
    const failure = new Error('job failed');

    await expect(lock('expire_bookings', () => Promise.reject(failure))).rejects.toBe(failure);

    expect(release.mock.calls).toEqual([[true]]);
  });

  it('returns the connection when the task fails and unlocking succeeds', async () => {
    const { lock, release } = setup();
    const failure = new Error('job failed');

    await expect(lock('expire_bookings', () => Promise.reject(failure))).rejects.toBe(failure);

    expect(release.mock.calls).toEqual([[undefined]]);
  });
});
