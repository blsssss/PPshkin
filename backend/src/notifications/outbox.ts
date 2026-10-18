import { importScreen } from '../bot/venue/menu.ts';
import type { Pool, Queryable } from '../db/pool.ts';
import type { Venue } from '../domain/models.ts';
import {
  DELIVERY_BATCH_SIZE,
  dealRestockedOn,
  dedupKey,
  isLiveDeal,
  isNotifiableUser,
  isKindEnabled,
  isNotificationKind,
  notificationTarget,
  planDelivery,
  retryAt,
  SENDING_TIMEOUT_MS,
  type NotificationEvent,
  type NotificationSubject,
  type VenuePermission,
} from '../domain/notifications.ts';
import { MaxApiError, UserUnreachableError } from '../integrations/max/errors.ts';
import type { MaxLogger } from '../integrations/max/poller.ts';
import type { Messenger, OutgoingMessage } from '../ports/messenger.ts';
import type { Notifications } from '../ports/notifier.ts';
import * as bookings from '../repositories/bookings.ts';
import * as deals from '../repositories/deals.ts';
import * as menuImports from '../repositories/menu-imports.ts';
import * as menuItems from '../repositories/menu-items.ts';
import * as settings from '../repositories/notification-settings.ts';
import * as notifications from '../repositories/notifications.ts';
import * as users from '../repositories/users.ts';
import * as venues from '../repositories/venues.ts';
import type { DiaryDay } from '../services/diary.ts';
import type { BackgroundTasks } from '../shared/background.ts';
import type { Clock } from '../shared/clock.ts';
import type { NotificationStats } from './stats.ts';
import {
  accountInactiveMessage,
  bookingCancelledMessage,
  bookingConfirmedMessage,
  bookingCreatedMessage,
  bookingExpiredMessage,
  bookingRedeemedMessage,
  bookingReminderMessage,
  dealEndingMessage,
  dealSoldOutMessage,
  venueBookingExpiredMessage,
  type BookingNotice,
  type DealNotice,
} from './texts.ts';

export interface LiveBot {
  messenger: Messenger;
  username: string;
}

export interface OutboxDependencies {
  pool: Pool;
  clock: Clock;
  bot: () => LiveBot | null;
  miniAppEnabled: boolean;
  diaryDay: (userId: number) => Promise<DiaryDay>;
  background: BackgroundTasks;
  logger: MaxLogger;
  stats?: NotificationStats;
}

export interface DeliveryReport {
  sent: number;
  skipped: number;
  unreachable: number;
  failed: number;
  expired: number;
  retried: number;
}

export interface Outbox extends Notifications {
  deliverDue(now: Date): Promise<DeliveryReport>;
}

type Composed = { message: OutgoingMessage } | { skip: string };

const SECOND_MS = 1000;

function skip(reason: string): Composed {
  return { skip: reason };
}

function send(message: OutgoingMessage): Composed {
  return { message };
}

function emptyReport(): DeliveryReport {
  return { sent: 0, skipped: 0, unreachable: 0, failed: 0, expired: 0, retried: 0 };
}

function venueRecipients(_db: Queryable, venue: Venue, _permission: VenuePermission): Promise<number[]> {
  return Promise.resolve(venue.ownerId === null ? [] : [venue.ownerId]);
}

function isPermanentRejection(error: unknown): boolean {
  return (
    error instanceof MaxApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 403 &&
    error.status !== 429
  );
}

function describe(error: unknown): string {
  if (error instanceof MaxApiError) return `${String(error.status)} ${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function idOf(subject: NotificationSubject, field: 'bookingId' | 'dealId' | 'importId'): number | null {
  const value = (subject as Partial<Record<typeof field, unknown>>)[field];
  return typeof value === 'number' ? value : null;
}

export function createOutbox({
  pool,
  clock,
  bot,
  miniAppEnabled,
  diaryDay,
  background,
  logger,
  stats,
}: OutboxDependencies): Outbox {
  async function findVenue(id: number): Promise<Venue | null> {
    const [venue] = await venues.findByIds(pool, [id]);
    return venue ?? null;
  }

  async function bookingNotice(subject: NotificationSubject): Promise<BookingNotice | null> {
    const id = idOf(subject, 'bookingId');
    const booking = id === null ? null : await bookings.findById(pool, id);
    const venue = booking ? await findVenue(booking.venueId) : null;
    return booking && venue ? { booking, venue } : null;
  }

  async function dealNotice(subject: NotificationSubject): Promise<DealNotice | null> {
    const id = idOf(subject, 'dealId');
    const deal = id === null ? null : await deals.findById(pool, id);
    if (!deal) return null;
    const [venue, [item]] = await Promise.all([
      findVenue(deal.venueId),
      menuItems.findByIds(pool, [deal.menuItemId]),
    ]);
    return venue && item ? { deal, venue, itemName: item.name } : null;
  }

  async function daySummary(userId: number | null): Promise<DiaryDay | null> {
    if (userId === null) return null;
    try {
      return await diaryDay(userId);
    } catch (error) {
      logger.warn({ err: error, userId }, 'day summary is unavailable, the redeem notice goes without it');
      return null;
    }
  }

  async function composeBooking(kind: string, subject: NotificationSubject, now: Date): Promise<Composed> {
    const notice = await bookingNotice(subject);
    if (!notice) return skip('booking is gone');
    const { booking, venue } = notice;
    const active = booking.status === 'active' && booking.expiresAt > now;
    switch (kind) {
      case 'booking_confirmed':
        return active ? send(bookingConfirmedMessage(notice)) : skip('booking is no longer active');
      case 'booking_reminder':
        return active ? send(bookingReminderMessage(notice, now)) : skip('booking is no longer active');
      case 'booking_redeemed':
        return send(bookingRedeemedMessage(notice, await daySummary(booking.userId)));
      case 'booking_expired':
        return send(bookingExpiredMessage(notice));
      case 'venue_booking_created':
        return send(bookingCreatedMessage(notice));
      case 'venue_booking_cancelled':
        return send(bookingCancelledMessage(notice));
      default: {
        const deal = booking.dealId === null ? null : await deals.findById(pool, booking.dealId);
        const returned =
          deal !== null && booking.resolvedAt !== null && dealRestockedOn(deal, venue, booking.resolvedAt);
        return send(venueBookingExpiredMessage(notice, returned));
      }
    }
  }

  async function composeDeal(kind: string, subject: NotificationSubject, now: Date): Promise<Composed> {
    const notice = await dealNotice(subject);
    if (!notice) return skip('deal is gone');
    if (kind === 'venue_deal_sold_out') return send(dealSoldOutMessage(notice));
    return isLiveDeal(notice.deal, notice.venue, now)
      ? send(dealEndingMessage(notice))
      : skip('deal is no longer live');
  }

  async function composeImport(subject: NotificationSubject, username: string): Promise<Composed> {
    const id = idOf(subject, 'importId');
    const found = id === null ? null : await menuImports.findById(pool, id);
    if (!found) return skip('menu import is gone');
    if (found.status === 'applied') return skip('menu import is already applied');
    if (found.status === 'processing') return skip('menu import is still processing');
    return send(importScreen(found, { botUsername: username, miniAppEnabled }));
  }

  async function composeInactiveWarning(subject: NotificationSubject, createdAt: Date): Promise<Composed> {
    const userId = 'userId' in subject ? subject.userId : null;
    const activeAt = userId === null ? null : await users.lastActiveAt(pool, userId);
    if (activeAt === null) return skip('user is gone');
    return activeAt > createdAt ? skip('user came back') : send(accountInactiveMessage());
  }

  function compose(
    kind: string,
    subject: NotificationSubject,
    now: Date,
    username: string,
    createdAt: Date,
  ): Promise<Composed> {
    if (!isNotificationKind(kind)) return Promise.resolve(skip('unknown notification kind'));
    switch (kind) {
      case 'booking_confirmed':
      case 'booking_reminder':
      case 'booking_redeemed':
      case 'booking_expired':
      case 'venue_booking_created':
      case 'venue_booking_cancelled':
      case 'venue_booking_expired':
        return composeBooking(kind, subject, now);
      case 'venue_deal_sold_out':
      case 'venue_deal_ending':
        return composeDeal(kind, subject, now);
      case 'menu_import_done':
        return composeImport(subject, username);
      case 'venue_report_ready':
        return Promise.resolve(skip('venue reports are not available yet'));
      case 'account_inactive_warning':
        return composeInactiveWarning(subject, createdAt);
    }
  }

  async function deliver(
    row: notifications.QueuedNotification,
    live: LiveBot,
    now: Date,
    report: DeliveryReport,
  ): Promise<void> {
    const context = { notificationId: row.id, kind: row.kind, userId: row.userId };
    if (row.expiresAt <= now) {
      await notifications.finish(pool, row.id, 'expired', null);
      stats?.finished(row.kind, 'expired');
      report.expired += 1;
      return;
    }
    try {
      const recipient = await settings.findRecipient(pool, row.userId);
      const disabled =
        recipient !== null && isNotificationKind(row.kind) && !isKindEnabled(row.kind, recipient.preferences);
      const composed = disabled
        ? skip('the user turned this kind off')
        : await compose(row.kind, row.subject, now, live.username, row.createdAt);
      if ('skip' in composed) {
        await notifications.finish(pool, row.id, 'skipped', composed.skip);
        stats?.finished(row.kind, 'skipped');
        report.skipped += 1;
        logger.debug({ ...context, reason: composed.skip }, 'notification skipped');
        return;
      }
      const sent = await live.messenger.sendToUser(row.userId, { ...composed.message, notify: !row.silent });
      const sentAt = clock.now();
      await notifications.markSent(pool, row.id, sent.messageId, sentAt);
      stats?.delivered(row.kind, (sentAt.getTime() - row.createdAt.getTime()) / SECOND_MS);
      report.sent += 1;
    } catch (error) {
      await settleFailure(row, error, now, report);
    }
  }

  async function settleFailure(
    row: notifications.QueuedNotification,
    error: unknown,
    now: Date,
    report: DeliveryReport,
  ): Promise<void> {
    const context = { notificationId: row.id, kind: row.kind, userId: row.userId, attempts: row.attempts };
    if (error instanceof UserUnreachableError) {
      await notifications.finish(pool, row.id, 'unreachable', describe(error));
      stats?.finished(row.kind, 'unreachable');
      report.unreachable += 1;
      logger.warn(context, 'notification not delivered: the user blocked the bot or never started it');
      return;
    }
    const next = isPermanentRejection(error) ? null : retryAt(row.attempts, now);
    if (next === null || next >= row.expiresAt) {
      const status = next === null ? 'failed' : 'expired';
      await notifications.finish(pool, row.id, status, describe(error));
      stats?.finished(row.kind, status);
      report[status] += 1;
      logger.error({ ...context, err: error }, 'notification failed');
      return;
    }
    await notifications.reschedule(pool, row.id, next, describe(error));
    report.retried += 1;
    logger.warn({ ...context, err: error, retryAt: next }, 'notification delivery will be retried');
  }

  async function deliverDue(now: Date): Promise<DeliveryReport> {
    const report = emptyReport();
    await notifications.releaseStuck(pool, new Date(now.getTime() - SENDING_TIMEOUT_MS));
    for (const expired of await notifications.expireOverdue(pool, now)) {
      stats?.finished(expired.kind, 'expired');
      report.expired += 1;
    }
    const live = bot();
    if (!live) return report;
    for (;;) {
      const batch = await notifications.claimDue(pool, now, DELIVERY_BATCH_SIZE);
      for (const row of batch) await deliver(row, live, clock.now(), report);
      if (batch.length < DELIVERY_BATCH_SIZE) return report;
    }
  }

  return {
    async enqueue(db: Queryable, event: NotificationEvent, now: Date) {
      const target = notificationTarget(event, now);
      const recipients =
        target.audience.kind === 'guest'
          ? [target.audience.userId]
          : 'venue' in event
            ? await venueRecipients(db, event.venue, target.audience.permission)
            : [];
      for (const userId of recipients) {
        if (!isNotifiableUser(userId)) continue;
        const recipient = await settings.findRecipient(db, userId);
        if (!recipient) continue;
        const plan = planDelivery(event.kind, recipient.preferences, {
          now,
          timeZone: recipient.timezone,
          expiresAt: target.expiresAt,
        });
        if (!plan.queue) continue;
        await notifications.insert(db, {
          userId,
          kind: event.kind,
          dedupKey: dedupKey(event.kind, target.subjectKey, userId),
          subject: target.subject,
          silent: plan.silent,
          sendAfter: plan.sendAfter,
          expiresAt: target.expiresAt,
          createdAt: now,
        });
      }
    },

    flush() {
      background.run('deliver-notifications', () => deliverDue(clock.now()));
    },

    deliverDue,
  };
}
