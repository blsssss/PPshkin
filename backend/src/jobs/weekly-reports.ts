import type { ReportsService } from '../services/reports.ts';
import type { Job } from './scheduler.ts';

export function weeklyReportsJob(reports: Pick<ReportsService, 'queueWeekly'>): Job {
  return {
    name: 'weekly_reports',
    schedule: { everyMs: 15 * 60_000 },
    run: async (now) => {
      await reports.queueWeekly(now);
    },
  };
}
