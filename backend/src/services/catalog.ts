import type { Pool } from '../db/pool.ts';
import { resolveDemoPoint } from '../demo/location.ts';
import type { GeoPoint, MenuItem, Venue } from '../domain/models.ts';
import * as deals from '../repositories/deals.ts';
import * as menuItems from '../repositories/menu-items.ts';
import * as users from '../repositories/users.ts';
import * as venues from '../repositories/venues.ts';
import type { Clock } from '../shared/clock.ts';
import { notFound } from '../shared/errors.ts';
import { distanceMeters } from '../shared/geo.ts';
import { isOpenAt } from '../shared/time.ts';
import { dealViews, type DealView } from './deals.ts';
import { byMenuOrder } from './menu.ts';

export interface CatalogQuery {
  point: GeoPoint | null;
  radiusM: number;
}

export interface VenueCardView {
  venue: Venue;
  distanceM: number | null;
  openNow: boolean;
  activeDeals: number;
}

export interface VenueDetailsView {
  venue: Venue;
  openNow: boolean;
  menu: MenuItem[];
  deals: DealView[];
}

export interface DealCardView {
  deal: DealView;
  venue: Venue;
  distanceM: number | null;
}

export interface NearbyResult<Card> {
  items: Card[];
  demoCenterUsed: boolean;
}

export interface CatalogService {
  venues(userId: number, query: CatalogQuery): Promise<NearbyResult<VenueCardView>>;
  venue(userId: number, venueId: number): Promise<VenueDetailsView>;
  deals(userId: number, query: CatalogQuery): Promise<NearbyResult<DealCardView>>;
  deal(userId: number, dealId: number): Promise<DealCardView>;
}

interface CatalogDependencies {
  pool: Pool;
  clock: Clock;
  demoMode: boolean;
}

interface Nearby {
  placed: PlacedVenue[];
  demoCenterUsed: boolean;
}

interface PlacedVenue {
  venue: Venue;
  distanceM: number | null;
  openNow: boolean;
}

const MAX_RESULTS = 50;
const EARTH_RADIUS_M = 6_371_000;
const collator = new Intl.Collator('ru');

const toDegrees = (angle: number) => (angle * 180) / Math.PI;
const toRadians = (angle: number) => (angle * Math.PI) / 180;

export function boundingBox(center: GeoPoint, radiusM: number): venues.GeoBox {
  const angular = radiusM / EARTH_RADIUS_M;
  const lat = toRadians(center.lat);
  const minLat = lat - angular;
  const maxLat = lat + angular;
  const whole = { minLat: Math.max(-90, toDegrees(minLat)), maxLat: Math.min(90, toDegrees(maxLat)) };
  if (minLat <= -Math.PI / 2 || maxLat >= Math.PI / 2) return { ...whole, minLon: -180, maxLon: 180 };
  const spread = toDegrees(Math.asin(Math.sin(angular) / Math.cos(lat)));
  const minLon = center.lon - spread;
  const maxLon = center.lon + spread;
  if (minLon < -180 || maxLon > 180) return { ...whole, minLon: -180, maxLon: 180 };
  return { ...whole, minLon, maxLon };
}

const dealNotFound = () => notFound('deal_not_found', 'Deal not found or no longer available');

function distanceFrom(point: GeoPoint | null, venue: Venue): number | null {
  return point ? Math.round(distanceMeters(point, venue.location)) : null;
}

function byDistance(left: PlacedVenue, right: PlacedVenue): number {
  return (
    (left.distanceM ?? 0) - (right.distanceM ?? 0) ||
    collator.compare(left.venue.name, right.venue.name) ||
    left.venue.id - right.venue.id
  );
}

function byOpenThenName(left: PlacedVenue, right: PlacedVenue): number {
  return (
    Number(right.openNow) - Number(left.openNow) ||
    collator.compare(left.venue.name, right.venue.name) ||
    left.venue.id - right.venue.id
  );
}

function bySoonestEnd(left: DealCardView, right: DealCardView): number {
  return (
    left.deal.deal.endsAt.getTime() - right.deal.deal.endsAt.getTime() ||
    (left.distanceM ?? 0) - (right.distanceM ?? 0) ||
    left.deal.deal.id - right.deal.deal.id
  );
}

export function createCatalogService({ pool, clock, demoMode }: CatalogDependencies): CatalogService {
  async function savedPoint(userId: number): Promise<GeoPoint | null> {
    return (await users.findById(pool, userId))?.location ?? null;
  }

  function place(venue: Venue, point: GeoPoint | null, now: Date): PlacedVenue {
    return {
      venue,
      distanceM: distanceFrom(point, venue),
      openNow: isOpenAt(venue.opensAt, venue.closesAt, now, venue.timezone),
    };
  }

  async function nearby(userId: number, query: CatalogQuery, now: Date): Promise<Nearby> {
    const { point, demoCenterUsed } = resolveDemoPoint(query.point ?? (await savedPoint(userId)), demoMode);
    if (!point) {
      const everywhere = await venues.listVisible(pool, userId);
      return {
        placed: everywhere.map((venue) => place(venue, null, now)).sort(byOpenThenName),
        demoCenterUsed,
      };
    }
    const candidates = await venues.listVisibleWithin(pool, boundingBox(point, query.radiusM), userId);
    const placed = candidates
      .filter((venue) => distanceMeters(point, venue.location) <= query.radiusM)
      .map((venue) => place(venue, point, now))
      .sort(byDistance);
    return { placed, demoCenterUsed };
  }

  return {
    async venues(userId, query) {
      const now = clock.now();
      const { placed, demoCenterUsed } = await nearby(userId, query, now);
      const found = placed.slice(0, MAX_RESULTS);
      const counts = await deals.countVisibleByVenue(
        pool,
        found.map(({ venue }) => venue.id),
        now,
      );
      return {
        items: found.map((card) => ({ ...card, activeDeals: counts.get(card.venue.id) ?? 0 })),
        demoCenterUsed,
      };
    },

    async venue(userId, venueId) {
      const venue = await venues.findVisible(pool, venueId, userId);
      if (!venue) throw notFound('venue_not_found', 'Venue not found');
      const now = clock.now();
      const [menu, visibleDeals] = await Promise.all([
        menuItems.listAvailable(pool, venue.id),
        deals.listVisible(pool, [venue.id], now),
      ]);
      return {
        venue,
        openNow: isOpenAt(venue.opensAt, venue.closesAt, now, venue.timezone),
        menu: menu.sort(byMenuOrder),
        deals: await dealViews(pool, visibleDeals, now),
      };
    },

    async deals(userId, query) {
      const now = clock.now();
      const { placed, demoCenterUsed } = await nearby(userId, query, now);
      const placedById = new Map(
        placed.filter(({ openNow }) => openNow).map((open) => [open.venue.id, open]),
      );
      const visible = await deals.listVisible(pool, [...placedById.keys()], now);
      const items = (await dealViews(pool, visible, now))
        .flatMap((view) => {
          const open = placedById.get(view.deal.venueId);
          return open ? [{ deal: view, venue: open.venue, distanceM: open.distanceM }] : [];
        })
        .sort(bySoonestEnd)
        .slice(0, MAX_RESULTS);
      return { items, demoCenterUsed };
    },

    async deal(userId, dealId) {
      const now = clock.now();
      const found = await deals.findVisible(pool, dealId, now);
      if (!found) throw dealNotFound();
      const [[view], venue, point] = await Promise.all([
        dealViews(pool, [found], now),
        venues.findVisible(pool, found.venueId, userId),
        savedPoint(userId),
      ]);
      if (!venue) throw dealNotFound();
      if (!view) throw new Error(`Deal ${dealId} lost its menu item`);
      return { deal: view, venue, distanceM: distanceFrom(resolveDemoPoint(point, demoMode).point, venue) };
    },
  };
}
