import type { MaxLogger } from '../integrations/max/poller.ts';
import type { Job } from './scheduler.ts';

export interface DemoDataRefresher {
  refresh(): Promise<unknown>;
}

export function refreshDemoDataJob(demo: DemoDataRefresher, logger: Pick<MaxLogger, 'info'>): Job {
  return {
    name: 'refresh_demo_data',
    schedule: { dailyAt: '06:00', timeZone: 'Europe/Moscow' },
    run: async () => {
      logger.info({ demo: await demo.refresh() }, 'demo data refreshed');
    },
  };
}
