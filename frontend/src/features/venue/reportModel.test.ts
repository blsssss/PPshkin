import { describe, expect, it } from 'vitest';
import {
  defaultReportDay,
  maxWriteOff,
  parseWeekParam,
  previousWeekStart,
  weekStartOf,
} from './reportModel.ts';

const DAY_VENUE = { opensAt: '08:00', closesAt: '22:00' };

describe('week helpers', () => {
  it('finds the Monday of a week', () => {
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-21')).toBe('2026-10-19');
  });

  it('finds the Monday of the previous week', () => {
    expect(previousWeekStart('2026-10-19')).toBe('2026-10-12');
    expect(previousWeekStart('2026-10-25')).toBe('2026-10-12');
  });

  it('reads the week from the start link', () => {
    expect(parseWeekParam('20261012')).toBe('2026-10-12');
    expect(parseWeekParam('20261014')).toBe('2026-10-12');
    expect(parseWeekParam('20261340')).toBeNull();
    expect(parseWeekParam('2026-10-12')).toBeNull();
    expect(parseWeekParam(null)).toBeNull();
  });
});

describe('default report day', () => {
  it('shows yesterday until the venue day is closed', () => {
    expect(defaultReportDay(DAY_VENUE, '2026-10-18', '15:00')).toBe('2026-10-17');
    expect(defaultReportDay(DAY_VENUE, '2026-10-18', '22:14')).toBe('2026-10-17');
  });

  it('shows today after closing', () => {
    expect(defaultReportDay(DAY_VENUE, '2026-10-18', '22:15')).toBe('2026-10-18');
  });

  it('keeps the evening day for a venue that closes after midnight', () => {
    const night = { opensAt: '18:00', closesAt: '02:00' };
    expect(defaultReportDay(night, '2026-10-19', '01:00')).toBe('2026-10-18');
    expect(defaultReportDay(night, '2026-10-19', '12:00')).toBe('2026-10-19');
  });

  it('closes a round-the-clock day at 23:45', () => {
    const always = { opensAt: '00:00', closesAt: '00:00' };
    expect(defaultReportDay(always, '2026-10-18', '23:44')).toBe('2026-10-17');
    expect(defaultReportDay(always, '2026-10-18', '23:45')).toBe('2026-10-18');
  });
});

describe('write-off limit', () => {
  it('leaves the portions that were neither sold nor reserved', () => {
    expect(maxWriteOff({ listed: 10, soldViaApp: 4, reserved: 2 })).toBe(4);
    expect(maxWriteOff({ listed: 3, soldViaApp: 3, reserved: 1 })).toBe(0);
  });
});
