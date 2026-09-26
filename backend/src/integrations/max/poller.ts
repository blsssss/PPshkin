import type { IncomingEvent, UpdateHandler } from '../../ports/messenger.ts';
import type { MaxApi } from './api.ts';
import { realSleep, sleepUnlessAborted, type Sleep } from './sleep.ts';
import { parseUpdate, type MaxUpdateType } from './updates.ts';

export interface MaxLogger {
  debug(object: object, message: string): void;
  info(object: object, message: string): void;
  warn(object: object, message: string): void;
  error(object: object, message: string): void;
}

export interface PollerOptions {
  api: MaxApi;
  handler: UpdateHandler;
  logger: MaxLogger;
  types: readonly MaxUpdateType[];
  sleep?: Sleep;
}

export interface Poller {
  start(): Promise<void>;
  stop(): Promise<void>;
}

const LONG_POLL_SECONDS = 30;
const FIRST_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

function updateTypeOf(raw: unknown): string | null {
  const type = typeof raw === 'object' && raw !== null && 'update_type' in raw ? raw.update_type : null;
  return typeof type === 'string' ? type : null;
}

export function createPoller({ api, handler, logger, types, sleep = realSleep }: PollerOptions): Poller {
  const lifetime = new AbortController();
  const stopped = () => lifetime.signal.aborted;
  let marker: number | null = null;
  let running: Promise<void> | undefined;

  const handleInOrder = async (events: IncomingEvent[]) => {
    for (const event of events) {
      try {
        await handler(event);
      } catch (error) {
        logger.error({ err: error, key: event.key }, 'max update handler failed');
      }
    }
  };

  const handleBatch = async (updates: unknown[]) => {
    const byUser = new Map<number, IncomingEvent[]>();
    for (const raw of updates) {
      const event = parseUpdate(raw);
      if (!event) {
        logger.debug({ update_type: updateTypeOf(raw) }, 'max update skipped');
        continue;
      }
      const queue = byUser.get(event.user.id) ?? [];
      queue.push(event);
      byUser.set(event.user.id, queue);
    }
    await Promise.all([...byUser.values()].map(handleInOrder));
  };

  const loop = async () => {
    let backoff = FIRST_BACKOFF_MS;
    while (!stopped()) {
      let batch: { updates: unknown[]; marker: number | null };
      try {
        batch = await api.getUpdates({
          marker,
          timeoutSeconds: LONG_POLL_SECONDS,
          types,
          signal: lifetime.signal,
        });
      } catch (error) {
        if (stopped()) return;
        logger.warn({ err: error, retryInMs: backoff }, 'max polling failed');
        await sleepUnlessAborted(sleep, backoff, lifetime.signal).catch(() => undefined);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        continue;
      }
      backoff = FIRST_BACKOFF_MS;
      await handleBatch(batch.updates);
      marker = batch.marker ?? marker;
    }
  };

  return {
    start() {
      running ??= loop();
      return running;
    },
    async stop() {
      lifetime.abort();
      await running?.catch(() => undefined);
    },
  };
}
