import { describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../test/clock.ts';
import { fakeLogger } from '../test/max-api.ts';
import { createScheduler, type JobLock } from './jobs/scheduler.ts';
import { createBackgroundTasks } from './shared/background.ts';
import { BACKGROUND_DRAIN_MS, stopService, type RunningService } from './shutdown.ts';

function recordingService(steps: string[]): RunningService {
  const step = (name: string) => () => {
    steps.push(name);
    return Promise.resolve();
  };
  return {
    bot: { stop: step('bot') },
    app: { close: step('app') },
    scheduler: { stop: step('scheduler') },
    background: {
      stop: () => {
        steps.push('background.stop');
      },
      idle: (timeoutMs) => {
        steps.push(`background.idle ${String(timeoutMs)}`);
        return Promise.resolve(true);
      },
    },
    pools: [{ end: step('lock pool') }, { end: step('pool') }],
  };
}

const runLocked: JobLock = async (_name, task) => {
  await task();
  return true;
};

describe('stopService', () => {
  it('drains the scheduler before it stops background tasks and closes the pools last', async () => {
    const steps: string[] = [];

    await stopService(recordingService(steps));

    expect(steps).toEqual([
      'bot',
      'app',
      'scheduler',
      'background.stop',
      `background.idle ${String(BACKGROUND_DRAIN_MS)}`,
      'lock pool',
      'pool',
    ]);
  });

  it('works without a bot', async () => {
    const steps: string[] = [];

    await stopService({ ...recordingService(steps), bot: null });

    expect(steps[0]).toBe('app');
  });

  it('delivers notices queued by a job run that finishes during shutdown', async () => {
    const backgroundLogger = { error: vi.fn() };
    const background = createBackgroundTasks(backgroundLogger);
    const started = Promise.withResolvers<undefined>();
    const gate = Promise.withResolvers<undefined>();
    const notify = vi.fn(() => Promise.resolve());
    const scheduler = createScheduler({
      lock: runLocked,
      clock: fixedClock('2026-09-26T09:00:00Z'),
      logger: fakeLogger(),
      jobs: [
        {
          name: 'expire_bookings',
          schedule: { everyMs: 60_000 },
          run: async () => {
            started.resolve(undefined);
            await gate.promise;
            background.run('bookingExpired-1', notify);
          },
        },
      ],
    });
    const tick = scheduler.runDue();
    await started.promise;

    await stopService({
      bot: null,
      app: {
        close: () => {
          gate.resolve(undefined);
          return Promise.resolve();
        },
      },
      scheduler,
      background,
      pools: [],
    });

    expect(await tick).toEqual(['expire_bookings']);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(backgroundLogger.error).not.toHaveBeenCalled();
    expect(background.pending).toBe(0);
  });
});
