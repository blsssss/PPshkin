import type { Clock } from '../src/shared/clock.ts';

export interface ControlledClock extends Clock {
  set(next: Date | string): void;
  advance(ms: number): void;
}

export function fixedClock(at: Date | string): ControlledClock {
  let current = new Date(at);
  return {
    now: () => new Date(current),
    set: (next) => {
      current = new Date(next);
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
}
