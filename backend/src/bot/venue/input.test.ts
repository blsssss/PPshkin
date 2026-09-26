import { describe, expect, it } from 'vitest';
import {
  looksLikeMenu,
  parseCoordinates,
  parseHours,
  parsePrice,
  parseQuantity,
  parseTitle,
  VENUE_NAME_LIMIT,
} from './input.ts';

describe('venue input parsing', () => {
  it('trims titles, collapses spaces and checks the length', () => {
    expect(parseTitle('  Кофейня   «Зерно» ', VENUE_NAME_LIMIT)).toBe('Кофейня «Зерно»');
    expect(parseTitle('   ', VENUE_NAME_LIMIT)).toBeNull();
    expect(parseTitle('я'.repeat(VENUE_NAME_LIMIT), VENUE_NAME_LIMIT)).toHaveLength(VENUE_NAME_LIMIT);
    expect(parseTitle('я'.repeat(VENUE_NAME_LIMIT + 1), VENUE_NAME_LIMIT)).toBeNull();
  });

  it.each([
    ['55.7887, 49.1221', { lat: 55.7887, lon: 49.1221 }],
    ['55.7887,49.1221', { lat: 55.7887, lon: 49.1221 }],
    ['55.7887 49.1221', { lat: 55.7887, lon: 49.1221 }],
    [' 55.788700, 49.122100 ', { lat: 55.7887, lon: 49.1221 }],
    ['-33.8688, 151.2093', { lat: -33.8688, lon: 151.2093 }],
    ['90, -180', { lat: 90, lon: -180 }],
  ])('reads coordinates %j', (text, point) => {
    expect(parseCoordinates(text)).toEqual(point);
  });

  it.each(['55,7887 49,1221', '95, 49', '55, 181', 'ул. Баумана, 36', '55.7887', '55.7887, 49.1221, 3'])(
    'rejects coordinates %j',
    (text) => {
      expect(parseCoordinates(text)).toBeNull();
    },
  );

  it.each([
    ['08:00-22:00', { opensAt: '08:00', closesAt: '22:00' }],
    ['8:30 - 20:15', { opensAt: '08:30', closesAt: '20:15' }],
    ['8-22', { opensAt: '08:00', closesAt: '22:00' }],
    ['9.00-21.00', { opensAt: '09:00', closesAt: '21:00' }],
    ['18:00-02:00', { opensAt: '18:00', closesAt: '02:00' }],
    ['10:00-24:00', { opensAt: '10:00', closesAt: '00:00' }],
    ['00:00-00:00', { opensAt: '00:00', closesAt: '00:00' }],
  ])('reads opening hours %j', (text, hours) => {
    expect(parseHours(text)).toEqual(hours);
  });

  it('reads opening hours copied from map apps with an en or em dash', () => {
    for (const dash of [String.fromCodePoint(0x2013), String.fromCodePoint(0x2014)]) {
      expect(parseHours(`08:00${dash}22:00`)).toEqual({ opensAt: '08:00', closesAt: '22:00' });
      expect(parseHours(`9:30 ${dash} 21:00`)).toEqual({ opensAt: '09:30', closesAt: '21:00' });
    }
  });

  it.each(['25:00-10:00', '08:60-22:00', '24:30-02:00', 'с 8 до 22', '0800-2200', '08:00'])(
    'rejects opening hours %j',
    (text) => {
      expect(parseHours(text)).toBeNull();
    },
  );

  it('reads portions with an optional unit', () => {
    expect(parseQuantity('7')).toBe(7);
    expect(parseQuantity(' 12 шт ')).toBe(12);
    expect(parseQuantity('3 порции')).toBe(3);
    expect(parseQuantity('100')).toBe(100);
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('101')).toBeNull();
    expect(parseQuantity('2.5')).toBeNull();
    expect(parseQuantity('много')).toBeNull();
  });

  it('reads prices with an optional currency', () => {
    expect(parsePrice('150', 199)).toBe(150);
    expect(parsePrice('150 ₽', 199)).toBe(150);
    expect(parsePrice('150р', 199)).toBe(150);
    expect(parsePrice('150 руб.', 199)).toBe(150);
    expect(parsePrice('199 рублей', 199)).toBe(199);
    expect(parsePrice('200', 199)).toBeNull();
    expect(parsePrice('0', 199)).toBeNull();
    expect(parsePrice('-10', 199)).toBeNull();
  });

  it('expects prices in a pasted menu', () => {
    expect(looksLikeMenu('Эклер 150 г 200 ₽')).toBe(true);
    expect(looksLikeMenu('отмена')).toBe(false);
  });
});
