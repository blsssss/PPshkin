import { describe, expect, it } from 'vitest';
import {
  NBSP,
  formatDistance,
  formatKcal,
  formatKcalRange,
  formatLocalTime,
  formatPrice,
  plural,
} from './format.ts';

const s = (text: string) => text.replace(/ /g, NBSP);

describe('calories', () => {
  it('formats single values without thousand separators', () => {
    expect(formatKcal(650)).toBe(s('650 ккал'));
    expect(formatKcal(1850)).toBe(s('1850 ккал'));
    expect(formatKcal(420.4)).toBe(s('420 ккал'));
  });

  it('formats ranges with a hyphen and collapses equal ends', () => {
    expect(formatKcalRange(450, 600)).toBe(s('450-600 ккал'));
    expect(formatKcalRange(450, 450)).toBe(s('450 ккал'));
    expect(formatKcalRange(600, 450)).toBe(s('450-600 ккал'));
  });
});

describe('money', () => {
  it('formats rubles', () => {
    expect(formatPrice(170)).toBe(s('170 ₽'));
    expect(formatPrice(12500)).toBe(s('12 500 ₽'));
  });
});

describe('distance', () => {
  it.each([
    [0, '50 м'],
    [349, '350 м'],
    [949, '950 м'],
    [999, '1 км'],
    [1000, '1 км'],
    [1240, '1,2 км'],
    [9960, '10 км'],
  ])('%i m is %s', (meters, text) => {
    expect(formatDistance(meters)).toBe(s(text));
  });
});

describe('time', () => {
  it('shows local time in the venue time zone', () => {
    expect(formatLocalTime('2026-09-26T18:00:00.000Z', 'Europe/Moscow')).toBe('21:00');
    expect(formatLocalTime('2026-09-26T18:00:00.000Z', 'Asia/Yekaterinburg')).toBe('23:00');
    expect(formatLocalTime('2026-09-26T21:05:00.000Z', 'Europe/Moscow')).toBe('00:05');
  });
});

describe('plural', () => {
  const forms = ['приём', 'приёма', 'приёмов'] as const;
  it.each([
    [0, 'приёмов'],
    [1, 'приём'],
    [2, 'приёма'],
    [5, 'приёмов'],
    [11, 'приёмов'],
    [12, 'приёмов'],
    [21, 'приём'],
    [22, 'приёма'],
    [25, 'приёмов'],
    [111, 'приёмов'],
  ])('%i %s', (count, word) => {
    expect(plural(count, forms)).toBe(word);
  });
});
