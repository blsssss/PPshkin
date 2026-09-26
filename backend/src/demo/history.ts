import { BOOKING_HOLD_MINUTES } from '../domain/bookings.ts';
import type { BookingStatus, OfferChannel } from '../domain/vocabulary.ts';
import { daysSinceEpoch } from '../shared/time.ts';
import type { DealTemplate } from './dataset.ts';
import type { DealWindow, DealWindowName, OpeningPeriod } from './windows.ts';

export interface HistoryDayCounts {
  shows: number;
  redeemedWithDeal: number;
  redeemedWithoutDeal: number;
  expired: number;
  cancelled: number;
}

export const ANALYTICS_HISTORY: readonly HistoryDayCounts[] = [
  { shows: 8, redeemedWithDeal: 1, redeemedWithoutDeal: 1, expired: 1, cancelled: 0 },
  { shows: 6, redeemedWithDeal: 1, redeemedWithoutDeal: 0, expired: 0, cancelled: 1 },
  { shows: 9, redeemedWithDeal: 2, redeemedWithoutDeal: 1, expired: 0, cancelled: 0 },
  { shows: 7, redeemedWithDeal: 1, redeemedWithoutDeal: 1, expired: 1, cancelled: 0 },
  { shows: 10, redeemedWithDeal: 2, redeemedWithoutDeal: 1, expired: 0, cancelled: 1 },
  { shows: 8, redeemedWithDeal: 2, redeemedWithoutDeal: 0, expired: 1, cancelled: 0 },
  { shows: 9, redeemedWithDeal: 2, redeemedWithoutDeal: 1, expired: 0, cancelled: 0 },
];

export interface HistorySlot {
  counts: HistoryDayCounts;
  dayIndex: number;
}

export type HistoryBookingStatus = Exclude<BookingStatus, 'active'>;

export interface HistoryBooking {
  status: HistoryBookingStatus;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt: Date;
}

export interface HistoryOffer {
  menuItemId: number;
  deal: DealWindowName | null;
  channel: Extract<OfferChannel, 'bot' | 'miniapp'>;
  score: number;
  createdAt: Date;
  booking: HistoryBooking | null;
}

export interface HistoryDayInput extends HistorySlot {
  menuItemIds: readonly number[];
  templates: readonly DealTemplate[];
  windows: readonly DealWindow[];
  opening: OpeningPeriod;
}

interface PlannedBooking {
  menuItemId: number;
  deal: DealWindowName | null;
  status: HistoryBookingStatus;
  createdAt: Date;
}

const MINUTE_MS = 60_000;
const OFFER_BEFORE_BOOKING_MS = 3 * MINUTE_MS;
const RESOLVED_AFTER_MS: Record<Exclude<HistoryBookingStatus, 'expired'>, number> = {
  redeemed: 15 * MINUTE_MS,
  cancelled: 20 * MINUTE_MS,
};
const BOOKING_HOLD_MS = BOOKING_HOLD_MINUTES * MINUTE_MS;
const DEAL_BOOKING_OFFSET_MS = 40 * MINUTE_MS;
const DEAL_BOOKING_DAILY_SHIFT_MS = 5 * MINUTE_MS;
const DEAL_BOOKING_REPEAT_MS = 20 * MINUTE_MS;
const OPENING_DAILY_SHIFT = 0.005;
const BASE_SCORE = 0.55;
const SCORE_STEP = 0.08;
const SCORE_LEVELS = 5;

const repeat = <T>(count: number, make: (index: number) => T): T[] =>
  Array.from({ length: count }, (_, index) => make(index));

function pick<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length];
  if (item === undefined) throw new RangeError('Cannot pick from an empty list');
  return item;
}

export function historySlot(date: string): HistorySlot {
  const dayIndex = daysSinceEpoch(date) % ANALYTICS_HISTORY.length;
  return { counts: pick(ANALYTICS_HISTORY, dayIndex), dayIndex };
}

function during(period: OpeningPeriod, share: number): Date {
  const span = period.to.getTime() - period.from.getTime();
  return new Date(period.from.getTime() + Math.round(span * share));
}

function toHistoryBooking({ status, createdAt }: PlannedBooking): HistoryBooking {
  const expiresAt = new Date(createdAt.getTime() + BOOKING_HOLD_MS);
  const resolvedAt =
    status === 'expired' ? expiresAt : new Date(createdAt.getTime() + RESOLVED_AFTER_MS[status]);
  return { status, createdAt, expiresAt, resolvedAt };
}

export function planHistoryDay(input: HistoryDayInput): HistoryOffer[] {
  const { counts, dayIndex, menuItemIds, templates, windows, opening } = input;
  const windowOf = new Map(windows.map((window) => [window.name, window]));
  const dealTemplates = templates.filter((template) => windowOf.has(template.window));
  const dealItemIds = new Set(templates.map((template) => template.menuItemId));
  const regularItemIds = menuItemIds.filter((id) => !dealItemIds.has(id));
  const dayShift = dayIndex * OPENING_DAILY_SHIFT;

  const dealStatuses: HistoryBookingStatus[] = [
    ...repeat(counts.redeemedWithDeal, () => 'redeemed' as const),
    ...repeat(counts.expired, () => 'expired' as const),
  ];
  const regularStatuses: HistoryBookingStatus[] = [
    ...repeat(counts.redeemedWithoutDeal, () => 'redeemed' as const),
    ...repeat(counts.cancelled, () => 'cancelled' as const),
  ];
  const withDeal = dealTemplates.length === 0 ? [] : dealStatuses;
  const withoutDeal = dealTemplates.length === 0 ? [...dealStatuses, ...regularStatuses] : regularStatuses;

  const bookings: PlannedBooking[] = [
    ...withDeal.map((status, index) => {
      const template = pick(dealTemplates, dayIndex + index);
      const window = windowOf.get(template.window);
      if (!window) throw new Error(`No ${template.window} window for a deal template`);
      const span = window.endsAt.getTime() - window.startsAt.getTime();
      const repeated = Math.floor(index / dealTemplates.length) * DEAL_BOOKING_REPEAT_MS;
      const offset = Math.min(
        span / 2,
        DEAL_BOOKING_OFFSET_MS + dayIndex * DEAL_BOOKING_DAILY_SHIFT_MS + repeated,
      );
      return {
        menuItemId: template.menuItemId,
        deal: template.window,
        status,
        createdAt: new Date(window.startsAt.getTime() + offset),
      };
    }),
    ...withoutDeal.map((status, index) => ({
      menuItemId: pick(regularItemIds.length > 0 ? regularItemIds : menuItemIds, dayIndex * 2 + index),
      deal: null,
      status,
      createdAt: during(opening, (index + 1) / (withoutDeal.length + 1) + dayShift),
    })),
  ];

  const shownCount = Math.max(0, counts.shows - bookings.length);
  const shown = repeat(shownCount, (index) => {
    const createdAt = during(opening, (index + 0.5) / shownCount + dayShift);
    const menuItemId = pick(menuItemIds, dayIndex * 3 + index);
    const template = templates.find((candidate) => {
      const window = windowOf.get(candidate.window);
      return (
        candidate.menuItemId === menuItemId &&
        window !== undefined &&
        createdAt >= window.startsAt &&
        createdAt < window.endsAt
      );
    });
    return { menuItemId, deal: template?.window ?? null, createdAt, booking: null };
  });

  const accepted = bookings.map((booking) => ({
    menuItemId: booking.menuItemId,
    deal: booking.deal,
    createdAt: new Date(booking.createdAt.getTime() - OFFER_BEFORE_BOOKING_MS),
    booking: toHistoryBooking(booking),
  }));

  return [...accepted, ...shown]
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .map((offer, index) => ({
      ...offer,
      channel: (dayIndex + index) % 2 === 0 ? 'bot' : 'miniapp',
      score: Math.round((BASE_SCORE + ((dayIndex + index) % SCORE_LEVELS) * SCORE_STEP) * 100) / 100,
    }));
}
