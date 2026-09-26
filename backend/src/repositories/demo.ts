import { jsonb, one, type Queryable } from '../db/pool.ts';
import type { GeoPoint, OfferExplanation } from '../domain/models.ts';
import type {
  BookingStatus,
  MenuCategory,
  OfferChannel,
  OfferStatus,
  Tag,
  VenueCategory,
} from '../domain/vocabulary.ts';
import type { DayWindow } from './analytics.ts';

const DEMO_DATA_LOCK = 727_274_017;

export interface SeededVenue {
  id: number;
  ownerId: number | null;
  name: string;
  address: string;
  category: VenueCategory;
  location: GeoPoint;
  opensAt: string;
  closesAt: string;
  timezone: string;
}

export interface SeededMenuItem {
  id: number;
  venueId: number;
  name: string;
  description: string;
  category: MenuCategory;
  priceRub: number;
  weightG: number;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  tags: Tag[];
}

export interface HistoryOfferRow {
  userId: number;
  venueId: number;
  menuItemId: number;
  dealId: number | null;
  channel: OfferChannel;
  score: number;
  explanation: OfferExplanation;
  status: Exclude<OfferStatus, 'declined'>;
  createdAt: Date;
  respondedAt: Date | null;
}

export interface HistoryBookingRow {
  userId: number;
  venueId: number;
  menuItemId: number;
  dealId: number | null;
  offerId: number;
  code: string;
  itemName: string;
  priceRub: number;
  kcal: number;
  status: Exclude<BookingStatus, 'active'>;
  expiresAt: Date;
  createdAt: Date;
  resolvedAt: Date;
}

export async function lockDemoData(db: Queryable): Promise<void> {
  await db.query('select pg_advisory_xact_lock($1)', [DEMO_DATA_LOCK]);
}

export async function upsertVenues(db: Queryable, venues: readonly SeededVenue[], now: Date): Promise<void> {
  await db.query(
    `insert into venues as v (id, owner_id, name, address, category, lat, lon, opens_at, closes_at, timezone,
                              is_demo, demo_source_id, created_at, updated_at)
     select s.id, s.owner_id, s.name, s.address, s.category, s.lat, s.lon, s.opens_at, s.closes_at, s.timezone,
            true, null, $2, $2
       from jsonb_to_recordset($1::jsonb) as s (id bigint, owner_id bigint, name text, address text, category text,
                                                lat double precision, lon double precision, opens_at time,
                                                closes_at time, timezone text)
     on conflict (id) do update
        set owner_id = excluded.owner_id, name = excluded.name, address = excluded.address,
            category = excluded.category, lat = excluded.lat, lon = excluded.lon, opens_at = excluded.opens_at,
            closes_at = excluded.closes_at, timezone = excluded.timezone, is_demo = true, demo_source_id = null,
            updated_at = excluded.updated_at
      where (v.owner_id, v.name, v.address, v.category, v.lat, v.lon, v.opens_at, v.closes_at, v.timezone,
             v.is_demo, v.demo_source_id)
            is distinct from (excluded.owner_id, excluded.name, excluded.address, excluded.category, excluded.lat,
                              excluded.lon, excluded.opens_at, excluded.closes_at, excluded.timezone, true,
                              null::bigint)`,
    [
      jsonb(
        venues.map((venue) => ({
          id: venue.id,
          owner_id: venue.ownerId,
          name: venue.name,
          address: venue.address,
          category: venue.category,
          lat: venue.location.lat,
          lon: venue.location.lon,
          opens_at: venue.opensAt,
          closes_at: venue.closesAt,
          timezone: venue.timezone,
        })),
      ),
      now,
    ],
  );
}

export async function upsertMenuItems(
  db: Queryable,
  items: readonly SeededMenuItem[],
  now: Date,
): Promise<void> {
  await db.query(
    `insert into menu_items as m (id, venue_id, name, description, category, price_rub, weight_g, kcal, protein_g,
                                  fat_g, carbs_g, nutrition_source, tags, is_available, archived_at, created_at,
                                  updated_at)
     select s.id, s.venue_id, s.name, s.description, s.category, s.price_rub, s.weight_g, s.kcal, s.protein_g,
            s.fat_g, s.carbs_g, 'venue', s.tags, true, null, $2, $2
       from jsonb_to_recordset($1::jsonb) as s (id bigint, venue_id bigint, name text, description text,
                                                category text, price_rub integer, weight_g integer, kcal integer,
                                                protein_g double precision, fat_g double precision,
                                                carbs_g double precision, tags text[])
     on conflict (id) do update
        set name = excluded.name, description = excluded.description, category = excluded.category,
            price_rub = excluded.price_rub, weight_g = excluded.weight_g, kcal = excluded.kcal,
            protein_g = excluded.protein_g, fat_g = excluded.fat_g, carbs_g = excluded.carbs_g,
            nutrition_source = 'venue', tags = excluded.tags, is_available = true, archived_at = null,
            updated_at = excluded.updated_at
      where (m.name, m.description, m.category, m.price_rub, m.weight_g, m.kcal, m.protein_g, m.fat_g, m.carbs_g,
             m.nutrition_source, m.tags, m.is_available, m.archived_at)
            is distinct from (excluded.name, excluded.description, excluded.category, excluded.price_rub,
                              excluded.weight_g, excluded.kcal, excluded.protein_g, excluded.fat_g,
                              excluded.carbs_g, 'venue', excluded.tags, true, null::timestamptz)`,
    [
      jsonb(
        items.map((item) => ({
          id: item.id,
          venue_id: item.venueId,
          name: item.name,
          description: item.description,
          category: item.category,
          price_rub: item.priceRub,
          weight_g: item.weightG,
          kcal: item.kcal,
          protein_g: item.proteinG,
          fat_g: item.fatG,
          carbs_g: item.carbsG,
          tags: item.tags,
        })),
      ),
      now,
    ],
  );
}

export async function archiveMenuItemsOutside(
  db: Queryable,
  venueIds: readonly number[],
  keptItemIds: readonly number[],
  now: Date,
): Promise<void> {
  await db.query(
    `with archived as (
       update menu_items set archived_at = $3, updated_at = $3
        where venue_id = any($1::bigint[]) and archived_at is null and not (id = any($2::bigint[]))
       returning id
     )
     update deals d set cancelled_at = $3
       from archived a
      where d.menu_item_id = a.id and d.cancelled_at is null and d.quantity_left > 0 and d.ends_at > $3`,
    [venueIds, keptItemIds, now],
  );
}

export async function daysWithOffers(
  db: Queryable,
  userId: number,
  venueId: number,
  days: readonly DayWindow[],
): Promise<Set<string>> {
  if (days.length === 0) return new Set();
  const { rows } = await db.query<{ day: string }>(
    `select d.day
       from unnest($3::text[], $4::timestamptz[], $5::timestamptz[]) as d (day, starts_at, ends_at)
      where exists (
        select 1 from offers o
         where o.user_id = $1 and o.venue_id = $2 and o.created_at >= d.starts_at and o.created_at < d.ends_at
      )`,
    [userId, venueId, days.map((day) => day.date), days.map((day) => day.from), days.map((day) => day.to)],
  );
  return new Set(rows.map((row) => row.day));
}

export async function insertHistoryOffer(db: Queryable, offer: HistoryOfferRow): Promise<number> {
  const row = await one<{ id: number }>(
    db,
    `insert into offers (user_id, venue_id, menu_item_id, deal_id, channel, score, explanation, status, created_at,
                         responded_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
     returning id`,
    [
      offer.userId,
      offer.venueId,
      offer.menuItemId,
      offer.dealId,
      offer.channel,
      offer.score,
      jsonb(offer.explanation),
      offer.status,
      offer.createdAt,
      offer.respondedAt,
    ],
  );
  return row.id;
}

export async function insertHistoryBooking(db: Queryable, booking: HistoryBookingRow): Promise<void> {
  await db.query(
    `insert into bookings (user_id, venue_id, menu_item_id, deal_id, offer_id, code, item_name, price_rub, kcal,
                           status, expires_at, created_at, resolved_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      booking.userId,
      booking.venueId,
      booking.menuItemId,
      booking.dealId,
      booking.offerId,
      booking.code,
      booking.itemName,
      booking.priceRub,
      booking.kcal,
      booking.status,
      booking.expiresAt,
      booking.createdAt,
      booking.resolvedAt,
    ],
  );
}
