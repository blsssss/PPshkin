import { describe, expect, it } from 'vitest';
import { acquisitionOf } from './acquisition.ts';
import { csvLine, perWeek, periodDays, ratio } from './pilot-metrics.ts';

describe('pilot metrics helpers', () => {
  it('keeps the numerator and the denominator and leaves an empty ratio without a value', () => {
    expect(ratio(2, 3)).toEqual({ numerator: 2, denominator: 3, value: 0.6667 });
    expect(ratio(0, 0)).toEqual({ numerator: 0, denominator: 0, value: null });
  });

  it('counts the days of the period inclusively and scales counts to a week', () => {
    expect(periodDays('2026-11-02', '2026-11-08')).toBe(7);
    expect(periodDays('2026-11-02', '2026-11-02')).toBe(1);
    expect(perWeek(6, 14)).toBe(3);
    expect(perWeek(5, 0)).toBe(0);
  });

  it('quotes CSV cells only when needed', () => {
    expect(csvLine([1, 'Зерно', null, 'Кафе, «Б»', 'a"b'])).toBe('1,Зерно,,"Кафе, «Б»","a""b"');
  });
});

describe('acquisitionOf', () => {
  it.each([
    ['v_12', 'v_12'],
    ['d_5', 'd_5'],
    ['venue_900001', 'venue_900001'],
    ['deal_7', 'deal_7'],
    ['c_kfu1', 'c_kfu1'],
    [' c_kfu1 ', 'c_kfu1'],
    ['c_' + 'a'.repeat(24), 'c_' + 'a'.repeat(24)],
    ['c_' + 'a'.repeat(25), 'organic'],
    ['c_KFU', 'organic'],
    ['v_0', 'organic'],
    ['r_K7M2QX', 'organic'],
    ['notifications', 'organic'],
    [null, 'organic'],
  ])('maps %s to %s', (payload, expected) => {
    expect(acquisitionOf(payload)).toBe(expected);
  });
});
