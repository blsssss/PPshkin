import pg from 'pg';
import { maybeOne, one, type Queryable } from '../db/pool.ts';
import type { Booking } from '../domain/models.ts';
import type { BookingStatus } from '../domain/vocabulary.ts';

interface BookingRow {
  id: number;
  user_id: number | null;
  venue_id: number;
  menu_item_id: number;
  deal_id: number | null;
  offer_id: number | null;
  code: string;
  item_name: string;
  price_rub: number;
  kcal: number;
  status: BookingStatus;
  expires_at: Date;
  created_at: Date;
  resolved_at: Date | null;
}

const BOOKING_COLUMNS = `b.id, b.user_id, b.venue_id, b.menu_item_id, b.deal_id, b.offer_id, b.code, b.item_name,
  b.price_rub, b.kcal, b.status, b.expires_at, b.created_at, b.resolved_at`;

const ACTIVE_CODE_INDEX = 'bookings_active_code';
const UNIQUE_VIOLATION = '23505';

function mapBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    userId: row.user_id,
    venueId: row.venue_id,
    menuItemId: row.menu_item_id,
    dealId: row.deal_id,
    offerId: row.offer_id,
    code: row.code,
    itemName: row.item_name,
    priceRub: row.price_rub,
    kcal: row.kcal,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function restockDeals(released: string, at: string): string {
  return `update deals d
       set quantity_left = least(d.quantity_total, d.quantity_left + r.units)
      from (select deal_id, count(*)::int as units from ${released} where deal_id is not null group by deal_id) r
     where d.id = r.deal_id and d.cancelled_at is null and d.ends_at > ${at}`;
}

export type BookingScope = { userId: number } | { venueId: number } | Record<string, never>;

export interface NewBooking {
  userId: number;
  venueId: number;
  menuItemId: number;
  dealId: number | null;
  offerId: number | null;
  code: string;
  itemName: string;
  priceRub: number;
  kcal: number;
  expiresAt: Date;
  createdAt: Date;
}

export interface TimeRange {
  from: Date;
  to: Date;
}

export interface FinishedFilter {
  created: TimeRange | null;
  resolvedSince: Date | null;
}

export async function insertIfCodeFree(db: Queryable, booking: NewBooking): Promise<Booking | null> {
  await db.query('savepoint booking_code');
  try {
    const row = await one<BookingRow>(
      db,
      `insert into bookings as b (user_id, venue_id, menu_item_id, deal_id, offer_id, code, item_name, price_rub,
                                  kcal, expires_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning ${BOOKING_COLUMNS}`,
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
        booking.expiresAt,
        booking.createdAt,
      ],
    );
    await db.query('release savepoint booking_code');
    return mapBooking(row);
  } catch (error) {
    const codeTaken =
      error instanceof pg.DatabaseError &&
      error.code === UNIQUE_VIOLATION &&
      error.constraint === ACTIVE_CODE_INDEX;
    if (!codeTaken) throw error;
    await db.query('rollback to savepoint booking_code');
    return null;
  }
}

export async function listActiveItemIds(db: Queryable, userId: number): Promise<number[]> {
  const { rows } = await db.query<{ menu_item_id: number }>(
    `select menu_item_id from bookings where user_id = $1 and status = 'active' order by id`,
    [userId],
  );
  return rows.map((row) => row.menu_item_id);
}

export async function findForUser(db: Queryable, userId: number, id: number): Promise<Booking | null> {
  const row = await maybeOne<BookingRow>(
    db,
    `select ${BOOKING_COLUMNS} from bookings b where b.id = $1 and b.user_id = $2`,
    [id, userId],
  );
  return row ? mapBooking(row) : null;
}

export async function lockForUser(db: Queryable, userId: number, id: number): Promise<Booking | null> {
  const row = await maybeOne<BookingRow>(
    db,
    `select ${BOOKING_COLUMNS} from bookings b where b.id = $1 and b.user_id = $2 for update`,
    [id, userId],
  );
  return row ? mapBooking(row) : null;
}

export async function lockLatestByCode(
  db: Queryable,
  venueId: number,
  code: string,
): Promise<Booking | null> {
  const row = await maybeOne<BookingRow>(
    db,
    `select ${BOOKING_COLUMNS} from bookings b
      where b.venue_id = $1 and b.code = $2
      order by b.created_at desc, b.id desc
      limit 1
      for update`,
    [venueId, code],
  );
  return row ? mapBooking(row) : null;
}

export async function listActiveForUser(db: Queryable, userId: number): Promise<Booking[]> {
  const { rows } = await db.query<BookingRow>(
    `select ${BOOKING_COLUMNS} from bookings b
      where b.user_id = $1 and b.status = 'active'
      order by b.expires_at, b.id`,
    [userId],
  );
  return rows.map(mapBooking);
}

export async function listFinishedForUser(db: Queryable, userId: number, limit: number): Promise<Booking[]> {
  const { rows } = await db.query<BookingRow>(
    `select ${BOOKING_COLUMNS} from bookings b
      where b.user_id = $1 and b.status <> 'active'
      order by b.created_at desc, b.id desc
      limit $2`,
    [userId, limit],
  );
  return rows.map(mapBooking);
}

export async function listActiveInVenue(
  db: Queryable,
  venueId: number,
  created: TimeRange | null,
): Promise<Booking[]> {
  const { rows } = await db.query<BookingRow>(
    `select ${BOOKING_COLUMNS} from bookings b
      where b.venue_id = $1 and b.status = 'active'
        and ($2::timestamptz is null or b.created_at >= $2)
        and ($3::timestamptz is null or b.created_at < $3)
      order by b.expires_at, b.id`,
    [venueId, created?.from ?? null, created?.to ?? null],
  );
  return rows.map(mapBooking);
}

export async function listFinishedInVenue(
  db: Queryable,
  venueId: number,
  { created, resolvedSince }: FinishedFilter,
  limit: number,
): Promise<Booking[]> {
  const { rows } = await db.query<BookingRow>(
    `select ${BOOKING_COLUMNS} from bookings b
      where b.venue_id = $1 and b.status <> 'active'
        and ($2::timestamptz is null or b.created_at >= $2)
        and ($3::timestamptz is null or b.created_at < $3)
        and ($4::timestamptz is null or b.resolved_at >= $4)
      order by b.resolved_at desc, b.id desc
      limit $5`,
    [venueId, created?.from ?? null, created?.to ?? null, resolvedSince, limit],
  );
  return rows.map(mapBooking);
}

export async function release(
  db: Queryable,
  id: number,
  status: Extract<BookingStatus, 'cancelled' | 'expired'>,
  at: Date,
): Promise<Booking> {
  const row = await one<BookingRow>(
    db,
    `with released as (
       update bookings as b set status = $2, resolved_at = $3
        where b.id = $1 and b.status = 'active'
       returning ${BOOKING_COLUMNS}
     ), restocked as (${restockDeals('released', '$3')})
     select ${BOOKING_COLUMNS} from released b`,
    [id, status, at],
  );
  return mapBooking(row);
}

export async function cancelActiveForUser(db: Queryable, userId: number, at: Date): Promise<void> {
  await db.query(
    `with cancelled as (
       update bookings set status = 'cancelled', resolved_at = $2
        where user_id = $1 and status = 'active'
       returning deal_id
     )
     ${restockDeals('cancelled', '$2')}`,
    [userId, at],
  );
}

export async function markRedeemed(db: Queryable, id: number, at: Date): Promise<Booking> {
  const row = await one<BookingRow>(
    db,
    `update bookings as b set status = 'redeemed', resolved_at = $2
      where b.id = $1 and b.status = 'active'
      returning ${BOOKING_COLUMNS}`,
    [id, at],
  );
  return mapBooking(row);
}

function scopeFilter(scope: BookingScope): { condition: string; values: number[] } {
  if ('userId' in scope) return { condition: 'and b.user_id = $2', values: [scope.userId] };
  if ('venueId' in scope) return { condition: 'and b.venue_id = $2', values: [scope.venueId] };
  return { condition: '', values: [] };
}

export async function expireDue(db: Queryable, scope: BookingScope, now: Date): Promise<Booking[]> {
  const { condition, values } = scopeFilter(scope);
  const { rows } = await db.query<BookingRow>(
    `with due as (
       select b.id from bookings b
        where b.status = 'active' and b.expires_at <= $1 ${condition}
        order by b.id
        for update
     ), expired as (
       update bookings as b set status = 'expired', resolved_at = $1
         from due
        where b.id = due.id
       returning ${BOOKING_COLUMNS}
     ), restocked as (${restockDeals('expired', '$1')})
     select ${BOOKING_COLUMNS} from expired b order by b.id`,
    [now, ...values],
  );
  return rows.map(mapBooking);
}
