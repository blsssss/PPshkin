import { describe, expect, it } from 'vitest';
import { fromZonedInput, toZonedInput, zonedDate } from './zonedTime.ts';

describe('zoned time', () => {
  it('formats a moment in the given zone', () => {
    const moment = new Date('2026-09-26T21:30:00Z');
    expect(toZonedInput(moment, 'Europe/Moscow')).toBe('2026-09-27T00:30');
    expect(toZonedInput(moment, 'Asia/Vladivostok')).toBe('2026-09-27T07:30');
    expect(zonedDate(moment, 'America/New_York')).toBe('2026-09-26');
  });

  it.each(['Europe/Moscow', 'Asia/Vladivostok', 'America/New_York', 'Europe/Kaliningrad'])(
    'round trips in %s',
    (zone) => {
      const input = '2026-03-08T14:05';
      expect(toZonedInput(fromZonedInput(input, zone)!, zone)).toBe(input);
    },
  );

  it('rejects malformed input', () => {
    expect(fromZonedInput('26.09.2026 12:00', 'Europe/Moscow')).toBeNull();
  });
});
