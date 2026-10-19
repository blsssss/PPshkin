import type { ReportsService } from '../services/reports.ts';
import type { Job } from './scheduler.ts';

export function venueDayCloseJob(reports: Pick<ReportsService, 'queueDayClose'>): Job {
  return {
    name: 'venue_day_close',
    schedule: { everyMs: 5 * 60_000 },
    run: async (now) => {
      await reports.queueDayClose(now);
    },
  };
}
