import type { Queryable } from '../db/pool.ts';
import { purgeProcessedBefore } from '../repositories/processed-updates.ts';
import type { Job } from './scheduler.ts';

const PROCESSED_UPDATES_RETENTION_MS = 2 * 86_400_000;

export function purgeProcessedUpdatesJob(db: Queryable): Job {
  return {
    name: 'purge_processed_updates',
    schedule: { everyMs: 3_600_000 },
    run: async (now) => {
      await purgeProcessedBefore(db, new Date(now.getTime() - PROCESSED_UPDATES_RETENTION_MS));
    },
  };
}
