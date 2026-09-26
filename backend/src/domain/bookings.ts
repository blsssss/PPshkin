import { randomInt } from 'node:crypto';
import { nextClosingAt } from '../shared/time.ts';
import { MEAL_LIMITS } from './meals.ts';
import type { Booking, Macros, MenuItem, Venue } from './models.ts';
import type { Tag } from './vocabulary.ts';

export const BOOKING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const BOOKING_CODE_LENGTH = 6;
export const BOOKING_HOLD_MINUTES = 60;
export const MAX_ACTIVE_BOOKINGS = 3;

const QR_PREFIX = 'ppshkin:booking:';
const CODE = new RegExp(`^[${BOOKING_CODE_ALPHABET}]{${BOOKING_CODE_LENGTH}}$`);
const KCAL_SPREAD = 0.1;
const MINUTE_MS = 60_000;

const LATIN_LOOKALIKES: Readonly<Record<string, string>> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'Y',
  Х: 'X',
};

export interface BookingMeal extends Macros {
  title: string;
  kcalMin: number;
  kcalMax: number;
  tags: Tag[];
}

export interface BookingExpiryInput {
  now: Date;
  dealEndsAt: Date | null;
  venue: Pick<Venue, 'opensAt' | 'closesAt' | 'timezone'>;
}

export function generateBookingCode(): string {
  return Array.from({ length: BOOKING_CODE_LENGTH }, () =>
    BOOKING_CODE_ALPHABET.charAt(randomInt(BOOKING_CODE_ALPHABET.length)),
  ).join('');
}

export function normalizeBookingCode(input: string): string | null {
  const compact = Array.from(
    input.replace(/\s+/g, '').toUpperCase(),
    (letter) => LATIN_LOOKALIKES[letter] ?? letter,
  ).join('');
  const prefix = QR_PREFIX.toUpperCase();
  const code = compact.startsWith(prefix) ? compact.slice(prefix.length) : compact;
  return CODE.test(code) ? code : null;
}

export function qrPayload(code: string): string {
  return `${QR_PREFIX}${code}`;
}

export function bookingExpiresAt({ now, dealEndsAt, venue }: BookingExpiryInput): Date {
  const closing = nextClosingAt(venue.opensAt, venue.closesAt, now, venue.timezone);
  const limits = [
    now.getTime() + BOOKING_HOLD_MINUTES * MINUTE_MS,
    dealEndsAt?.getTime(),
    closing?.getTime(),
  ];
  return new Date(Math.min(...limits.filter((limit) => limit !== undefined)));
}

const withinGrams = (grams: number | null) => (grams === null ? null : Math.min(grams, MEAL_LIMITS.grams));

export function bookingMeal(
  booking: Pick<Booking, 'itemName' | 'kcal'>,
  item: Pick<MenuItem, 'proteinG' | 'fatG' | 'carbsG' | 'tags'>,
): BookingMeal {
  return {
    title: booking.itemName,
    kcalMin: Math.min(Math.round(booking.kcal * (1 - KCAL_SPREAD)), MEAL_LIMITS.kcal),
    kcalMax: Math.min(Math.round(booking.kcal * (1 + KCAL_SPREAD)), MEAL_LIMITS.kcal),
    proteinG: withinGrams(item.proteinG),
    fatG: withinGrams(item.fatG),
    carbsG: withinGrams(item.carbsG),
    tags: item.tags.slice(0, MEAL_LIMITS.tags),
  };
}
