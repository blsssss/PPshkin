import type { Queryable } from '../db/pool.ts';

export interface DayWindow {
  date: string;
  from: Date;
  to: Date;
}

export interface DayActivity {
  date: string;
  offersShown: number;
  offersAccepted: number;
  bookingsCreated: number;
  bookingsRedeemed: number;
  bookingsExpired: number;
  bookingsCancelled: number;
  revenueRub: number;
  surplusUnitsSold: number;
  surplusRevenueRub: number;
}

export interface ItemSales {
  menuItemId: number;
  name: string;
  redeemed: number;
  revenueRub: number;
}

interface DayActivityRow {
  day: string;
  offers_shown: number;
  offers_accepted: number;
  bookings_created: number;
  bookings_redeemed: number;
  bookings_expired: number;
  bookings_cancelled: number;
  revenue_rub: number;
  surplus_units_sold: number;
  surplus_revenue_rub: number;
}

interface ItemSalesRow {
  menu_item_id: number;
  name: string;
  redeemed: number;
  revenue_rub: number;
}

export async function dailyActivity(
  db: Queryable,
  venueId: number,
  days: readonly DayWindow[],
): Promise<DayActivity[]> {
  if (days.length === 0) return [];
  const { rows } = await db.query<DayActivityRow>(
    `with days as (
       select d.day, d.starts_at, d.ends_at, d.day_index
         from unnest($2::text[], $3::timestamptz[], $4::timestamptz[])
              with ordinality as d (day, starts_at, ends_at, day_index)
     ), offer_days as (
       select d.day_index,
              count(o.id) as offers_shown,
              count(o.id) filter (where o.status = 'accepted') as offers_accepted
         from days d
         left join offers o on o.venue_id = $1 and o.created_at >= d.starts_at and o.created_at < d.ends_at
        group by d.day_index
     ), booking_days as (
       select d.day_index,
              count(b.id) as bookings_created,
              count(b.id) filter (where b.status = 'redeemed') as bookings_redeemed,
              count(b.id) filter (where b.status = 'expired') as bookings_expired,
              count(b.id) filter (where b.status = 'cancelled') as bookings_cancelled,
              coalesce(sum(b.price_rub) filter (where b.status = 'redeemed'), 0) as revenue_rub,
              count(b.id) filter (where b.status = 'redeemed' and b.deal_id is not null) as surplus_units_sold,
              coalesce(sum(b.price_rub) filter (where b.status = 'redeemed' and b.deal_id is not null), 0)
                as surplus_revenue_rub
         from days d
         left join bookings b on b.venue_id = $1 and b.created_at >= d.starts_at and b.created_at < d.ends_at
        group by d.day_index
     )
     select d.day, o.offers_shown, o.offers_accepted, b.bookings_created, b.bookings_redeemed,
            b.bookings_expired, b.bookings_cancelled, b.revenue_rub, b.surplus_units_sold, b.surplus_revenue_rub
       from days d
       join offer_days o using (day_index)
       join booking_days b using (day_index)
      order by d.day_index`,
    [venueId, days.map((day) => day.date), days.map((day) => day.from), days.map((day) => day.to)],
  );
  return rows.map((row) => ({
    date: row.day,
    offersShown: row.offers_shown,
    offersAccepted: row.offers_accepted,
    bookingsCreated: row.bookings_created,
    bookingsRedeemed: row.bookings_redeemed,
    bookingsExpired: row.bookings_expired,
    bookingsCancelled: row.bookings_cancelled,
    revenueRub: row.revenue_rub,
    surplusUnitsSold: row.surplus_units_sold,
    surplusRevenueRub: row.surplus_revenue_rub,
  }));
}

export async function redeemedItems(
  db: Queryable,
  venueId: number,
  from: Date,
  to: Date,
): Promise<ItemSales[]> {
  const { rows } = await db.query<ItemSalesRow>(
    `select b.menu_item_id, m.name, count(*) as redeemed, sum(b.price_rub) as revenue_rub
       from bookings b
       join menu_items m on m.id = b.menu_item_id
      where b.venue_id = $1 and b.status = 'redeemed' and b.created_at >= $2 and b.created_at < $3
      group by b.menu_item_id, m.name
      order by b.menu_item_id`,
    [venueId, from, to],
  );
  return rows.map((row) => ({
    menuItemId: row.menu_item_id,
    name: row.name,
    redeemed: row.redeemed,
    revenueRub: row.revenue_rub,
  }));
}
