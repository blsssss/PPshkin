import type { Pool } from '../db/pool.ts';
import * as analytics from '../repositories/analytics.ts';
import type { Clock } from '../shared/clock.ts';
import { badRequest, type ErrorDetail } from '../shared/errors.ts';
import { addDays, dayRange, isLocalDate, localDate } from '../shared/time.ts';
import { requireOwnedVenue } from './venues.ts';

export const DEFAULT_ANALYTICS_DAYS = 7;
export const MAX_ANALYTICS_DAYS = 92;
export const TOP_ITEMS_LIMIT = 5;

export interface AnalyticsPeriod {
  from?: string;
  to?: string;
}

export type TopItem = analytics.ItemSales;

export type AnalyticsDay = Pick<
  analytics.DayActivity,
  'date' | 'offersShown' | 'offersAccepted' | 'bookingsCreated' | 'bookingsRedeemed' | 'revenueRub'
>;

export interface VenueAnalytics {
  from: string;
  to: string;
  timezone: string;
  offersShown: number;
  offersAccepted: number;
  bookingsCreated: number;
  bookingsRedeemed: number;
  bookingsExpired: number;
  bookingsCancelled: number;
  acceptRate: number;
  redeemRate: number;
  revenueRub: number;
  surplusUnitsSold: number;
  surplusRevenueRub: number;
  topItems: TopItem[];
  byDay: AnalyticsDay[];
}

export interface AnalyticsService {
  get(ownerId: number, period: AnalyticsPeriod): Promise<VenueAnalytics>;
}

interface AnalyticsDependencies {
  pool: Pool;
  clock: Clock;
}

type Totals = Omit<analytics.DayActivity, 'date'>;

const DAY_MS = 86_400_000;
const collator = new Intl.Collator('ru');

const EMPTY_TOTALS: Totals = {
  offersShown: 0,
  offersAccepted: 0,
  bookingsCreated: 0,
  bookingsRedeemed: 0,
  bookingsExpired: 0,
  bookingsCancelled: 0,
  revenueRub: 0,
  surplusUnitsSold: 0,
  surplusRevenueRub: 0,
};

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100) / 100;
}

interface ResolvedPeriod {
  from: string;
  to: string;
  days: number;
}

function assertDates(period: AnalyticsPeriod): void {
  const problems: ErrorDetail[] = (['from', 'to'] as const)
    .filter((field) => {
      const value = period[field];
      return value !== undefined && !isLocalDate(value);
    })
    .map((field) => ({ path: field, message: 'must be a calendar date in YYYY-MM-DD format' }));
  if (problems.length > 0) throw badRequest('validation_failed', 'Request validation failed', problems);
}

function resolvePeriod(period: AnalyticsPeriod, today: string): ResolvedPeriod {
  const to = period.to ?? today;
  const from = period.from ?? addDays(to, 1 - DEFAULT_ANALYTICS_DAYS);
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
  if (days < 1 || days > MAX_ANALYTICS_DAYS) {
    throw badRequest(
      'invalid_period',
      `from must not be later than to, and the period must be at most ${MAX_ANALYTICS_DAYS} days`,
    );
  }
  return { from, to, days };
}

function byBestSelling(left: TopItem, right: TopItem): number {
  return (
    right.redeemed - left.redeemed ||
    right.revenueRub - left.revenueRub ||
    collator.compare(left.name, right.name) ||
    left.menuItemId - right.menuItemId
  );
}

function sumDays(days: readonly analytics.DayActivity[]): Totals {
  return days.reduce<Totals>(
    (totals, day) => ({
      offersShown: totals.offersShown + day.offersShown,
      offersAccepted: totals.offersAccepted + day.offersAccepted,
      bookingsCreated: totals.bookingsCreated + day.bookingsCreated,
      bookingsRedeemed: totals.bookingsRedeemed + day.bookingsRedeemed,
      bookingsExpired: totals.bookingsExpired + day.bookingsExpired,
      bookingsCancelled: totals.bookingsCancelled + day.bookingsCancelled,
      revenueRub: totals.revenueRub + day.revenueRub,
      surplusUnitsSold: totals.surplusUnitsSold + day.surplusUnitsSold,
      surplusRevenueRub: totals.surplusRevenueRub + day.surplusRevenueRub,
    }),
    EMPTY_TOTALS,
  );
}

export function createAnalyticsService({ pool, clock }: AnalyticsDependencies): AnalyticsService {
  return {
    async get(ownerId, period) {
      assertDates(period);
      const venue = await requireOwnedVenue(pool, ownerId);
      const { from, to, days } = resolvePeriod(period, localDate(clock.now(), venue.timezone));
      const windows = Array.from({ length: days }, (_, index) => {
        const date = addDays(from, index);
        return { date, ...dayRange(date, venue.timezone) };
      });
      const start = dayRange(from, venue.timezone).from;
      const end = dayRange(to, venue.timezone).to;
      const [activity, items] = await Promise.all([
        analytics.dailyActivity(pool, venue.id, windows),
        analytics.redeemedItems(pool, venue.id, start, end),
      ]);
      const totals = sumDays(activity);
      return {
        from,
        to,
        timezone: venue.timezone,
        ...totals,
        acceptRate: share(totals.offersAccepted, totals.offersShown),
        redeemRate: share(totals.bookingsRedeemed, totals.bookingsCreated),
        topItems: items.sort(byBestSelling).slice(0, TOP_ITEMS_LIMIT),
        byDay: activity.map((day) => ({
          date: day.date,
          offersShown: day.offersShown,
          offersAccepted: day.offersAccepted,
          bookingsCreated: day.bookingsCreated,
          bookingsRedeemed: day.bookingsRedeemed,
          revenueRub: day.revenueRub,
        })),
      };
    },
  };
}
