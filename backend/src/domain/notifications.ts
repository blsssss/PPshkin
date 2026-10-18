import { dealOverAt } from './deals.ts';
import type { Booking, Deal, MenuImport, Venue } from './models.ts';

const NOTIFICATION_KINDS = [
  'booking_confirmed',
  'booking_reminder',
  'booking_redeemed',
  'booking_expired',
  'venue_booking_created',
  'venue_booking_cancelled',
  'venue_booking_expired',
  'venue_deal_sold_out',
  'venue_deal_ending',
  'menu_import_done',
  'venue_report_ready',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationStatus =
  'pending' | 'sending' | 'sent' | 'skipped' | 'unreachable' | 'failed' | 'expired';

export type NotificationResult = Exclude<NotificationStatus, 'pending' | 'sending'>;

type ReportPeriod = 'day' | 'week';

export type VenuePermission = 'booking.redeem' | 'deal.edit' | 'menu.edit' | 'analytics.view';

type GuestBookingKind = 'booking_confirmed' | 'booking_reminder' | 'booking_redeemed' | 'booking_expired';
type VenueBookingKind = 'venue_booking_created' | 'venue_booking_cancelled' | 'venue_booking_expired';
type VenueDealKind = 'venue_deal_sold_out' | 'venue_deal_ending';

export type NotificationEvent =
  | { kind: GuestBookingKind; booking: Booking; venue: Venue }
  | { kind: VenueBookingKind; booking: Booking; venue: Venue }
  | { kind: VenueDealKind; deal: Deal; venue: Venue }
  | { kind: 'menu_import_done'; menuImport: MenuImport; venue: Venue }
  | { kind: 'venue_report_ready'; venue: Venue; period: ReportPeriod; date: string };

export type NotificationSubject =
  | { bookingId: number }
  | { dealId: number }
  | { importId: number }
  | { venueId: number; period: ReportPeriod; date: string };

type NotificationAudience =
  { kind: 'guest'; userId: number | null } | { kind: 'venue'; permission: VenuePermission };

interface NotificationTarget {
  subject: NotificationSubject;
  subjectKey: string;
  audience: NotificationAudience;
  expiresAt: Date;
}

export const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const BOOKING_EVENT_TTL_MS = 2 * HOUR_MS;
const MENU_AND_REPORT_TTL_MS = 24 * HOUR_MS;

const RETRY_DELAYS_MS = [MINUTE_MS, 5 * MINUTE_MS, 15 * MINUTE_MS] as const;
const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
export const SENDING_TIMEOUT_MS = 2 * MINUTE_MS;
export const DELIVERY_BATCH_SIZE = 100;
export const NOTIFICATION_RETENTION_MS = 30 * 24 * HOUR_MS;

export const BOOKING_REMINDER_LEAD_MS = 10 * MINUTE_MS;
export const BOOKING_REMINDER_MIN_HOLD_MS = 20 * MINUTE_MS;
const DEAL_ENDING_LEAD_MS = 30 * MINUTE_MS;
export const DEAL_ENDING_MIN_AGE_MS = 30 * MINUTE_MS;

const VENUE_BOOKING_PERMISSION: VenuePermission = 'booking.redeem';
const REPORT_PERMISSIONS: Record<ReportPeriod, VenuePermission> = {
  day: 'deal.edit',
  week: 'analytics.view',
};

export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

function after(now: Date, ms: number): Date {
  return new Date(now.getTime() + ms);
}

export function notificationTarget(event: NotificationEvent, now: Date): NotificationTarget {
  switch (event.kind) {
    case 'booking_confirmed':
    case 'booking_reminder':
      return {
        subject: { bookingId: event.booking.id },
        subjectKey: String(event.booking.id),
        audience: { kind: 'guest', userId: event.booking.userId },
        expiresAt: event.booking.expiresAt,
      };
    case 'booking_redeemed':
    case 'booking_expired':
      return {
        subject: { bookingId: event.booking.id },
        subjectKey: String(event.booking.id),
        audience: { kind: 'guest', userId: event.booking.userId },
        expiresAt: after(now, BOOKING_EVENT_TTL_MS),
      };
    case 'venue_booking_created':
    case 'venue_booking_cancelled':
    case 'venue_booking_expired':
      return {
        subject: { bookingId: event.booking.id },
        subjectKey: String(event.booking.id),
        audience: { kind: 'venue', permission: VENUE_BOOKING_PERMISSION },
        expiresAt: after(now, BOOKING_EVENT_TTL_MS),
      };
    case 'venue_deal_sold_out':
    case 'venue_deal_ending':
      return {
        subject: { dealId: event.deal.id },
        subjectKey: String(event.deal.id),
        audience: { kind: 'venue', permission: 'deal.edit' },
        expiresAt: dealOverAt(event.deal, event.venue),
      };
    case 'menu_import_done':
      return {
        subject: { importId: event.menuImport.id },
        subjectKey: String(event.menuImport.id),
        audience: { kind: 'venue', permission: 'menu.edit' },
        expiresAt: after(now, MENU_AND_REPORT_TTL_MS),
      };
    case 'venue_report_ready':
      return {
        subject: { venueId: event.venue.id, period: event.period, date: event.date },
        subjectKey: `${String(event.venue.id)}:${event.period}:${event.date}`,
        audience: { kind: 'venue', permission: REPORT_PERMISSIONS[event.period] },
        expiresAt: after(now, MENU_AND_REPORT_TTL_MS),
      };
  }
}

export function dedupKey(kind: NotificationKind, subjectKey: string, userId: number): string {
  return `${kind}:${subjectKey}:${String(userId)}`;
}

export function isNotifiableUser(userId: number | null): userId is number {
  return userId !== null && userId > 0;
}

export function retryAt(attempts: number, now: Date): Date | null {
  const delay = RETRY_DELAYS_MS[attempts - 1];
  return attempts >= MAX_DELIVERY_ATTEMPTS || delay === undefined ? null : after(now, delay);
}

export function minutesLeft(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / MINUTE_MS));
}

export function isLiveDeal(deal: Deal, venue: Venue, now: Date): boolean {
  return (
    deal.cancelledAt === null &&
    deal.quantityLeft > 0 &&
    deal.startsAt <= now &&
    dealOverAt(deal, venue) > now
  );
}

export function needsDealEndingReminder(deal: Deal, venue: Venue, now: Date): boolean {
  const left = dealOverAt(deal, venue).getTime() - now.getTime();
  return (
    isLiveDeal(deal, venue, now) &&
    now.getTime() - deal.startsAt.getTime() >= DEAL_ENDING_MIN_AGE_MS &&
    left <= DEAL_ENDING_LEAD_MS
  );
}

export function dealRestockedOn(deal: Deal, venue: Venue, releasedAt: Date): boolean {
  const cancelledBefore = deal.cancelledAt !== null && deal.cancelledAt <= releasedAt;
  return !cancelledBefore && dealOverAt(deal, venue) > releasedAt;
}
