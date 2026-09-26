import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { fakeLogger } from '../../test/max-api.ts';
import { createScheduler, type Job, type JobLock, type JobSchedule } from './scheduler.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const MOSCOW_DAILY: JobSchedule = { dailyAt: '06:00', timeZone: 'Europe/Moscow' };

function job(name: string, schedule: JobSchedule, run: Job['run'] = () => Promise.resolve()) {
  return { name, schedule, run: vi.fn(run) };
}

function memoryLock(busy: ReadonlySet<string> = new Set()) {
  return vi.fn<JobLock>(async (name, task) => {
    if (busy.has(name)) return false;
    await task();
    return true;
  });
}

function setup(jobs: Job[], options: { at?: string; lock?: JobLock } = {}) {
  const clock = fixedClock(options.at ?? '2026-09-26T09:00:00Z');
  const logger = fakeLogger();
  const lock = options.lock ?? memoryLock();
  const scheduler = createScheduler({ lock, clock, logger, jobs });
  return { clock, logger, lock, scheduler };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduler with an interval', () => {
  it('runs on the first tick and then at most once per interval', async () => {
    const expire = job('expire', { everyMs: MINUTE });
    const { clock, scheduler } = setup([expire]);

    expect(await scheduler.runDue()).toEqual(['expire']);
    clock.advance(59 * SECOND);
    expect(await scheduler.runDue()).toEqual([]);
    clock.advance(SECOND);
    expect(await scheduler.runDue()).toEqual(['expire']);
    expect(expire.run.mock.calls).toEqual([
      [new Date('2026-09-26T09:00:00Z')],
      [new Date('2026-09-26T09:01:00Z')],
    ]);
  });

  it('runs again when the clock jumps back', async () => {
    const expire = job('expire', { everyMs: MINUTE });
    const { clock, scheduler } = setup([expire]);

    await scheduler.runDue();
    clock.advance(-10 * MINUTE);

    expect(await scheduler.runDue()).toEqual(['expire']);
  });
});

describe('scheduler with a daily time', () => {
  it('runs once per local day from 06:00 in Moscow', async () => {
    const refresh = job('refresh', MOSCOW_DAILY);
    const { clock, scheduler } = setup([refresh], { at: '2026-09-26T02:59:59Z' });

    expect(await scheduler.runDue()).toEqual([]);
    clock.set('2026-09-26T03:00:00Z');
    expect(await scheduler.runDue()).toEqual(['refresh']);
    clock.set('2026-09-26T03:15:00Z');
    expect(await scheduler.runDue()).toEqual([]);
    clock.set('2026-09-26T20:59:00Z');
    expect(await scheduler.runDue()).toEqual([]);
    clock.set('2026-09-27T02:59:00Z');
    expect(await scheduler.runDue()).toEqual([]);
    clock.set('2026-09-27T03:00:00Z');
    expect(await scheduler.runDue()).toEqual(['refresh']);
    expect(refresh.run).toHaveBeenCalledTimes(2);
  });

  it('catches up at once when the service starts after the daily time', async () => {
    const refresh = job('refresh', MOSCOW_DAILY);
    const { clock, scheduler } = setup([refresh], { at: '2026-09-26T04:00:00Z' });

    expect(await scheduler.runDue()).toEqual(['refresh']);
    clock.set('2026-09-26T20:00:00Z');
    expect(await scheduler.runDue()).toEqual([]);
  });
});

describe('scheduler runs', () => {
  it('skips a job another instance holds and remembers the attempt', async () => {
    const expire = job('expire', { everyMs: MINUTE });
    const purge = job('purge', { everyMs: MINUTE });
    const lock = memoryLock(new Set(['expire']));
    const { clock, logger, scheduler } = setup([expire, purge], { lock });

    expect(await scheduler.runDue()).toEqual(['purge']);
    expect(expire.run).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      { job: 'expire' },
      'job skipped: another instance is running it',
    );

    clock.advance(15 * SECOND);
    expect(await scheduler.runDue()).toEqual([]);
    expect(lock).toHaveBeenCalledTimes(2);
  });

  it('never overlaps a job with itself', async () => {
    const gate = Promise.withResolvers<undefined>();
    const slow = job('slow', { everyMs: SECOND }, () => gate.promise);
    const { clock, scheduler } = setup([slow]);

    const first = scheduler.runDue();
    clock.advance(10 * SECOND);
    expect(await scheduler.runDue()).toEqual([]);
    expect(slow.run).toHaveBeenCalledTimes(1);

    gate.resolve(undefined);
    expect(await first).toEqual(['slow']);
    expect(await scheduler.runDue()).toEqual(['slow']);
  });

  it('keeps running other jobs when one fails', async () => {
    const failure = new Error('database is gone');
    const broken = job('broken', { everyMs: MINUTE }, () => Promise.reject(failure));
    const healthy = job('healthy', { everyMs: MINUTE });
    const { clock, logger, scheduler } = setup([broken, healthy]);

    expect(await scheduler.runDue()).toEqual(['broken', 'healthy']);
    expect(logger.error).toHaveBeenCalledWith({ err: failure, job: 'broken' }, 'job failed');
    expect(logger.debug).toHaveBeenCalledWith(
      { job: 'healthy', durationMs: expect.any(Number) as unknown },
      'job finished',
    );

    clock.advance(MINUTE);
    expect(await scheduler.runDue()).toEqual(['broken', 'healthy']);
  });

  it('logs a lock failure without running the job', async () => {
    const failure = new Error('too many clients');
    const expire = job('expire', { everyMs: MINUTE });
    const { logger, scheduler } = setup([expire], { lock: () => Promise.reject(failure) });

    expect(await scheduler.runDue()).toEqual([]);
    expect(expire.run).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith({ err: failure, job: 'expire' }, 'job failed');
  });

  it('waits for the running job on stop and starts nothing after it', async () => {
    const gate = Promise.withResolvers<undefined>();
    const slow = job('slow', { everyMs: SECOND }, () => gate.promise);
    const { clock, scheduler } = setup([slow]);

    const running = scheduler.runDue();
    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    gate.resolve(undefined);
    await stopping;
    expect(await running).toEqual(['slow']);
    clock.advance(MINUTE);
    expect(await scheduler.runDue()).toEqual([]);
    expect(slow.run).toHaveBeenCalledTimes(1);
  });
});

describe('scheduler timer', () => {
  it('ticks right away and then every tickMs until stopped', async () => {
    vi.useFakeTimers();
    const clock = fixedClock('2026-09-26T09:00:00Z');
    const expire = job('expire', { everyMs: 30 * SECOND });
    const logger = fakeLogger();
    const scheduler = createScheduler({
      lock: memoryLock(),
      clock,
      logger,
      jobs: [expire],
      tickMs: 15 * SECOND,
    });

    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(expire.run).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ jobs: ['expire'], tickMs: 15 * SECOND }, 'scheduler started');

    clock.advance(15 * SECOND);
    await vi.advanceTimersByTimeAsync(15 * SECOND);
    expect(expire.run).toHaveBeenCalledTimes(1);

    clock.advance(15 * SECOND);
    await vi.advanceTimersByTimeAsync(15 * SECOND);
    expect(expire.run).toHaveBeenCalledTimes(2);

    await scheduler.stop();
    clock.advance(MINUTE);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(expire.run).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs a tick that fails instead of crashing', async () => {
    vi.useFakeTimers();
    const failure = new Error('clock is broken');
    const logger = fakeLogger();
    const scheduler = createScheduler({
      lock: memoryLock(),
      clock: {
        now: () => {
          throw failure;
        },
      },
      logger,
      jobs: [job('expire', { everyMs: MINUTE })],
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.error).toHaveBeenCalledWith({ err: failure }, 'scheduler tick failed');
    await scheduler.stop();
  });
});

describe('scheduler options', () => {
  it.each<[string, Job[], RegExp]>([
    ['a duplicate name', [job('expire', { everyMs: MINUTE }), job('expire', { everyMs: MINUTE })], /twice/],
    ['a zero interval', [job('expire', { everyMs: 0 })], /everyMs/],
    ['a fractional interval', [job('expire', { everyMs: 1.5 })], /everyMs/],
    ['a malformed time', [job('refresh', { dailyAt: '6:00', timeZone: 'Europe/Moscow' })], /HH:MM/],
    ['an impossible time', [job('refresh', { dailyAt: '24:00', timeZone: 'Europe/Moscow' })], /HH:MM/],
    ['an unknown zone', [job('refresh', { dailyAt: '06:00', timeZone: 'Mars/Olympus' })], /time zone/],
  ])('rejects %s', (_case, jobs, message) => {
    expect(() => setup(jobs)).toThrow(message);
  });

  it('rejects a tick that is not a positive whole number', () => {
    expect(() =>
      createScheduler({
        lock: memoryLock(),
        clock: fixedClock('2026-09-26T09:00:00Z'),
        logger: fakeLogger(),
        jobs: [],
        tickMs: 0,
      }),
    ).toThrow(/tickMs/);
  });
});
