import type { GeoPoint } from '../../domain/models.ts';

export const VENUE_NAME_LIMIT = 120;
export const VENUE_ADDRESS_LIMIT = 200;
export const MENU_TEXT_LIMIT = 8000;
export const DEAL_QUANTITY_LIMIT = 100;

interface OpeningHours {
  opensAt: string;
  closesAt: string;
}

const COORDINATES = /^(-?\d{1,3}(?:\.\d+)?)\s*(?:,\s*|\s+)(-?\d{1,3}(?:\.\d+)?)$/;
const HOURS = /^(\d{1,2})(?:[:.](\d{2}))?\s*[-\u2013\u2014]\s*(\d{1,2})(?:[:.](\d{2}))?$/;
const QUANTITY = /^(\d{1,4})\s*(?:шт\.?|порци[йия])?$/i;
const PRICE = /^(\d{1,6})\s*(?:₽|р\.?|руб\.?|рубл[ьяей]{1,2})?$/i;
const DIGIT = /\d/;
const MIDNIGHT = 24;

export function parseTitle(text: string, limit: number): string | null {
  const title = text.trim().replace(/\s+/g, ' ');
  return title.length >= 1 && title.length <= limit ? title : null;
}

export function parseCoordinates(text: string): GeoPoint | null {
  const [, lat, lon] = COORDINATES.exec(text.trim()) ?? [];
  if (lat === undefined || lon === undefined) return null;
  const point = { lat: Number(lat), lon: Number(lon) };
  return Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180 ? point : null;
}

function clockTime(hours: string, minutes = '00'): string | null {
  const hour = Number(hours);
  const minute = Number(minutes);
  if (minute > 59 || hour > MIDNIGHT || (hour === MIDNIGHT && minute > 0)) return null;
  return `${String(hour % MIDNIGHT).padStart(2, '0')}:${minutes}`;
}

export function parseHours(text: string): OpeningHours | null {
  const [, openHour, openMinute, closeHour, closeMinute] = HOURS.exec(text.trim()) ?? [];
  if (openHour === undefined || closeHour === undefined) return null;
  const opensAt = clockTime(openHour, openMinute);
  const closesAt = clockTime(closeHour, closeMinute);
  return opensAt !== null && closesAt !== null ? { opensAt, closesAt } : null;
}

function wholeNumber(pattern: RegExp, text: string, min: number, max: number): number | null {
  const [, digits] = pattern.exec(text.trim()) ?? [];
  if (digits === undefined) return null;
  const value = Number(digits);
  return value >= min && value <= max ? value : null;
}

export function parseQuantity(text: string): number | null {
  return wholeNumber(QUANTITY, text, 1, DEAL_QUANTITY_LIMIT);
}

export function parsePrice(text: string, max: number): number | null {
  return wholeNumber(PRICE, text, 1, max);
}

export function looksLikeMenu(text: string): boolean {
  return DIGIT.test(text);
}
