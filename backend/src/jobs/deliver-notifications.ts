import type { Outbox } from '../notifications/outbox.ts';
import type { Job } from './scheduler.ts';

export function deliverNotificationsJob(outbox: Pick<Outbox, 'deliverDue'>): Job {
  return {
    name: 'deliver_notifications',
    schedule: { everyMs: 15_000 },
    run: async (now) => {
      await outbox.deliverDue(now);
    },
  };
}
