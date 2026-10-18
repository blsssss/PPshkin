import type { Queryable } from '../db/pool.ts';
import { DEAL_IMPRESSIONS_RETENTION_MS } from '../domain/retention.ts';
import { purgeCreatedBefore } from '../repositories/deal-impressions.ts';
import type { Job } from './scheduler.ts';

export function purgeDealImpressionsJob(db: Queryable): Job {
  return {
    name: 'purge_deal_impressions',
    schedule: { dailyAt: '04:40', timeZone: 'Europe/Moscow' },
    run: async (now) => {
      await purgeCreatedBefore(db, new Date(now.getTime() - DEAL_IMPRESSIONS_RETENTION_MS));
    },
  };
}
