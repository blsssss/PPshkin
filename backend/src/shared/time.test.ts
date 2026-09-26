import { describe, expect, it } from 'vitest';
import {
  addDays,
  atLocalTime,
  dayRange,
  daysSinceEpoch,
  formatLocalTime,
  isLocalDate,
  isOpenAt,
  isValidTimeZone,
  localDate,
  localParts,
  minutesOfDay,
  nextClosingAt,
} from './time.ts';

describe('local time helpers', () => {
  it('converts instants to local calendar parts', () => {
    expect(localParts(new Date('2026-09-25T21:30:00Z'), 'Europe/Moscow')).toEqual({
      date: '2026-09-26',
      hour: 0,
      minute: 30,
    });
    expect(localDate(new Date('2026-09-25T20:59:00Z'), 'Europe/Moscow')).toBe('2026-09-25');
    expect(formatLocalTime(new Date('2026-09-25T05:05:00Z'), 'Asia/Yekaterinburg')).toBe('10:05');
  });

  it('computes the UTC range of a local day', () => {
    expect(dayRange('2026-09-25', 'Europe/Moscow')).toEqual({
      from: new Date('2026-09-24T21:00:00Z'),
      to: new Date('2026-09-25T21:00:00Z'),
    });
  });

  it('handles days with a daylight saving shift', () => {
    const { from, to } = dayRange('2026-03-29', 'Europe/Berlin');
    expect(from.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(to.toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });

  it('starts the day at the first local midnight when clocks jump at midnight', () => {
    const santiago = dayRange('2026-09-06', 'America/Santiago');
    expect(localDate(santiago.from, 'America/Santiago')).toBe('2026-09-06');
    expect(localDate(new Date(santiago.from.getTime() - 1), 'America/Santiago')).toBe('2026-09-05');
    expect(santiago.to.getTime() - santiago.from.getTime()).toBe(23 * 3600 * 1000);

    const azores = dayRange('2026-03-29', 'Atlantic/Azores');
    expect(localDate(azores.from, 'Atlantic/Azores')).toBe('2026-03-29');
    expect(localDate(new Date(azores.from.getTime() - 1), 'Atlantic/Azores')).toBe('2026-03-28');
  });

  it('starts the day at the first midnight when clocks fall back over midnight', () => {
    const { from } = dayRange('2014-10-26', 'Asia/Magadan');
    expect(localDate(from, 'Asia/Magadan')).toBe('2014-10-26');
    expect(localDate(new Date(from.getTime() - 1), 'Asia/Magadan')).toBe('2014-10-25');
  });

  it('validates time zones and calendar dates', () => {
    expect(isValidTimeZone('Europe/Moscow')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('+03:00')).toBe(false);
    expect(isValidTimeZone('europe/moscow')).toBe(false);
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('26-02-01')).toBe(false);
    expect(isLocalDate('0050-06-01')).toBe(false);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('numbers calendar dates from 1970-01-01', () => {
    expect(daysSinceEpoch('1970-01-01')).toBe(0);
    expect(daysSinceEpoch('2026-09-19')).toBe(20715);
    expect(daysSinceEpoch(addDays('2026-12-31', 1)) - daysSinceEpoch('2026-12-31')).toBe(1);
    expect(daysSinceEpoch('2026-03-29') - daysSinceEpoch('2026-03-28')).toBe(1);
  });
});

describe('isOpenAt', () => {
  const at = (iso: string) => new Date(iso);

  it('follows regular opening hours in the venue time zone', () => {
    expect(isOpenAt('08:00', '22:00', at('2026-09-25T04:59:00Z'), 'Europe/Moscow')).toBe(false);
    expect(isOpenAt('08:00', '22:00', at('2026-09-25T05:00:00Z'), 'Europe/Moscow')).toBe(true);
    expect(isOpenAt('08:00:00', '22:00:00', at('2026-09-25T19:00:00Z'), 'Europe/Moscow')).toBe(false);
  });

  it('supports venues that close after midnight', () => {
    expect(isOpenAt('18:00', '02:00', at('2026-09-25T22:30:00Z'), 'Europe/Moscow')).toBe(true);
    expect(isOpenAt('18:00', '02:00', at('2026-09-25T23:30:00Z'), 'Europe/Moscow')).toBe(false);
  });

  it('treats equal opening and closing time as round the clock', () => {
    expect(isOpenAt('00:00', '00:00', at('2026-09-25T01:00:00Z'), 'Europe/Moscow')).toBe(true);
  });

  it('treats malformed hours as closed', () => {
    expect(isOpenAt('08:00', 'garbage', at('2026-09-25T07:00:00Z'), 'Europe/Moscow')).toBe(false);
    expect(isOpenAt('', '', at('2026-09-25T07:00:00Z'), 'Europe/Moscow')).toBe(false);
    expect(isOpenAt('25:00', '22:00', at('2026-09-25T07:00:00Z'), 'Europe/Moscow')).toBe(false);
  });
});

describe('nextClosingAt', () => {
  const at = (iso: string) => new Date(iso);

  it('closes later today in the venue time zone', () => {
    expect(nextClosingAt('08:00', '22:00', at('2026-09-25T10:00:00Z'), 'Europe/Moscow')).toEqual(
      at('2026-09-25T19:00:00Z'),
    );
    expect(nextClosingAt('08:00:00', '22:00:00', at('2026-09-25T10:00:00Z'), 'Asia/Yekaterinburg')).toEqual(
      at('2026-09-25T17:00:00Z'),
    );
  });

  it('moves to the next day from the closing moment on', () => {
    expect(nextClosingAt('08:00', '22:00', at('2026-09-25T18:59:59Z'), 'Europe/Moscow')).toEqual(
      at('2026-09-25T19:00:00Z'),
    );
    expect(nextClosingAt('08:00', '22:00', at('2026-09-25T19:00:00Z'), 'Europe/Moscow')).toEqual(
      at('2026-09-26T19:00:00Z'),
    );
    expect(nextClosingAt('08:00', '00:00', at('2026-09-25T18:00:00Z'), 'Europe/Moscow')).toEqual(
      at('2026-09-25T21:00:00Z'),
    );
  });

  it('closes after midnight for hours like 20:00-02:00', () => {
    expect(nextClosingAt('20:00', '02:00', at('2026-09-25T18:00:00Z'), 'Europe/Moscow')).toEqual(
      at('2026-09-25T23:00:00Z'),
    );
    expect(nextClosingAt('20:00', '02:00', at('2026-09-25T22:30:00Z'), 'Europe/Moscow')).toEqual(
      at('2026-09-25T23:00:00Z'),
    );
  });

  it('has no closing round the clock', () => {
    expect(nextClosingAt('09:00', '09:00', at('2026-09-25T10:00:00Z'), 'Europe/Moscow')).toBeNull();
  });

  it('keeps the local closing time on daylight saving days', () => {
    expect(nextClosingAt('08:00', '22:00', at('2026-03-29T08:00:00Z'), 'Europe/Berlin')).toEqual(
      at('2026-03-29T20:00:00Z'),
    );
    expect(nextClosingAt('08:00', '22:00', at('2026-10-25T08:00:00Z'), 'Europe/Berlin')).toEqual(
      at('2026-10-25T21:00:00Z'),
    );
    expect(nextClosingAt('20:00', '02:30', at('2026-10-24T20:00:00Z'), 'Europe/Berlin')).toEqual(
      at('2026-10-25T00:30:00Z'),
    );
  });

  it('rejects malformed hours', () => {
    expect(() => nextClosingAt('08:00', 'late', at('2026-09-25T10:00:00Z'), 'Europe/Moscow')).toThrow(
      RangeError,
    );
  });
});

describe('wall clock times', () => {
  it('reads HH:MM and HH:MM:SS as minutes of the day', () => {
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('16:05')).toBe(965);
    expect(minutesOfDay('23:59:30')).toBe(1439);
    expect(minutesOfDay('24:00')).toBeNull();
    expect(minutesOfDay('7:30')).toBeNull();
  });

  it('turns a local date and time into an instant', () => {
    expect(atLocalTime('2026-09-25', 16 * 60 + 5, 'Europe/Moscow')).toEqual(new Date('2026-09-25T13:05:00Z'));
    expect(atLocalTime('2026-09-25', 8 * 60 + 30, 'Asia/Yekaterinburg')).toEqual(
      new Date('2026-09-25T03:30:00Z'),
    );
    expect(atLocalTime('2026-03-29', 12 * 60, 'Europe/Berlin')).toEqual(new Date('2026-03-29T10:00:00Z'));
  });
});
