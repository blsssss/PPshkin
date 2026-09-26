import { setTimeout as sleep } from 'node:timers/promises';
import type { Pool, PoolClient } from '../src/db/pool.ts';

export interface RowLock {
  text: string;
  values: unknown[];
}

export async function waitForLockWaits(pool: Pool, count: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await pool.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.waiting ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error(`Expected ${count} queries to wait for a row lock`);
    await sleep(10);
  }
}

export async function raceBehindLock<T>(
  pool: Pool,
  lock: RowLock,
  contenders: readonly (() => Promise<T>)[],
  whileHeld: (holder: PoolClient) => Promise<void> = () => Promise.resolve(),
): Promise<PromiseSettledResult<T>[]> {
  const holder = await pool.connect();
  try {
    await holder.query('begin');
    await holder.query(lock.text, lock.values);
    const settled = Promise.allSettled(contenders.map((start) => start()));
    try {
      await waitForLockWaits(pool, contenders.length);
      await whileHeld(holder);
      await holder.query('commit');
    } catch (error) {
      await holder.query('rollback');
      await settled;
      throw error;
    }
    return await settled;
  } finally {
    holder.release();
  }
}
