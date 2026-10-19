import { addDays, atLocalTime, localDate, localParts, minutesOfDay } from '../shared/time.ts';
import { dealOverAt } from './deals.ts';
import type { Permission } from './roles.ts';
import type { Booking, Deal, MenuImport, Venue } from './models.ts';

export const SETTINGS_KINDS = [
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
export type SettingsKind = (typeof SETTINGS_KINDS)[number];

const NOTIFICATION_KINDS = [
  ...SETTINGS_KINDS,
  'account_inactive_warning',
  'booking_venue_blocked',
  'venue_blocked',
  'venue_complaint',
  'complaint_created',
  'complaint_decided',
  'staff_joined',
  'staff_removed',
  'company_pending',
  'company_decided',
  'company_ownerless',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationStatus =
  'pending' | 'sending' | 'sent' | 'skipped' | 'unreachable' | 'failed' | 'expired';

export type NotificationResult = Exclude<NotificationStatus, 'pending' | 'sending'>;

type ReportPeriod = 'day' | 'week';

type GuestBookingKind = 'booking_confirmed' | 'booking_reminder' | 'booking_redeemed' | 'booking_expired';
type VenueBookingKind = 'venue_booking_created' | 'venue_booking_cancelled' | 'venue_booking_expired';
type VenueDealKind = 'venue_deal_sold_out' | 'venue_deal_ending';

export type NotificationEvent =
  | { kind: GuestBookingKind; booking: Booking; venue: Venue }
  | { kind: VenueBookingKind; booking: Booking; venue: Venue }
  | { kind: VenueDealKind; deal: Deal; venue: Venue }
  | { kind: 'menu_import_done'; menuImport: MenuImport; venue: Venue }
  | { kind: 'venue_report_ready'; venue: Venue; period: ReportPeriod; date: string }
  | { kind: 'account_inactive_warning'; user: { id: number; activeAt: Date } }
  | { kind: 'booking_venue_blocked'; booking: Booking; venue: Venue }
  | { kind: 'venue_blocked'; venue: Venue; blockedAt: Date }
  | { kind: 'venue_complaint'; complaintId: number; venue: Venue }
  | { kind: 'complaint_created'; complaintId: number; adminId: number }
  | { kind: 'complaint_decided'; complaintId: number; reporterId: number | null }
  | {
      kind: 'staff_joined';
      companyId: number;
      userId: number;
      venueId: number | null;
      inviterId: number | null;
    }
  | { kind: 'staff_removed'; companyId: number; userId: number; venueId: number | null }
  | { kind: 'company_pending'; companyId: number; adminId: number }
  | { kind: 'company_decided'; companyId: number; ownerId: number }
  | { kind: 'company_ownerless'; companyId: number; adminId: number };

export type NotificationSubject =
  | { bookingId: number }
  | { dealId: number }
  | { importId: number }
  | { venueId: number; period: ReportPeriod; date: string }
  | { venueId: number; blockedAt: string }
  | { complaintId: number }
  | { companyId: number; userId: number; venueId: number | null }
  | { companyId: number }
  | { userId: number };

type NotificationAudience =
  { kind: 'guest'; userId: number | null } | { kind: 'venue'; permission: Permission };

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
const INACTIVE_WARNING_TTL_MS = 14 * 24 * HOUR_MS;

const RETRY_DELAYS_MS = [MINUTE_MS, 5 * MINUTE_MS, 15 * MINUTE_MS] as const;
const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
export const SENDING_TIMEOUT_MS = 2 * MINUTE_MS;
export const DELIVERY_BATCH_SIZE = 100;

export const BOOKING_REMINDER_LEAD_MS = 10 * MINUTE_MS;
export const BOOKING_REMINDER_MIN_HOLD_MS = 20 * MINUTE_MS;
const DEAL_ENDING_LEAD_MS = 30 * MINUTE_MS;
export const DEAL_ENDING_MIN_AGE_MS = 30 * MINUTE_MS;

const VENUE_BOOKING_PERMISSION: Permission = 'booking.redeem';
const REPORT_PERMISSIONS: Record<ReportPeriod, Permission> = {
  day: 'deal.edit',
  week: 'analytics.view',
};

export function isSettingsKind(value: string): value is SettingsKind {
  return (SETTINGS_KINDS as readonly string[]).includes(value);
}

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
    case 'account_inactive_warning':
      return {
        subject: { userId: event.user.id },
        subjectKey: `${String(event.user.id)}:${event.user.activeAt.toISOString().slice(0, 10)}`,
        audience: { kind: 'guest', userId: event.user.id },
        expiresAt: after(now, INACTIVE_WARNING_TTL_MS),
      };
    case 'venue_report_ready':
      return {
        subject: { venueId: event.venue.id, period: event.period, date: event.date },
        subjectKey: `${String(event.venue.id)}:${event.period}:${event.date}`,
        audience: { kind: 'venue', permission: REPORT_PERMISSIONS[event.period] },
        expiresAt: after(now, MENU_AND_REPORT_TTL_MS),
      };
    case 'booking_venue_blocked':
      return {
        subject: { bookingId: event.booking.id },
        subjectKey: String(event.booking.id),
        audience: { kind: 'guest', userId: event.booking.userId },
        expiresAt: after(now, MENU_AND_REPORT_TTL_MS),
      };
    case 'venue_blocked':
      return {
        subject: { venueId: event.venue.id, blockedAt: event.blockedAt.toISOString() },
        subjectKey: `${String(event.venue.id)}:${event.blockedAt.toISOString()}`,
        audience: { kind: 'venue', permission: 'deal.edit' },
        expiresAt: after(now, MENU_AND_REPORT_TTL_MS),
      };
    case 'venue_complaint':
      return {
        subject: { complaintId: event.complaintId },
        subjectKey: String(event.complaintId),
        audience: { kind: 'venue', permission: VENUE_BOOKING_PERMISSION },
        expiresAt: after(now, MENU_AND_REPORT_TTL_MS),
      };
    case 'complaint_created':
      return {
        subject: { complaintId: event.complaintId },
        subjectKey: String(event.complaintId),
        audience: { kind: 'guest', userId: event.adminId },
        expiresAt: after(now, MENU_AND_REPORT_TTL_MS),
      };
    case 'complaint_decided':
      return {
        subject: { complaintId: event.complaintId },
        subjectKey: String(event.complaintId),
        audience: { kind: 'guest', userId: event.reporterId },
        expiresAt: after(now, MENU_AND_REPORT_TTL_MS),
      };
    case 'staff_joined':
      return {
        subject: { companyId: event.companyId, userId: event.userId, venueId: event.venueId },
        subjectKey: `${String(event.companyId)}:${String(event.userId)}:${now.toISOString()}`,
        audience: { kind: 'guest', userId: event.inviterId },
        expiresAt: after(now, MENU_AND_REPORT_TTL_MS),
      };
    case 'staff_removed':
      return {
        subject: { companyId: event.companyId, userId: event.userId, venueId: event.venueId },
        subjectKey: `${String(event.companyId)}:${String(event.userId)}:${now.toISOString()}`,
        audience: { kind: 'guest', userId: event.userId },
        expiresAt: after(now, MENU_AND_REPORT_TTL_MS),
      };
    case 'company_pending':
    case 'company_ownerless':
      return {
        subject: { companyId: event.companyId },
        subjectKey: `${String(event.companyId)}:${now.toISOString()}`,
        audience: { kind: 'guest', userId: event.adminId },
        expiresAt: after(now, MENU_AND_REPORT_TTL_MS),
      };
    case 'company_decided':
      return {
        subject: { companyId: event.companyId },
        subjectKey: `${String(event.companyId)}:${now.toISOString()}`,
        audience: { kind: 'guest', userId: event.ownerId },
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

export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 9;
export const QUIET_STEP_MINUTES = 30;
export const SETTINGS_KINDS_LIMIT = 20;

export interface QuietHours {
  from: string;
  until: string;
}

export interface NotificationPreferences {
  disabledKinds: readonly NotificationKind[];
  quietHours: QuietHours | null;
}

export type NotificationAudienceKind = 'guest' | 'venue';

export interface KindDescription {
  label: string;
  hint: string;
  audience: NotificationAudienceKind;
  editable: boolean;
  urgent: boolean;
}

function clock(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export const DEFAULT_QUIET_HOURS: QuietHours = {
  from: clock(QUIET_FROM_HOUR),
  until: clock(QUIET_UNTIL_HOUR),
};

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  disabledKinds: [],
  quietHours: DEFAULT_QUIET_HOURS,
};

export const NOTIFICATION_KIND_DESCRIPTIONS: Record<NotificationKind, KindDescription> = {
  booking_confirmed: {
    label: 'Бронь подтверждена',
    hint: 'Код и QR в чат, если бронировали в мини-приложении',
    audience: 'guest',
    editable: true,
    urgent: true,
  },
  booking_reminder: {
    label: 'Напоминание о брони',
    hint: 'За 10 минут до конца брони',
    audience: 'guest',
    editable: true,
    urgent: true,
  },
  booking_redeemed: {
    label: 'Бронь получена',
    hint: 'Что записано в дневник и сколько осталось на сегодня',
    audience: 'guest',
    editable: true,
    urgent: true,
  },
  booking_expired: {
    label: 'Бронь истекла',
    hint: 'Если не успели забрать',
    audience: 'guest',
    editable: true,
    urgent: true,
  },
  venue_booking_created: {
    label: 'Новая бронь',
    hint: 'Код, позиция и срок',
    audience: 'venue',
    editable: true,
    urgent: true,
  },
  venue_booking_cancelled: {
    label: 'Гость отменил бронь',
    hint: 'Порция возвращается в продажу',
    audience: 'venue',
    editable: true,
    urgent: true,
  },
  venue_booking_expired: {
    label: 'Гость не пришёл',
    hint: 'Бронь истекла, порция вернулась в продажу',
    audience: 'venue',
    editable: true,
    urgent: true,
  },
  venue_deal_sold_out: {
    label: 'Позиция забронирована целиком',
    hint: 'Все порции горящей позиции забронированы',
    audience: 'venue',
    editable: true,
    urgent: true,
  },
  venue_deal_ending: {
    label: 'Горящая позиция скоро закончится',
    hint: 'За 30 минут, если остались порции',
    audience: 'venue',
    editable: true,
    urgent: true,
  },
  venue_report_ready: {
    label: 'Итоги дня и недели',
    hint: 'Закрытие дня и отчёт за неделю',
    audience: 'venue',
    editable: true,
    urgent: false,
  },
  menu_import_done: {
    label: 'Разбор меню',
    hint: 'Приходит всегда после загрузки меню',
    audience: 'venue',
    editable: false,
    urgent: true,
  },
  account_inactive_warning: {
    label: 'Аккаунт скоро удалится',
    hint: 'За 14 дней до удаления давно неактивного аккаунта',
    audience: 'guest',
    editable: false,
    urgent: false,
  },
  booking_venue_blocked: {
    label: 'Бронь отменена',
    hint: 'Заведение приостановлено администратором',
    audience: 'guest',
    editable: false,
    urgent: true,
  },
  venue_blocked: {
    label: 'Заведение приостановлено',
    hint: 'Причина приостановки',
    audience: 'venue',
    editable: false,
    urgent: true,
  },
  venue_complaint: {
    label: 'Жалоба гостя',
    hint: 'Причина, код брони и время',
    audience: 'venue',
    editable: false,
    urgent: false,
  },
  complaint_created: {
    label: 'Новая жалоба',
    hint: 'Только для администраторов',
    audience: 'guest',
    editable: false,
    urgent: true,
  },
  complaint_decided: {
    label: 'Итог по жалобе',
    hint: 'Решение администратора',
    audience: 'guest',
    editable: false,
    urgent: false,
  },
  staff_joined: {
    label: 'Новый сотрудник',
    hint: 'Приглашённый сотрудник принял приглашение',
    audience: 'venue',
    editable: false,
    urgent: true,
  },
  staff_removed: {
    label: 'Доступ закрыт',
    hint: 'Вас исключили из компании',
    audience: 'venue',
    editable: false,
    urgent: true,
  },
  company_pending: {
    label: 'Компания на проверку',
    hint: 'Только для администраторов',
    audience: 'guest',
    editable: false,
    urgent: true,
  },
  company_decided: {
    label: 'Итог проверки компании',
    hint: 'Компания проверена или отклонена',
    audience: 'venue',
    editable: false,
    urgent: true,
  },
  company_ownerless: {
    label: 'Компания без владельца',
    hint: 'Только для администраторов',
    audience: 'guest',
    editable: false,
    urgent: true,
  },
};

export function settingsKinds(hasVenue: boolean): SettingsKind[] {
  return SETTINGS_KINDS.filter(
    (kind) => hasVenue || NOTIFICATION_KIND_DESCRIPTIONS[kind].audience === 'guest',
  );
}

export function isQuietClock(value: string): boolean {
  const minutes = minutesOfDay(value);
  return minutes !== null && minutes % QUIET_STEP_MINUTES === 0;
}

export function isQuietAt(quietHours: QuietHours | null, now: Date, timeZone: string): boolean {
  if (quietHours === null) return false;
  const from = minutesOfDay(quietHours.from);
  const until = minutesOfDay(quietHours.until);
  if (from === null || until === null || from === until) return false;
  const { hour, minute } = localParts(now, timeZone);
  const current = hour * 60 + minute;
  return from < until ? current >= from && current < until : current >= from || current < until;
}

export function quietHoursEndAt(quietHours: QuietHours, now: Date, timeZone: string): Date {
  const until = minutesOfDay(quietHours.until) ?? 0;
  const today = localDate(now, timeZone);
  const sameDay = atLocalTime(today, until, timeZone);
  return sameDay > now ? sameDay : atLocalTime(addDays(today, 1), until, timeZone);
}

export function isKindEnabled(kind: NotificationKind, preferences: NotificationPreferences): boolean {
  return !NOTIFICATION_KIND_DESCRIPTIONS[kind].editable || !preferences.disabledKinds.includes(kind);
}

export type DeliveryPlan = { queue: false } | { queue: true; silent: boolean; sendAfter: Date };

export function planDelivery(
  kind: NotificationKind,
  preferences: NotificationPreferences,
  context: { now: Date; timeZone: string; expiresAt: Date },
): DeliveryPlan {
  if (!isKindEnabled(kind, preferences)) return { queue: false };
  const { now, timeZone, expiresAt } = context;
  if (preferences.quietHours === null || !isQuietAt(preferences.quietHours, now, timeZone)) {
    return { queue: true, silent: false, sendAfter: now };
  }
  if (NOTIFICATION_KIND_DESCRIPTIONS[kind].urgent) return { queue: true, silent: true, sendAfter: now };
  const end = quietHoursEndAt(preferences.quietHours, now, timeZone);
  return { queue: true, silent: false, sendAfter: end < expiresAt ? end : expiresAt };
}
