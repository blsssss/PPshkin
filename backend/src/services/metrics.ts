import type { Queryable } from '../db/pool.ts';
import { ratio } from '../domain/pilot-metrics.ts';
import * as pilot from '../repositories/pilot-metrics.ts';
import type { Clock } from '../shared/clock.ts';
import { addDays, localDate } from '../shared/time.ts';

export interface DomainSnapshot {
  users: number;
  mealsLastDay: number;
  activeDeals: number;
  bookings: Record<string, number>;
  offers: Record<string, number>;
  notifications: { pending: number; oldestDueSeconds: number };
  pilot: { newGuests7d: number; redeemRate7d: number; retentionD7LastCohort: number };
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

const PILOT_TIME_ZONE = 'Europe/Moscow';

async function pilotSnapshot(db: Queryable, now: Date): Promise<DomainSnapshot['pilot']> {
  const today = localDate(now, PILOT_TIME_ZONE);
  const week = { from: addDays(today, -6), to: today, venueId: null };
  const [guests, outcomes, cohorts] = await Promise.all([
    pilot.guestCounts(db, week),
    pilot.bookingOutcomes(db, week),
    pilot.retentionD7(db, { from: addDays(today, -13), to: addDays(today, -7) }, now),
  ]);
  const total = <T>(values: Iterable<T>, pick: (value: T) => number) =>
    [...values].reduce((sum, value) => sum + pick(value), 0);
  return {
    newGuests7d: total(guests.values(), (venue) => venue.newGuests),
    redeemRate7d:
      ratio(
        total(outcomes.values(), (venue) => venue.redeemed),
        total(outcomes.values(), (venue) => venue.created),
      ).value ?? 0,
    retentionD7LastCohort:
      ratio(
        total(cohorts, (cohort) => cohort.retained),
        total(cohorts, (cohort) => cohort.cohort),
      ).value ?? 0,
  };
}

export function createMetricsService(db: Queryable, clock: Clock): MetricsService {
  return {
    async snapshot() {
      const now = clock.now();
      const totals = await db.query<{ users: number; meals_last_day: number; active_deals: number }>(
        `select
           (select count(*)::int from users where id > 0) as users,
           (select count(*)::int from meals where created_at > $1::timestamptz - interval '1 day') as meals_last_day,
           (select count(*)::int from deals
             where cancelled_at is null and quantity_left > 0 and starts_at <= $1::timestamptz and ends_at > $1::timestamptz) as active_deals`,
        [now],
      );
      const queue = await db.query<{ pending: number; oldest_due_seconds: number }>(
        `select count(*)::int as pending,
                coalesce(extract(epoch from $1::timestamptz - min(send_after) filter (where send_after <= $1::timestamptz)), 0)::float8
                  as oldest_due_seconds
           from notifications where status = 'pending'`,
        [now],
      );
      const row = totals.rows[0];
      return {
        users: row?.users ?? 0,
        mealsLastDay: row?.meals_last_day ?? 0,
        activeDeals: row?.active_deals ?? 0,
        bookings: await countByStatus(db, 'bookings'),
        offers: await countByStatus(db, 'offers'),
        notifications: {
          pending: queue.rows[0]?.pending ?? 0,
          oldestDueSeconds: queue.rows[0]?.oldest_due_seconds ?? 0,
        },
        pilot: await pilotSnapshot(db, now),
      };
    },
  };
}
