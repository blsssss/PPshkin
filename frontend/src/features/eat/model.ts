import type { Schemas } from '../../api/client.ts';
import { formatLocalTime, formatPrice, NBSP } from '../../shared/format.ts';
import type { GeoPoint } from '../../shared/geo/useGeolocation.ts';
import { MEAL_SLOT_LABELS, VENUE_CATEGORY_LABELS } from '../../shared/vocabulary.ts';

export type Venue = Schemas['Venue'];
export type Deal = Schemas['Deal'];
export type MenuItem = Schemas['MenuItem'];
export type Recommendations = Schemas['Recommendations'];
export type RecommendationItem = Schemas['RecommendationItem'];

export type PointSource = 'device' | 'saved' | 'none';

export const RADIUS_OPTIONS = [1000, 3000, 5000, 10_000] as const;
export type Radius = (typeof RADIUS_OPTIONS)[number];
const DEFAULT_RADIUS: Radius = 3000;
const RADIUS_KEY = 'ppshkin.radius';

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundPoint(point: GeoPoint): GeoPoint {
  return { lat: round3(point.lat), lon: round3(point.lon) };
}

export function resolveSearchPoint(
  device: GeoPoint | null,
  saved: GeoPoint | null | undefined,
): { source: PointSource; point: GeoPoint | null } {
  if (device !== null) return { source: 'device', point: roundPoint(device) };
  if (saved !== null && saved !== undefined) return { source: 'saved', point: roundPoint(saved) };
  return { source: 'none', point: null };
}

export function readRadius(): Radius {
  try {
    const stored = Number(localStorage.getItem(RADIUS_KEY));
    return RADIUS_OPTIONS.find((option) => option === stored) ?? DEFAULT_RADIUS;
  } catch {
    return DEFAULT_RADIUS;
  }
}

export function writeRadius(radius: Radius): void {
  try {
    localStorage.setItem(RADIUS_KEY, String(radius));
  } catch {
    return;
  }
}

export function radiusLabel(radius: number): string {
  return `${radius / 1000}${NBSP}км`;
}

function minutesOf(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function shortTime(time: string): string {
  return time.slice(0, 5);
}

export function hoursText(venue: Pick<Venue, 'opensAt' | 'closesAt'>, openNow: boolean): string {
  if (minutesOf(venue.opensAt) === minutesOf(venue.closesAt)) return 'Круглосуточно';
  return openNow
    ? `Открыто до ${shortTime(venue.closesAt)}`
    : `Закрыто, откроется в ${shortTime(venue.opensAt)}`;
}

export function dealEnds(deal: Pick<Deal, 'endsAt'>, venue: Pick<Venue, 'timezone'>): string {
  return `до ${formatLocalTime(deal.endsAt, venue.timezone)}`;
}

export function timeLeft(endsAt: string, now: Date): string | null {
  const minutes = Math.floor((new Date(endsAt).getTime() - now.getTime()) / 60_000);
  if (minutes <= 0 || minutes >= 120) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `ещё ${rest}${NBSP}мин`;
  return rest === 0 ? `ещё ${hours}${NBSP}ч` : `ещё ${hours}${NBSP}ч ${rest}${NBSP}мин`;
}

export function bookingLink(params: {
  venueId: number;
  menuItemId: number;
  dealId?: number | null;
  offerId?: number | null;
}): string {
  const query = new URLSearchParams({
    venueId: String(params.venueId),
    menuItemId: String(params.menuItemId),
  });
  if (params.dealId !== undefined && params.dealId !== null) query.set('dealId', String(params.dealId));
  if (params.offerId !== undefined && params.offerId !== null) query.set('offerId', String(params.offerId));
  return `/bookings/new?${query.toString()}`;
}

export function dealShareText(deal: Deal, venue: Venue): string {
  return `${deal.itemName} за ${formatPrice(deal.priceRub)} вместо ${formatPrice(deal.originalPriceRub)} ${dealEnds(deal, venue)}, ${venue.name}, ${venue.address}`;
}

export function venueShareText(venue: Venue): string {
  return `${venue.name}, ${VENUE_CATEGORY_LABELS[venue.category].toLowerCase()}, ${venue.address}`;
}

export function mapsLink(point: GeoPoint): string {
  return `https://yandex.ru/maps/?pt=${point.lon},${point.lat}&z=17&l=map`;
}

export function recommendationHeader(
  data: Pick<Recommendations, 'slot' | 'remainingKcal' | 'slotBudgetKcal'>,
): string {
  const slot = MEAL_SLOT_LABELS[data.slot];
  return `Сейчас ${slot}. До ориентира осталось около ${data.remainingKcal}${NBSP}ккал, на ${slot} примерно ${data.slotBudgetKcal}${NBSP}ккал`;
}

export function demoCenterUsed(data: object | undefined): boolean {
  return data !== undefined && 'demoCenterUsed' in data && data.demoCenterUsed === true;
}
