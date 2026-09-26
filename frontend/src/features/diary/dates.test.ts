import { describe, expect, it } from 'vitest';
import { dayTitle, daysBetween, formatLongDate, isIsoDate, shiftDate } from './dates.ts';

describe('shiftDate', () => {
  it.each([
    ['2026-09-26', -1, '2026-09-25'],
    ['2026-10-01', -1, '2026-09-30'],
    ['2026-09-30', 1, '2026-10-01'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2025-12-31', 1, '2026-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-02-28', 1, '2026-03-01'],
    ['2026-03-29', -30, '2026-02-27'],
  ])('%s %+d is %s', (date, days, expected) => {
    expect(shiftDate(date, days)).toBe(expected);
  });
});

describe('dates', () => {
  it('counts days between dates', () => {
    expect(daysBetween('2026-09-20', '2026-09-26')).toBe(6);
    expect(daysBetween('2026-09-26', '2026-09-26')).toBe(0);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
  });

  it('names today, yesterday and older days', () => {
    expect(dayTitle('2026-09-26', '2026-09-26')).toBe('Сегодня');
    expect(dayTitle('2026-09-25', '2026-09-26')).toBe('Вчера');
    expect(dayTitle('2026-09-21', '2026-09-26')).toBe('пн, 21 сентября');
    expect(formatLongDate('2026-01-01')).toBe('чт, 1 января');
  });

  it('validates ISO dates', () => {
    expect(isIsoDate('2026-09-26')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('26-09-2026')).toBe(false);
    expect(isIsoDate('today')).toBe(false);
  });
});
