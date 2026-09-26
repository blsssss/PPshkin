import { setTimeout as delay } from 'node:timers/promises';

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => delay(ms);

export async function sleepUnlessAborted(sleep: Sleep, ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await sleep(ms);
    return;
  }
  signal.throwIfAborted();
  const { promise: aborted, reject } = Promise.withResolvers<never>();
  const onAbort = () => {
    reject(signal.reason as Error);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await Promise.race([sleep(ms), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
