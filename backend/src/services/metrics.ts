import type { Queryable } from '../db/pool.ts';

export interface DomainSnapshot {
  users: number;
  mealsLastDay: number;
  activeDeals: number;
  bookings: Record<string, number>;
  offers: Record<string, number>;
}

export interface MetricsService {
  snapshot(): Promise<DomainSnapshot>;
}

async function countByStatus(db: Queryable, table: 'bookings' | 'offers'): Promise<Record<string, number>> {
  const result = await db.query<{ status: string; total: number }>(
    `select status, count(*)::int as total from ${table} group by status`,
  );
  return Object.fromEntries(result.rows.map((row) => [row.status, row.total]));
}

export function createMetricsService(db: Queryable): MetricsService {
  return {
    async snapshot() {
      const totals = await db.query<{ users: number; meals_last_day: number; active_deals: number }>(
        `select
           (select count(*)::int from users where id > 0) as users,
           (select count(*)::int from meals where created_at > now() - interval '1 day') as meals_last_day,
           (select count(*)::int from deals
             where cancelled_at is null and quantity_left > 0 and starts_at <= now() and ends_at > now()) as active_deals`,
      );
      const row = totals.rows[0];
      return {
        users: row?.users ?? 0,
        mealsLastDay: row?.meals_last_day ?? 0,
        activeDeals: row?.active_deals ?? 0,
        bookings: await countByStatus(db, 'bookings'),
        offers: await countByStatus(db, 'offers'),
      };
    },
  };
}
