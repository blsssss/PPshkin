import { maybeOne, one, type Queryable } from '../db/pool.ts';
import type { Deal } from '../domain/models.ts';

interface DealRow {
  id: number;
  venue_id: number;
  menu_item_id: number;
  price_rub: number;
  quantity_total: number;
  quantity_left: number;
  starts_at: Date;
  ends_at: Date;
  cancelled_at: Date | null;
  created_at: Date;
}

const DEAL_COLUMNS = `d.id, d.venue_id, d.menu_item_id, d.price_rub, d.quantity_total, d.quantity_left, d.starts_at,
  d.ends_at, d.cancelled_at, d.created_at`;

const LIVE = 'd.cancelled_at is null and d.quantity_left > 0';

function visibleTo(nowParam: string): string {
  return `${LIVE} and d.starts_at <= ${nowParam} and d.ends_at > ${nowParam}
    and m.archived_at is null and m.is_available`;
}

function mapDeal(row: DealRow): Deal {
  return {
    id: row.id,
    venueId: row.venue_id,
    menuItemId: row.menu_item_id,
    priceRub: row.price_rub,
    quantityTotal: row.quantity_total,
    quantityLeft: row.quantity_left,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
  };
}

export interface NewDeal {
  venueId: number;
  menuItemId: number;
  priceRub: number;
  quantity: number;
  endsAt: Date;
}

export interface ScheduledDeal extends NewDeal {
  startsAt: Date;
  quantityLeft: number;
}

export interface DealChanges {
  quantityLeft: number;
  endsAt: Date;
}

export async function insert(db: Queryable, deal: NewDeal, now: Date): Promise<Deal> {
  const row = await one<DealRow>(
    db,
    `insert into deals as d (venue_id, menu_item_id, price_rub, quantity_total, quantity_left, starts_at, ends_at,
                             created_at)
     values ($1, $2, $3, $4, $4, $5, $6, $5)
     returning ${DEAL_COLUMNS}`,
    [deal.venueId, deal.menuItemId, deal.priceRub, deal.quantity, now, deal.endsAt],
  );
  return mapDeal(row);
}

export async function insertScheduled(db: Queryable, deal: ScheduledDeal, createdAt: Date): Promise<Deal> {
  const row = await one<DealRow>(
    db,
    `insert into deals as d (venue_id, menu_item_id, price_rub, quantity_total, quantity_left, starts_at, ends_at,
                             created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning ${DEAL_COLUMNS}`,
    [
      deal.venueId,
      deal.menuItemId,
      deal.priceRub,
      deal.quantity,
      deal.quantityLeft,
      deal.startsAt,
      deal.endsAt,
      createdAt,
    ],
  );
  return mapDeal(row);
}

export async function update(db: Queryable, id: number, changes: DealChanges): Promise<Deal> {
  const row = await one<DealRow>(
    db,
    `update deals as d set quantity_left = $2, ends_at = $3 where d.id = $1 returning ${DEAL_COLUMNS}`,
    [id, changes.quantityLeft, changes.endsAt],
  );
  return mapDeal(row);
}

export async function cancelLiveInVenue(
  db: Queryable,
  venueId: number,
  id: number,
  now: Date,
): Promise<void> {
  await db.query(
    `update deals as d set cancelled_at = $3
      where d.venue_id = $1 and d.id = $2 and ${LIVE} and d.ends_at > $3`,
    [venueId, id, now],
  );
}

export async function cancelLiveForItem(db: Queryable, menuItemId: number, now: Date): Promise<void> {
  await db.query(
    `update deals as d set cancelled_at = $2
      where d.menu_item_id = $1 and ${LIVE} and d.ends_at > $2`,
    [menuItemId, now],
  );
}

export async function findInVenue(db: Queryable, venueId: number, id: number): Promise<Deal | null> {
  const row = await maybeOne<DealRow>(
    db,
    `select ${DEAL_COLUMNS} from deals d where d.venue_id = $1 and d.id = $2`,
    [venueId, id],
  );
  return row ? mapDeal(row) : null;
}

export async function lockInVenue(db: Queryable, venueId: number, id: number): Promise<Deal | null> {
  const row = await maybeOne<DealRow>(
    db,
    `select ${DEAL_COLUMNS} from deals d where d.venue_id = $1 and d.id = $2 for update`,
    [venueId, id],
  );
  return row ? mapDeal(row) : null;
}

export async function findLiveForItem(db: Queryable, menuItemId: number, now: Date): Promise<Deal | null> {
  const row = await maybeOne<DealRow>(
    db,
    `select ${DEAL_COLUMNS} from deals d
      where d.menu_item_id = $1 and ${LIVE} and d.ends_at > $2
      order by d.id
      limit 1`,
    [menuItemId, now],
  );
  return row ? mapDeal(row) : null;
}

export async function listLive(db: Queryable, venueId: number, now: Date): Promise<Deal[]> {
  const { rows } = await db.query<DealRow>(
    `select ${DEAL_COLUMNS} from deals d
      where d.venue_id = $1 and ${LIVE} and d.ends_at > $2
      order by d.ends_at, d.id`,
    [venueId, now],
  );
  return rows.map(mapDeal);
}

export async function listFinished(db: Queryable, venueId: number, now: Date, since: Date): Promise<Deal[]> {
  const { rows } = await db.query<DealRow>(
    `select ${DEAL_COLUMNS} from deals d
      where d.venue_id = $1 and d.created_at >= $3
        and (d.cancelled_at is not null or d.quantity_left = 0 or d.ends_at <= $2)
      order by d.ends_at desc, d.id desc`,
    [venueId, now, since],
  );
  return rows.map(mapDeal);
}

export async function listVisible(db: Queryable, venueIds: readonly number[], now: Date): Promise<Deal[]> {
  if (venueIds.length === 0) return [];
  const { rows } = await db.query<DealRow>(
    `select ${DEAL_COLUMNS} from deals d
       join menu_items m on m.id = d.menu_item_id
      where d.venue_id = any($1::bigint[]) and ${visibleTo('$2')}
      order by d.ends_at, d.id`,
    [venueIds, now],
  );
  return rows.map(mapDeal);
}

export async function findVisible(db: Queryable, id: number, now: Date): Promise<Deal | null> {
  const row = await maybeOne<DealRow>(
    db,
    `select ${DEAL_COLUMNS} from deals d
       join menu_items m on m.id = d.menu_item_id
      where d.id = $1 and ${visibleTo('$2')}`,
    [id, now],
  );
  return row ? mapDeal(row) : null;
}

export async function countVisibleByVenue(
  db: Queryable,
  venueIds: readonly number[],
  now: Date,
): Promise<Map<number, number>> {
  if (venueIds.length === 0) return new Map();
  const { rows } = await db.query<{ venue_id: number; deals: number }>(
    `select d.venue_id, count(*) as deals from deals d
       join menu_items m on m.id = d.menu_item_id
      where d.venue_id = any($1::bigint[]) and ${visibleTo('$2')}
      group by d.venue_id`,
    [venueIds, now],
  );
  return new Map(rows.map((row) => [row.venue_id, row.deals]));
}

export async function listStartingBetween(
  db: Queryable,
  venueId: number,
  from: Date,
  to: Date,
): Promise<Deal[]> {
  const { rows } = await db.query<DealRow>(
    `select ${DEAL_COLUMNS} from deals d
      where d.venue_id = $1 and d.starts_at >= $2 and d.starts_at < $3
      order by d.starts_at, d.id`,
    [venueId, from, to],
  );
  return rows.map(mapDeal);
}
