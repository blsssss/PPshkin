import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeWebApp } from '../../../test/webapp.ts';
import { scanQrCode } from '../../max/bridge.ts';
import {
  cleanCodeInput,
  discountedPrice,
  formatRate,
  normalizeBookingCode,
  resolveEnd,
  validDealPrice,
  venueTimeToInstant,
  withinWindow,
} from './dealModel.ts';

const VENUE = { opensAt: '08:00', closesAt: '22:00', timezone: 'Europe/Moscow' };

afterEach(() => {
  vi.useRealTimers();
});

describe('discount price', () => {
  it('rounds like the bot and stays below the original', () => {
    expect(discountedPrice(190, 32)).toBe(129);
    expect(discountedPrice(3, 20)).toBe(2);
    expect(discountedPrice(1, 20)).toBe(1);
    expect(validDealPrice(1, 1)).toBe(false);
    expect(validDealPrice(129, 190)).toBe(true);
    expect(validDealPrice(189, 190)).toBe(true);
    expect(validDealPrice(190, 190)).toBe(false);
    expect(validDealPrice(0, 190)).toBe(false);
  });
});

describe('end time', () => {
  it('converts venue local time to an instant', () => {
    expect(venueTimeToInstant('2026-09-26', '21:30', 'Europe/Moscow')?.toISOString()).toBe(
      '2026-09-26T18:30:00.000Z',
    );
    expect(venueTimeToInstant('2026-09-26', '21:30', 'Asia/Vladivostok')?.toISOString()).toBe(
      '2026-09-26T11:30:00.000Z',
    );
  });

  it('finds the closing time for regular, overnight and round the clock venues', () => {
    const now = new Date('2026-09-26T12:00:00.000Z');
    expect(resolveEnd({ kind: 'closing' }, VENUE, now)?.toISOString()).toBe('2026-09-26T19:00:00.000Z');
    expect(
      resolveEnd({ kind: 'closing' }, { ...VENUE, opensAt: '18:00', closesAt: '02:00' }, now)?.toISOString(),
    ).toBe('2026-09-26T23:00:00.000Z');
    expect(
      resolveEnd({ kind: 'closing' }, { ...VENUE, opensAt: '00:00', closesAt: '00:00' }, now),
    ).toBeNull();
    const afterClose = new Date('2026-09-26T20:00:00.000Z');
    expect(resolveEnd({ kind: 'closing' }, VENUE, afterClose)?.toISOString()).toBe(
      '2026-09-27T19:00:00.000Z',
    );
  });

  it('takes tomorrow for a time already passed and checks the 24 hour window', () => {
    const now = new Date('2026-09-26T12:00:00.000Z');
    expect(resolveEnd({ kind: 'time', time: '10:00' }, VENUE, now)?.toISOString()).toBe(
      '2026-09-27T07:00:00.000Z',
    );
    expect(resolveEnd({ kind: 'hours', hours: 2 }, VENUE, now)?.toISOString()).toBe(
      '2026-09-26T14:00:00.000Z',
    );
    expect(withinWindow(new Date('2026-09-27T12:00:00.000Z'), now)).toBe(true);
    expect(withinWindow(new Date('2026-09-27T12:00:01.000Z'), now)).toBe(false);
    expect(withinWindow(now, now)).toBe(false);
  });
});

describe('booking code', () => {
  it.each([
    ['K7M2QX', 'K7M2QX'],
    ['k7m 2qx', 'K7M2QX'],
    ['ppshkin:booking:K7M2QX', 'K7M2QX'],
    [' PPSHKIN:BOOKING: k7m2qx ', 'K7M2QX'],
  ])('reads %s', (value, code) => {
    expect(normalizeBookingCode(value)).toBe(code);
  });

  it.each(['K7M2Q', 'K7M2QXX', 'K0M2QX', 'I7M2QX', 'https://max.ru', ''])('rejects %s', (value) => {
    expect(normalizeBookingCode(value)).toBeNull();
  });

  it('cleans typed input', () => {
    expect(cleanCodeInput('k7m-2qx1o9')).toBe('K7M2QX');
  });
});

describe('rates', () => {
  it('shows percents and a dash for a zero denominator', () => {
    expect(formatRate(0.33, 3)).toBe('33%');
    expect(formatRate(0, 0)).toBe('-');
  });
});

describe('scanQrCode', () => {
  it('returns the scanned value', async () => {
    fakeWebApp({ openCodeReader: vi.fn(() => Promise.resolve({ value: 'ppshkin:booking:K7M2QX' })) });
    await expect(scanQrCode()).resolves.toEqual({ status: 'scanned', value: 'ppshkin:booking:K7M2QX' });
  });

  it('reports a rejected reader as failed', async () => {
    fakeWebApp({
      openCodeReader: vi.fn(() =>
        Promise.reject({ error: { code: 'client.open_code_reader.request_timeout' } }),
      ),
    });
    await expect(scanQrCode()).resolves.toEqual({ status: 'failed' });
  });

  it('answers unavailable outside MAX at once', async () => {
    await expect(scanQrCode()).resolves.toEqual({ status: 'unavailable' });
  });
});
