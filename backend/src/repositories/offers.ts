import { jsonb, maybeOne, type Queryable } from '../db/pool.ts';
import type { Offer, OfferExplanation } from '../domain/models.ts';
import {
  DECLINE_REASONS,
  type DeclineReason,
  type OfferChannel,
  type OfferStatus,
} from '../domain/vocabulary.ts';

interface OfferRow {
  id: number;
  user_id: number | null;
  venue_id: number;
  menu_item_id: number;
  deal_id: number | null;
  channel: OfferChannel;
  score: number;
  explanation: OfferExplanation;
  status: OfferStatus;
  decline_reason: DeclineReason | null;
  created_at: Date;
  responded_at: Date | null;
}

const OFFER_COLUMNS = `id, user_id, venue_id, menu_item_id, deal_id, channel, score, explanation, status,
  decline_reason, created_at, responded_at`;

function mapOffer(row: OfferRow): Offer {
  return {
    id: row.id,
    userId: row.user_id,
    venueId: row.venue_id,
    menuItemId: row.menu_item_id,
    dealId: row.deal_id,
    channel: row.channel,
    score: row.score,
    explanation: row.explanation,
    status: row.status,
    declineReason: row.decline_reason,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
  };
}

export interface NewOffer {
  venueId: number;
  menuItemId: number;
  dealId: number | null;
  score: number;
  explanation: OfferExplanation;
}

export interface ShownOffers {
  userId: number;
  channel: OfferChannel;
  shownAt: Date;
  offers: readonly NewOffer[];
}

export interface OfferDecline {
  id: number;
  userId: number;
  reason: DeclineReason;
  at: Date;
}

export async function insertShown(
  db: Queryable,
  { userId, channel, shownAt, offers }: ShownOffers,
): Promise<Offer[]> {
  if (offers.length === 0) return [];
  const { rows } = await db.query<OfferRow>(
    `with inserted as (
       insert into offers (user_id, venue_id, menu_item_id, deal_id, channel, score, explanation, created_at)
       select $1, venue_id, menu_item_id, deal_id, $2, score, explanation, $3
         from unnest($4::bigint[], $5::bigint[], $6::bigint[], $7::double precision[], $8::jsonb[])
              with ordinality as shown (venue_id, menu_item_id, deal_id, score, explanation, position)
        order by position
       returning ${OFFER_COLUMNS}
     )
     select ${OFFER_COLUMNS} from inserted order by id`,
    [
      userId,
      channel,
      shownAt,
      offers.map((offer) => offer.venueId),
      offers.map((offer) => offer.menuItemId),
      offers.map((offer) => offer.dealId),
      offers.map((offer) => offer.score),
      offers.map((offer) => jsonb(offer.explanation)),
    ],
  );
  return rows.map(mapOffer);
}

export async function decline(db: Queryable, { id, userId, reason, at }: OfferDecline): Promise<boolean> {
  const { rowCount } = await db.query(
    `update offers set status = 'declined', decline_reason = $3, responded_at = $4
      where id = $1 and user_id = $2 and status <> 'accepted'`,
    [id, userId, reason, at],
  );
  return rowCount === 1;
}

export interface OfferAcceptance {
  id: number;
  userId: number;
  menuItemId: number;
  at: Date;
}

export async function accept(
  db: Queryable,
  { id, userId, menuItemId, at }: OfferAcceptance,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update offers set status = 'accepted', decline_reason = null, responded_at = $4
      where id = $1 and user_id = $2 and menu_item_id = $3`,
    [id, userId, menuItemId, at],
  );
  return rowCount === 1;
}

export async function findStatus(db: Queryable, userId: number, id: number): Promise<OfferStatus | null> {
  const row = await maybeOne<{ status: OfferStatus }>(
    db,
    'select status from offers where id = $1 and user_id = $2',
    [id, userId],
  );
  return row?.status ?? null;
}

export async function listItemsShownSince(db: Queryable, userId: number, since: Date): Promise<number[]> {
  const { rows } = await db.query<{ menu_item_id: number }>(
    `select distinct menu_item_id from offers
      where user_id = $1 and created_at >= $2
      order by menu_item_id`,
    [userId, since],
  );
  return rows.map((row) => row.menu_item_id);
}

export async function listItemsDeclinedSince(
  db: Queryable,
  userId: number,
  since: Readonly<Record<DeclineReason, Date>>,
): Promise<number[]> {
  const { rows } = await db.query<{ menu_item_id: number }>(
    `select distinct o.menu_item_id
       from offers o
       join unnest($2::text[], $3::timestamptz[]) as hidden (reason, since) on hidden.reason = o.decline_reason
      where o.user_id = $1 and o.status = 'declined' and o.responded_at > hidden.since
      order by o.menu_item_id`,
    [userId, DECLINE_REASONS, DECLINE_REASONS.map((reason) => since[reason])],
  );
  return rows.map((row) => row.menu_item_id);
}
