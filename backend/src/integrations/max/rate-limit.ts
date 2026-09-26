export interface RateLimiterOptions {
  globalPerSecond: number;
  perKeyPerSecond: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface RateLimiter {
  acquire(key: string | null): Promise<void>;
}

interface KeyQueue {
  granted: number[];
  tail: Promise<void>;
  waiting: number;
}

const WINDOW_MS = 1000;

function earliestSlot(granted: number[], limit: number, now: number): number {
  const firstActive = granted.findIndex((time) => time + WINDOW_MS > now);
  granted.splice(0, firstActive === -1 ? granted.length : firstActive);
  const blocking = granted.at(-limit);
  return blocking === undefined ? now : Math.max(now, blocking + WINDOW_MS);
}

export function createRateLimiter({
  globalPerSecond,
  perKeyPerSecond,
  now,
  sleep,
}: RateLimiterOptions): RateLimiter {
  const globalSlots: number[] = [];
  const queues = new Map<string, KeyQueue>();

  const waitUntil = async (time: number) => {
    const wait = Math.ceil(time - now());
    if (wait > 0) await sleep(wait);
  };

  const takeGlobalSlot = async () => {
    const slot = earliestSlot(globalSlots, globalPerSecond, now());
    globalSlots.push(slot);
    await waitUntil(slot);
    return slot;
  };

  const takeKeySlot = async (queue: KeyQueue) => {
    await waitUntil(earliestSlot(queue.granted, perKeyPerSecond, now()));
    queue.granted.push(await takeGlobalSlot());
  };

  const forgetIdleKeys = (current: number) => {
    for (const [key, queue] of queues) {
      const last = queue.granted.at(-1);
      if (queue.waiting === 0 && (last === undefined || last + WINDOW_MS <= current)) {
        queues.delete(key);
      }
    }
  };

  return {
    async acquire(key) {
      if (key === null) {
        await takeGlobalSlot();
        return;
      }
      forgetIdleKeys(now());
      const queue = queues.get(key) ?? { granted: [], tail: Promise.resolve(), waiting: 0 };
      queues.set(key, queue);
      queue.waiting += 1;
      const turn = queue.tail.then(() => takeKeySlot(queue));
      queue.tail = turn.catch(() => undefined);
      try {
        await turn;
      } finally {
        queue.waiting -= 1;
      }
    },
  };
}
