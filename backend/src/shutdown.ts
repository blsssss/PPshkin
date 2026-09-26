import type { Scheduler } from './jobs/scheduler.ts';
import type { BackgroundTasks } from './shared/background.ts';

export const BACKGROUND_DRAIN_MS = 10_000;

export interface RunningService {
  bot: { stop(): Promise<void> } | null;
  app: { close(): Promise<unknown> };
  scheduler: Pick<Scheduler, 'stop'>;
  background: Pick<BackgroundTasks, 'stop' | 'idle'>;
  pools: { end(): Promise<void> }[];
}

export async function stopService({ bot, app, scheduler, background, pools }: RunningService): Promise<void> {
  await bot?.stop();
  await app.close();
  await scheduler.stop();
  background.stop();
  await background.idle(BACKGROUND_DRAIN_MS);
  for (const pool of pools) {
    await pool.end();
  }
}
