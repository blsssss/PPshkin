import { performance } from 'node:perf_hooks';
import type { MaxLogger } from '../integrations/max/poller.ts';
import type { Clock } from '../shared/clock.ts';
import { isValidTimeZone, localParts } from '../shared/time.ts';

export type JobSchedule = { everyMs: number } | { dailyAt: string; timeZone: string };

export interface Job {
  name: string;
  schedule: JobSchedule;
  run(now: Date): Promise<void>;
}

export type JobLock = (name: string, task: () => Promise<void>) => Promise<boolean>;

export interface Scheduler {
  start(): void;
  stop(): Promise<void>;
  runDue(): Promise<string[]>;
}

interface SchedulerOptions {
  lock: JobLock;
  clock: Clock;
  logger: MaxLogger;
  jobs: Job[];
  tickMs?: number;
}

const DEFAULT_TICK_MS = 15_000;

const DAILY_AT = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface JobState {
  job: Job;
  lastStartedAt: Date | null;
  lastLocalDate: string | null;
  running: Promise<string | null> | null;
}

function minutesOfDay(dailyAt: string): number {
  const match = DAILY_AT.exec(dailyAt);
  if (!match) throw new RangeError(`dailyAt must look like HH:MM, got ${dailyAt}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function checkOptions(jobs: readonly Job[], tickMs: number): void {
  if (!isPositiveInteger(tickMs)) throw new RangeError('tickMs must be a positive whole number');
  const names = new Set<string>();
  for (const { name, schedule } of jobs) {
    if (names.has(name)) throw new Error(`Job ${name} is registered twice`);
    names.add(name);
    if ('everyMs' in schedule) {
      if (!isPositiveInteger(schedule.everyMs)) {
        throw new RangeError(`Job ${name} needs everyMs as a positive whole number`);
      }
    } else {
      minutesOfDay(schedule.dailyAt);
      if (!isValidTimeZone(schedule.timeZone)) {
        throw new RangeError(`Job ${name} has an unknown time zone ${schedule.timeZone}`);
      }
    }
  }
}

function isDue({ job, lastStartedAt, lastLocalDate }: JobState, now: Date): boolean {
  const { schedule } = job;
  if ('everyMs' in schedule) {
    if (lastStartedAt === null) return true;
    const elapsed = now.getTime() - lastStartedAt.getTime();
    return elapsed >= schedule.everyMs || elapsed < 0;
  }
  const local = localParts(now, schedule.timeZone);
  return local.date !== lastLocalDate && local.hour * 60 + local.minute >= minutesOfDay(schedule.dailyAt);
}

function markStarted(state: JobState, now: Date): void {
  const { schedule } = state.job;
  state.lastStartedAt = now;
  if ('dailyAt' in schedule) state.lastLocalDate = localParts(now, schedule.timeZone).date;
}

export function createScheduler({
  lock,
  clock,
  logger,
  jobs,
  tickMs = DEFAULT_TICK_MS,
}: SchedulerOptions): Scheduler {
  checkOptions(jobs, tickMs);
  const states: JobState[] = jobs.map((job) => ({
    job,
    lastStartedAt: null,
    lastLocalDate: null,
    running: null,
  }));
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  async function execute(job: Job, now: Date): Promise<string | null> {
    const startedAt = performance.now();
    const attempt = { invoked: false };
    try {
      const acquired = await lock(job.name, () => {
        attempt.invoked = true;
        return job.run(now);
      });
      if (!acquired) {
        logger.debug({ job: job.name }, 'job skipped: another instance is running it');
        return null;
      }
      logger.debug({ job: job.name, durationMs: Math.round(performance.now() - startedAt) }, 'job finished');
    } catch (error) {
      logger.error({ err: error, job: job.name }, 'job failed');
    }
    return attempt.invoked ? job.name : null;
  }

  function launch(state: JobState, now: Date): Promise<string | null> {
    markStarted(state, now);
    const running = execute(state.job, now).finally(() => {
      state.running = null;
    });
    state.running = running;
    return running;
  }

  async function runDue(): Promise<string[]> {
    if (stopped) return [];
    const now = clock.now();
    const launched = states
      .filter((state) => state.running === null && isDue(state, now))
      .map((state) => launch(state, now));
    const names = await Promise.all(launched);
    return names.filter((name) => name !== null);
  }

  return {
    start() {
      if (stopped || timer) return;
      const tick = () => {
        runDue().catch((error: unknown) => {
          logger.error({ err: error }, 'scheduler tick failed');
        });
      };
      timer = setInterval(tick, tickMs);
      timer.unref();
      logger.info({ jobs: jobs.map((job) => job.name), tickMs }, 'scheduler started');
      tick();
    },

    async stop() {
      stopped = true;
      clearInterval(timer);
      timer = undefined;
      await Promise.all(states.flatMap((state) => (state.running ? [state.running] : [])));
    },

    runDue,
  };
}
