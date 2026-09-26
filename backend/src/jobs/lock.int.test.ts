import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { TEST_DATABASE_URL } from '../../test/database.ts';
import { fakeLogger } from '../../test/max-api.ts';
import { createPool, type PoolClient } from '../db/pool.ts';
import { createAdvisoryLock } from './lock.ts';
import { createScheduler, type Job } from './scheduler.ts';

const pool = createPool(TEST_DATABASE_URL, { max: 4, onError: () => undefined });
const lock = createAdvisoryLock(pool);
const holders: PoolClient[] = [];

async function holdElsewhere(name: string): Promise<PoolClient> {
  const holder = await pool.connect();
  holders.push(holder);
  await holder.query(`select pg_advisory_lock(hashtext('ppshkin:job:' || $1))`, [name]);
  return holder;
}

async function release(holder: PoolClient, name: string): Promise<void> {
  await holder.query(`select pg_advisory_unlock(hashtext('ppshkin:job:' || $1))`, [name]);
  holder.release();
  holders.splice(holders.indexOf(holder), 1);
}

async function isFree(name: string): Promise<boolean> {
  const probe = await pool.connect();
  try {
    const { rows } = await probe.query<{ acquired: boolean }>(
      `select pg_try_advisory_lock(hashtext('ppshkin:job:' || $1)) as acquired`,
      [name],
    );
    if (rows[0]?.acquired) {
      await probe.query(`select pg_advisory_unlock(hashtext('ppshkin:job:' || $1))`, [name]);
    }
    return rows[0]?.acquired === true;
  } finally {
    probe.release();
  }
}

afterEach(() => {
  for (const holder of holders.splice(0)) holder.release(true);
});

afterAll(async () => {
  await pool.end();
});

describe('advisory job lock', () => {
  it('reports a lock held on another connection and takes it once released', async () => {
    const task = vi.fn(() => Promise.resolve());
    const holder = await holdElsewhere('expire_bookings');

    expect(await lock('expire_bookings', task)).toBe(false);
    expect(task).not.toHaveBeenCalled();

    await release(holder, 'expire_bookings');
    expect(await lock('expire_bookings', task)).toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
    expect(await isFree('expire_bookings')).toBe(true);
  });

  it('locks jobs by name', async () => {
    await holdElsewhere('purge_processed_updates');
    const task = vi.fn(() => Promise.resolve());

    expect(await lock('expire_bookings', task)).toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('releases the lock and the connection when the task fails', async () => {
    const failure = new Error('job failed');

    await expect(lock('fail_stale_imports', () => Promise.reject(failure))).rejects.toBe(failure);

    expect(await isFree('fail_stale_imports')).toBe(true);
    expect(pool.idleCount).toBe(pool.totalCount);
    expect(pool.waitingCount).toBe(0);
  });

  it('lets only one of two schedulers run a job on the same database', async () => {
    const started = Promise.withResolvers<undefined>();
    const gate = Promise.withResolvers<undefined>();
    const run = vi.fn(async () => {
      started.resolve(undefined);
      await gate.promise;
    });
    const sharedJob = (): Job => ({ name: 'proactive_offers', schedule: { everyMs: 60_000 }, run });
    const instance = () =>
      createScheduler({
        lock: createAdvisoryLock(pool),
        clock: fixedClock('2026-09-26T09:00:00Z'),
        logger: fakeLogger(),
        jobs: [sharedJob()],
      });
    const first = instance();
    const second = instance();

    const firstRun = first.runDue();
    await started.promise;
    expect(await second.runDue()).toEqual([]);

    gate.resolve(undefined);
    expect(await firstRun).toEqual(['proactive_offers']);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await isFree('proactive_offers')).toBe(true);
  });
});
