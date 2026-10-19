import { maybeOne, type Queryable } from '../db/pool.ts';
import type { VenueSignalStats } from '../domain/moderation.ts';

export interface BlockState {
  blockedAt: Date | null;
}

export async function lockVenue(db: Queryable, id: number): Promise<BlockState | null> {
  const row = await maybeOne<{ blocked_at: Date | null }>(
    db,
    'select blocked_at from venues where id = $1 for update',
    [id],
  );
  return row ? { blockedAt: row.blocked_at } : null;
}

export async function setVenueBlock(
  db: Queryable,
  id: number,
  block: { at: Date; reason: string } | null,
): Promise<void> {
  await db.query('update venues set blocked_at = $2, blocked_reason = $3 where id = $1', [
    id,
    block?.at ?? null,
    block?.reason ?? null,
  ]);
}

export async function findVenueBlock(
  db: Queryable,
  id: number,
): Promise<{ blockedAt: Date; reason: string | null } | null> {
  const row = await maybeOne<{ blocked_at: Date | null; blocked_reason: string | null }>(
    db,
    'select blocked_at, blocked_reason from venues where id = $1',
    [id],
  );
  return row?.blocked_at ? { blockedAt: row.blocked_at, reason: row.blocked_reason } : null;
}

export async function cancelLiveDealsInVenue(db: Queryable, venueId: number, now: Date): Promise<void> {
  await db.query(
    'update deals set cancelled_at = $2 where venue_id = $1 and cancelled_at is null and ends_at > $2',
    [venueId, now],
  );
}

export async function lockUser(db: Queryable, id: number): Promise<BlockState | null> {
  const row = await maybeOne<{ blocked_at: Date | null }>(
    db,
    'select blocked_at from users where id = $1 for update',
    [id],
  );
  return row ? { blockedAt: row.blocked_at } : null;
}

export async function shareUser(db: Queryable, id: number): Promise<BlockState | null> {
  const row = await maybeOne<{ blocked_at: Date | null }>(
    db,
    'select blocked_at from users where id = $1 for share',
    [id],
  );
  return row ? { blockedAt: row.blocked_at } : null;
}

export async function setUserBlock(
  db: Queryable,
  id: number,
  block: { at: Date; reason: string } | null,
): Promise<void> {
  await db.query('update users set blocked_at = $2, blocked_reason = $3 where id = $1', [
    id,
    block?.at ?? null,
    block?.reason ?? null,
  ]);
}

export async function venueSignalStats(db: Queryable, since: Date): Promise<VenueSignalStats[]> {
  const { rows } = await db.query<VenueSignalStats>(
    `select v.id as "venueId", v.name,
            (select count(*)::int from complaints c
              where c.venue_id = v.id and c.status = 'open' and c.created_at >= $1) as "openComplaints",
            (select count(*)::int from bookings b
              where b.venue_id = v.id and b.created_at >= $1 and b.user_id > 0) as bookings,
            (select count(*)::int from bookings b
              where b.venue_id = v.id and b.created_at >= $1 and b.user_id > 0
                and b.status = 'redeemed') as redeemed
       from venues v
      where not v.is_demo and v.blocked_at is null
      order by v.id`,
    [since],
  );
  return rows;
}
