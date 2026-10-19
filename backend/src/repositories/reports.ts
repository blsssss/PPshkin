import { maybeOne, one, type Queryable } from '../db/pool.ts';
import type { Deal } from '../domain/models.ts';
import type { DealSource } from '../domain/reports.ts';

export type CloseoutChannel = 'bot' | 'miniapp';
export type ReportRunKind = 'day_close' | 'weekly';

export interface DealReportRow {
  deal: Deal;
  itemName: string;
  listPriceRub: number | null;
  source: DealSource;
  bookings: number;
  redeemed: number;
  reserved: number;
  revenueRub: number;
  writtenOff: number | null;
}

export interface Closeout {
  dealId: number;
  venueId: number;
  writtenOff: number;
  closedBy: number | null;
  channel: CloseoutChannel;
  closedAt: Date;
  updatedAt: Date;
}

export interface CloseoutInput {
  dealId: number;
  venueId: number;
  writtenOff: number;
  closedBy: number;
  channel: CloseoutChannel;
}

interface FactsRow {
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
  item_name: string;
  list_price_rub: number | null;
  source: DealSource;
  bookings: number;
  redeemed: number;
  reserved: number;
  revenue_rub: number;
  written_off: number | null;
}

interface CloseoutRow {
  deal_id: number;
  venue_id: number;
  written_off: number;
  closed_by: number | null;
  channel: CloseoutChannel;
  closed_at: Date;
  updated_at: Date;
}

const CLOSEOUT_COLUMNS = 'deal_id, venue_id, written_off, closed_by, channel, closed_at, updated_at';

function mapCloseout(row: CloseoutRow): Closeout {
  return {
    dealId: row.deal_id,
    venueId: row.venue_id,
    writtenOff: row.written_off,
    closedBy: row.closed_by,
    channel: row.channel,
    closedAt: row.closed_at,
    updatedAt: row.updated_at,
  };
}

export async function listDealFacts(
  db: Queryable,
  scope: { venueId: number | null; onlyOpen: boolean },
  from: Date,
  to: Date,
  dealId: number | null = null,
): Promise<DealReportRow[]> {
  const { rows } = await db.query<FactsRow>(
    `select d.id, d.venue_id, d.menu_item_id, d.price_rub, d.quantity_total, d.quantity_left, d.starts_at,
            d.ends_at, d.cancelled_at, d.created_at, m.name as item_name, d.list_price_rub, d.source,
            count(b.id)::int as bookings,
            (count(b.id) filter (where b.status = 'redeemed'))::int as redeemed,
            (count(b.id) filter (where b.status = 'active'))::int as reserved,
            coalesce(sum(b.price_rub) filter (where b.status = 'redeemed'), 0)::int as revenue_rub,
            c.written_off
       from deals d
       join venues v on v.id = d.venue_id
       join menu_items m on m.venue_id = d.venue_id and m.id = d.menu_item_id
       left join bookings b on b.venue_id = d.venue_id and b.deal_id = d.id
                            and (b.user_id is null or b.user_id > 0 or v.is_demo)
       left join deal_closeouts c on c.deal_id = d.id
      where ($1::bigint is null and v.blocked_at is null and not v.is_demo or d.venue_id = $1)
        and d.starts_at >= $2 and d.starts_at < $3
        and (not $4::boolean or c.deal_id is null)
        and ($5::bigint is null or d.id = $5)
      group by d.id, m.name, c.deal_id
      order by d.starts_at, d.id`,
    [scope.venueId, from, to, scope.onlyOpen, dealId],
  );
  return rows.map((row) => ({
    deal: {
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
    },
    itemName: row.item_name,
    listPriceRub: row.list_price_rub,
    source: row.source,
    bookings: row.bookings,
    redeemed: row.redeemed,
    reserved: row.reserved,
    revenueRub: row.revenue_rub,
    writtenOff: row.written_off,
  }));
}

export const FIRST_REDEEMS = `select b.venue_id, b.user_id, min(b.resolved_at) as first_at
    from bookings b
   where b.status = 'redeemed' and b.user_id > 0
   group by b.venue_id, b.user_id`;

export async function countNewGuests(db: Queryable, venueId: number, from: Date, to: Date): Promise<number> {
  const found = await one<{ guests: number }>(
    db,
    `select count(*)::int as guests
       from (${FIRST_REDEEMS}) first_visits
      where first_visits.venue_id = $1 and first_visits.first_at >= $2 and first_visits.first_at < $3`,
    [venueId, from, to],
  );
  return found.guests;
}

export async function findCloseout(db: Queryable, dealId: number): Promise<Closeout | null> {
  const row = await maybeOne<CloseoutRow>(
    db,
    `select ${CLOSEOUT_COLUMNS} from deal_closeouts where deal_id = $1`,
    [dealId],
  );
  return row ? mapCloseout(row) : null;
}

export async function saveCloseout(db: Queryable, input: CloseoutInput, now: Date): Promise<Closeout> {
  const row = await one<CloseoutRow>(
    db,
    `insert into deal_closeouts (deal_id, venue_id, written_off, closed_by, channel, closed_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $6)
     on conflict (deal_id) do update
       set written_off = excluded.written_off, closed_by = excluded.closed_by,
           channel = excluded.channel, updated_at = excluded.updated_at
     returning ${CLOSEOUT_COLUMNS}`,
    [input.dealId, input.venueId, input.writtenOff, input.closedBy, input.channel, now],
  );
  return mapCloseout(row);
}

export async function claimRun(
  db: Queryable,
  venueId: number,
  kind: ReportRunKind,
  periodStart: string,
  now: Date,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into venue_report_runs (venue_id, kind, period_start, sent_at)
     values ($1, $2, $3::date, $4)
     on conflict do nothing`,
    [venueId, kind, periodStart, now],
  );
  return rowCount === 1;
}

export async function hasRun(
  db: Queryable,
  venueId: number,
  kind: ReportRunKind,
  periodStart: string,
): Promise<boolean> {
  const found = await maybeOne<{ found: boolean }>(
    db,
    'select true as found from venue_report_runs where venue_id = $1 and kind = $2 and period_start = $3::date',
    [venueId, kind, periodStart],
  );
  return found !== null;
}

export async function listReportVenueIds(db: Queryable): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    'select id from venues where blocked_at is null and not is_demo order by id',
  );
  return rows.map((row) => row.id);
}
