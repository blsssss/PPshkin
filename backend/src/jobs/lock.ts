import type { Pool, PoolClient } from '../db/pool.ts';
import type { JobLock } from './scheduler.ts';

const LOCK_KEY = "hashtext('ppshkin:job:' || $1)";

async function tryLock(client: PoolClient, name: string): Promise<boolean> {
  const { rows } = await client.query<{ acquired: boolean }>(
    `select pg_try_advisory_lock(${LOCK_KEY}) as acquired`,
    [name],
  );
  return rows[0]?.acquired === true;
}

export function createAdvisoryLock(pool: Pool): JobLock {
  return async (name, task) => {
    const client = await pool.connect();
    let acquired: boolean;
    try {
      acquired = await tryLock(client, name);
    } catch (error) {
      client.release(true);
      throw error;
    }
    if (!acquired) {
      client.release();
      return false;
    }
    try {
      await task();
      return true;
    } finally {
      const unlocked = await client.query(`select pg_advisory_unlock(${LOCK_KEY})`, [name]).then(
        () => true,
        () => false,
      );
      client.release(unlocked ? undefined : true);
    }
  };
}
