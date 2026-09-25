import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayRange,
  formatLocalTime,
  isLocalDate,
  isOpenAt,
  isValidTimeZone,
  localDate,
  localParts,
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

  it('validates time zones and calendar dates', () => {
    expect(isValidTimeZone('Europe/Moscow')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('26-02-01')).toBe(false);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
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
});
