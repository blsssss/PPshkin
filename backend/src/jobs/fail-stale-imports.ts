import type { Queryable } from '../db/pool.ts';
import { failStale } from '../repositories/menu-imports.ts';
import type { Job } from './scheduler.ts';

export function failStaleImportsJob(db: Queryable): Job {
  return {
    name: 'fail_stale_imports',
    schedule: { everyMs: 5 * 60_000 },
    run: async (now) => {
      await failStale(db, now);
    },
  };
}
