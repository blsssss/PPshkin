import type { Queryable } from '../db/pool.ts';
import { NOTIFICATION_RETENTION_MS } from '../domain/retention.ts';
import { purgeCreatedBefore } from '../repositories/notifications.ts';
import type { Job } from './scheduler.ts';

export function purgeNotificationsJob(db: Queryable): Job {
  return {
    name: 'purge_notifications',
    schedule: { dailyAt: '04:30', timeZone: 'Europe/Moscow' },
    run: async (now) => {
      await purgeCreatedBefore(db, new Date(now.getTime() - NOTIFICATION_RETENTION_MS));
    },
  };
}
