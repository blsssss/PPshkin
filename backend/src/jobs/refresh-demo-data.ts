import type { Job } from './scheduler.ts';

export interface DemoDataRefresher {
  refresh(): Promise<unknown>;
}

export function refreshDemoDataJob(demo: DemoDataRefresher): Job {
  return {
    name: 'refresh_demo_data',
    schedule: { dailyAt: '06:00', timeZone: 'Europe/Moscow' },
    run: async () => {
      await demo.refresh();
    },
  };
}
