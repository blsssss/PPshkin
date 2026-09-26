import { describe, expect, it } from 'vitest';
import {
  BOOKING_CODE_ALPHABET,
  BOOKING_CODE_LENGTH,
  bookingExpiresAt,
  bookingMeal,
  generateBookingCode,
  normalizeBookingCode,
  qrPayload,
} from './bookings.ts';

const MOSCOW = { opensAt: '08:00', closesAt: '22:00', timezone: 'Europe/Moscow' };
const MINUTE = 60_000;

const at = (iso: string) => new Date(iso);
const minutesAfter = (instant: Date, minutes: number) => new Date(instant.getTime() + minutes * MINUTE);

describe('booking codes', () => {
  it('use 32 characters that cannot be mistaken for each other', () => {
    expect(BOOKING_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(BOOKING_CODE_ALPHABET).size).toBe(32);
    for (const confusable of ['I', 'O', '0', '1']) {
      expect(BOOKING_CODE_ALPHABET).not.toContain(confusable);
    }
  });

  it('generates 6 characters of the alphabet and uses all of it', () => {
    const codes = Array.from({ length: 2000 }, generateBookingCode);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(code).toHaveLength(BOOKING_CODE_LENGTH);
    }
    expect(new Set(codes.join(''))).toEqual(new Set(BOOKING_CODE_ALPHABET));
    expect(new Set(codes).size).toBeGreaterThan(1990);
  });

  it('puts the code into the QR payload', () => {
    expect(qrPayload('ABC234')).toBe('ppshkin:booking:ABC234');
  });
});

describe('normalizeBookingCode', () => {
  it.each([
    ['ABC234', 'ABC234'],
    ['abc234', 'ABC234'],
    [' A B C 2 3 4 ', 'ABC234'],
    ['\tabc\n234 ', 'ABC234'],
    ['ppshkin:booking:abc234', 'ABC234'],
    ['PPSHKIN:BOOKING:ABC234', 'ABC234'],
    ['ppshkin: booking: ABC 234', 'ABC234'],
    ['АВС234', 'ABC234'],
    ['кмн рст', 'KMHPCT'],
  ])('reads %j as %s', (input, code) => {
    expect(normalizeBookingCode(input)).toBe(code);
  });

  it.each([
    '',
    '   ',
    'ABC23',
    'ABC2345',
    'ABCI23',
    'ABCO23',
    'ABC023',
    'ABC123',
    'ABC-234',
    'ppshkin:booking:',
    'ppshkin:order:ABC234',
    'ABC234ppshkin:booking:',
    'ppshkin:booking:ppshkin:booking:ABC234',
    'ЖЖЖ234',
    'hello world',
  ])('rejects %j', (input) => {
    expect(normalizeBookingCode(input)).toBeNull();
  });

  it('reads every generated payload back', () => {
    for (let index = 0; index < 100; index += 1) {
      const code = generateBookingCode();
      expect(normalizeBookingCode(qrPayload(code).toLowerCase())).toBe(code);
    }
  });
});

describe('bookingExpiresAt', () => {
  const now = at('2026-09-25T09:00:00Z');

  it('holds a portion for an hour', () => {
    expect(bookingExpiresAt({ now, dealEndsAt: null, venue: MOSCOW })).toEqual(minutesAfter(now, 60));
    expect(bookingExpiresAt({ now, dealEndsAt: minutesAfter(now, 61), venue: MOSCOW })).toEqual(
      minutesAfter(now, 60),
    );
  });

  it('ends with the deal', () => {
    expect(bookingExpiresAt({ now, dealEndsAt: minutesAfter(now, 25), venue: MOSCOW })).toEqual(
      minutesAfter(now, 25),
    );
  });

  it('ends when the venue closes', () => {
    const late = at('2026-09-25T18:40:00Z');
    expect(bookingExpiresAt({ now: late, dealEndsAt: null, venue: MOSCOW })).toEqual(
      at('2026-09-25T19:00:00Z'),
    );
    expect(bookingExpiresAt({ now: late, dealEndsAt: minutesAfter(late, 30), venue: MOSCOW })).toEqual(
      at('2026-09-25T19:00:00Z'),
    );
  });

  it('follows opening hours that pass midnight', () => {
    const nightBar = { opensAt: '20:00', closesAt: '02:00', timezone: 'Europe/Moscow' };
    expect(bookingExpiresAt({ now: at('2026-09-25T22:30:00Z'), dealEndsAt: null, venue: nightBar })).toEqual(
      at('2026-09-25T23:00:00Z'),
    );
    expect(bookingExpiresAt({ now: at('2026-09-25T18:00:00Z'), dealEndsAt: null, venue: nightBar })).toEqual(
      at('2026-09-25T19:00:00Z'),
    );
  });

  it('has no closing limit round the clock', () => {
    const allDay = { opensAt: '00:00', closesAt: '00:00', timezone: 'Europe/Moscow' };
    const midnight = at('2026-09-25T20:30:00Z');
    expect(bookingExpiresAt({ now: midnight, dealEndsAt: null, venue: allDay })).toEqual(
      minutesAfter(midnight, 60),
    );
  });
});

describe('bookingMeal', () => {
  const booking = { itemName: 'Эклер', kcal: 330 };
  const item = { proteinG: 5, fatG: 18, carbsG: 38.2, tags: ['dessert' as const, 'sweet' as const] };

  it('logs the booked dish with calories within 10 percent and the macros of the item', () => {
    expect(bookingMeal(booking, item)).toEqual({
      title: 'Эклер',
      kcalMin: 297,
      kcalMax: 363,
      proteinG: 5,
      fatG: 18,
      carbsG: 38.2,
      tags: ['dessert', 'sweet'],
    });
  });

  it('rounds calories and keeps unknown macros empty', () => {
    expect(
      bookingMeal(
        { itemName: 'Чай', kcal: 5 },
        { ...item, proteinG: null, fatG: null, carbsG: null, tags: [] },
      ),
    ).toEqual({
      title: 'Чай',
      kcalMin: 5,
      kcalMax: 6,
      proteinG: null,
      fatG: null,
      carbsG: null,
      tags: [],
    });
  });

  it('stays within the limits of a diary entry', () => {
    const meal = bookingMeal(
      { itemName: 'Сет', kcal: 5000 },
      {
        proteinG: 800,
        fatG: 20,
        carbsG: 1000,
        tags: [
          'meat',
          'fish',
          'rice',
          'soup',
          'salad',
          'bread',
          'dessert',
          'sweet',
          'tea',
          'drink',
          'hearty',
        ],
      },
    );
    expect(meal).toMatchObject({ kcalMin: 4500, kcalMax: 5000, proteinG: 500, fatG: 20, carbsG: 500 });
    expect(meal.tags).toHaveLength(10);
  });
});
