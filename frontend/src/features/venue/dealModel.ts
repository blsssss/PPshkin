import type { Schemas } from '../../api/client.ts';
import { formatPrice } from '../../shared/format.ts';
import { fromZonedInput, toZonedInput } from '../../shared/zonedTime.ts';
import type { Venue } from './model.ts';

export type Deal = Schemas['Deal'];

export const DISCOUNTS = [20, 30, 40, 50] as const;
export const QUANTITIES = [1, 3, 5, 10] as const;
export const MAX_QUANTITY = 100;
const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

export const DEAL_STATUS_LABELS: Record<Deal['status'], string> = {
  active: 'Продаётся',
  scheduled: 'Запланирована',
  sold_out: 'Распродана',
  ended: 'Время вышло',
  cancelled: 'Снята',
};

export function discountedPrice(priceRub: number, percent: number): number {
  return Math.round(priceRub * (1 - percent / 100));
}

export function validDealPrice(price: number, original: number): boolean {
  return Number.isInteger(price) && price >= 1 && price <= original - 1;
}

export function venueTimeToInstant(date: string, time: string, timeZone: string): Date | null {
  return fromZonedInput(`${date}T${time}`, timeZone);
}

function localDate(now: Date, timeZone: string): string {
  return toZonedInput(now, timeZone).slice(0, 10);
}

function nextDay(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function nextLocalTime(time: string, timeZone: string, now: Date): Date | null {
  const today = localDate(now, timeZone);
  const candidate = venueTimeToInstant(today, time, timeZone);
  if (candidate === null) return null;
  if (candidate.getTime() > now.getTime()) return candidate;
  return venueTimeToInstant(nextDay(today), time, timeZone);
}

function closingTime(venue: Pick<Venue, 'opensAt' | 'closesAt' | 'timezone'>, now: Date): Date | null {
  if (venue.opensAt === venue.closesAt) return null;
  return nextLocalTime(venue.closesAt, venue.timezone, now);
}

export type EndChoice =
  { kind: 'hours'; hours: 1 | 2 } | { kind: 'closing' } | { kind: 'time'; time: string };

export function resolveEnd(
  choice: EndChoice,
  venue: Pick<Venue, 'opensAt' | 'closesAt' | 'timezone'>,
  now: Date,
): Date | null {
  switch (choice.kind) {
    case 'hours':
      return new Date(now.getTime() + choice.hours * HOUR_MS);
    case 'closing':
      return closingTime(venue, now);
    case 'time':
      return nextLocalTime(choice.time, venue.timezone, now);
  }
}

export function withinWindow(endsAt: Date, now: Date): boolean {
  const delta = endsAt.getTime() - now.getTime();
  return delta > 0 && delta <= DAY_MS;
}

export function venueClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

export function dealPriceLine(deal: Pick<Deal, 'priceRub' | 'originalPriceRub' | 'discountPercent'>): string {
  return `${formatPrice(deal.priceRub)} вместо ${formatPrice(deal.originalPriceRub)}, -${String(deal.discountPercent)}%`;
}

export function dealPreview(
  name: string,
  price: number,
  original: number,
  quantity: number,
  endsAt: Date,
  timeZone: string,
): string {
  const percent = Math.round((1 - price / original) * 100);
  return `${name}: ${formatPrice(price)} вместо ${formatPrice(original)} (-${String(percent)}%), ${String(quantity)} шт., до ${venueClock(endsAt.toISOString(), timeZone)}`;
}

const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const PREFIX = 'PPSHKIN:BOOKING:';

export function normalizeBookingCode(value: string): string | null {
  let code = value.replace(/\s+/g, '').toUpperCase();
  if (code.startsWith(PREFIX)) code = code.slice(PREFIX.length);
  return CODE.test(code) ? code : null;
}

export function cleanCodeInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, '')
    .slice(0, 6);
}

export function formatRate(rate: number, denominator: number): string {
  return denominator === 0 ? '-' : `${String(Math.round(rate * 100))}%`;
}
