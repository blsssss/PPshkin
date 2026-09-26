import { describe, expect, it } from 'vitest';
import {
  dealWindows,
  openingPeriod,
  remainingDealWindows,
  type DealWindow,
  type OpeningHours,
} from './windows.ts';

const COFFEE_SHOP: OpeningHours = { opensAt: '08:00', closesAt: '22:00', timezone: 'Europe/Moscow' };
const CANTEEN: OpeningHours = { opensAt: '09:00', closesAt: '19:00', timezone: 'Europe/Moscow' };

const local = (time: string) => new Date(`2026-09-26T${time}:00+03:00`);

function describeWindows(windows: readonly DealWindow[]) {
  return windows.map(({ name, startsAt, endsAt }) => [name, startsAt.toISOString(), endsAt.toISOString()]);
}

const names = (windows: readonly DealWindow[]) => windows.map((window) => window.name);

describe('dealWindows', () => {
  it('splits the opening hours into morning, day and evening in the venue time zone', () => {
    expect(describeWindows(dealWindows(COFFEE_SHOP, '2026-09-26'))).toEqual([
      ['morning', '2026-09-26T05:00:00.000Z', '2026-09-26T09:00:00.000Z'],
      ['day', '2026-09-26T09:00:00.000Z', '2026-09-26T14:00:00.000Z'],
      ['evening', '2026-09-26T14:00:00.000Z', '2026-09-26T19:00:00.000Z'],
    ]);
    expect(
      describeWindows(dealWindows({ ...COFFEE_SHOP, timezone: 'Asia/Yekaterinburg' }, '2026-09-26'))[0],
    ).toEqual(['morning', '2026-09-26T03:00:00.000Z', '2026-09-26T07:00:00.000Z']);
  });

  it('ends the evening at closing time for a venue that closes at 19:00', () => {
    expect(describeWindows(dealWindows(CANTEEN, '2026-09-26'))).toEqual([
      ['morning', '2026-09-26T06:00:00.000Z', '2026-09-26T09:00:00.000Z'],
      ['day', '2026-09-26T09:00:00.000Z', '2026-09-26T14:00:00.000Z'],
      ['evening', '2026-09-26T14:00:00.000Z', '2026-09-26T16:00:00.000Z'],
    ]);
  });

  it('drops windows outside the opening hours', () => {
    expect(names(dealWindows({ ...COFFEE_SHOP, opensAt: '13:00' }, '2026-09-26'))).toEqual([
      'day',
      'evening',
    ]);
    expect(names(dealWindows({ ...COFFEE_SHOP, closesAt: '11:00' }, '2026-09-26'))).toEqual(['morning']);
    expect(names(dealWindows({ ...COFFEE_SHOP, opensAt: '18:00' }, '2026-09-26'))).toEqual(['evening']);
  });

  it('continues the evening past midnight and covers the whole day round the clock', () => {
    expect(
      describeWindows(dealWindows({ ...COFFEE_SHOP, opensAt: '20:00', closesAt: '02:00' }, '2026-09-26')),
    ).toEqual([['evening', '2026-09-26T17:00:00.000Z', '2026-09-26T23:00:00.000Z']]);
    expect(
      describeWindows(dealWindows({ ...COFFEE_SHOP, opensAt: '00:00', closesAt: '00:00' }, '2026-09-26')),
    ).toEqual([
      ['morning', '2026-09-25T21:00:00.000Z', '2026-09-26T09:00:00.000Z'],
      ['day', '2026-09-26T09:00:00.000Z', '2026-09-26T14:00:00.000Z'],
      ['evening', '2026-09-26T14:00:00.000Z', '2026-09-26T21:00:00.000Z'],
    ]);
  });

  it('rejects malformed opening hours', () => {
    expect(() => dealWindows({ ...COFFEE_SHOP, closesAt: 'late' }, '2026-09-26')).toThrow(RangeError);
  });
});

describe('remainingDealWindows', () => {
  it('keeps every window before opening and the running one after', () => {
    expect(names(remainingDealWindows(COFFEE_SHOP, local('07:00')))).toEqual(['morning', 'day', 'evening']);
    expect(names(remainingDealWindows(COFFEE_SHOP, local('10:00')))).toEqual(['morning', 'day', 'evening']);
  });

  it('skips windows that have already ended', () => {
    expect(names(remainingDealWindows(COFFEE_SHOP, local('12:00')))).toEqual(['day', 'evening']);
    expect(names(remainingDealWindows(COFFEE_SHOP, local('16:00')))).toEqual(['day', 'evening']);
    expect(names(remainingDealWindows(COFFEE_SHOP, local('20:00')))).toEqual(['evening']);
    expect(names(remainingDealWindows(COFFEE_SHOP, local('23:30')))).toEqual([]);
  });

  it('stops at 19:00 for a venue that closes at 19:00', () => {
    expect(names(remainingDealWindows(CANTEEN, local('18:59')))).toEqual(['evening']);
    expect(names(remainingDealWindows(CANTEEN, local('19:00')))).toEqual([]);
    expect(names(remainingDealWindows(CANTEEN, local('20:00')))).toEqual([]);
  });
});

describe('openingPeriod', () => {
  it('gives the opening and closing instants of a local date', () => {
    expect(openingPeriod(CANTEEN, '2026-09-26')).toEqual({ from: local('09:00'), to: local('19:00') });
    expect(openingPeriod({ ...CANTEEN, opensAt: '20:00', closesAt: '02:00' }, '2026-09-26')).toEqual({
      from: local('20:00'),
      to: new Date('2026-09-26T23:00:00Z'),
    });
  });
});
