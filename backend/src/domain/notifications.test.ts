import { describe, expect, it } from 'vitest';
import { sampleBooking } from '../../test/bookings.ts';
import { sampleDeal, sampleVenue } from '../../test/venues.ts';
import type { MenuImport } from './models.ts';
import {
  dealRestockedOn,
  dedupKey,
  isLiveDeal,
  isNotifiableUser,
  isNotificationKind,
  minutesLeft,
  needsDealEndingReminder,
  notificationTarget,
  retryAt,
  type NotificationEvent,
} from './notifications.ts';

const NOW = new Date('2026-09-25T09:30:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const at = (ms: number) => new Date(NOW.getTime() + ms);

const menuImport: MenuImport = {
  id: 41,
  venueId: sampleVenue.id,
  source: 'photo',
  status: 'ready',
  items: [],
  error: null,
  model: null,
  createdAt: NOW,
  completedAt: NOW,
};

describe('notificationTarget', () => {
  const booking = { booking: sampleBooking, venue: sampleVenue };

  it.each([
    ['booking_confirmed', sampleBooking.expiresAt],
    ['booking_reminder', sampleBooking.expiresAt],
    ['booking_redeemed', at(2 * HOUR)],
    ['booking_expired', at(2 * HOUR)],
  ] as const)('sends %s to the guest until %s', (kind, expiresAt) => {
    expect(notificationTarget({ kind, ...booking }, NOW)).toEqual({
      subject: { bookingId: 31 },
      subjectKey: '31',
      audience: { kind: 'guest', userId: 101 },
      expiresAt,
    });
  });

  it.each(['venue_booking_created', 'venue_booking_cancelled', 'venue_booking_expired'] as const)(
    'sends %s to the cashiers for two hours',
    (kind) => {
      expect(notificationTarget({ kind, ...booking }, NOW)).toEqual({
        subject: { bookingId: 31 },
        subjectKey: '31',
        audience: { kind: 'venue', permission: 'booking.redeem' },
        expiresAt: at(2 * HOUR),
      });
    },
  );

  it('keeps deal events until the deal is over, the closing time included', () => {
    const late = { ...sampleDeal, endsAt: new Date('2026-09-25T20:00:00Z') };
    for (const kind of ['venue_deal_sold_out', 'venue_deal_ending'] as const) {
      expect(notificationTarget({ kind, deal: late, venue: sampleVenue }, NOW)).toEqual({
        subject: { dealId: 21 },
        subjectKey: '21',
        audience: { kind: 'venue', permission: 'deal.edit' },
        expiresAt: new Date('2026-09-25T19:00:00Z'),
      });
    }
  });

  it('keeps the menu import result and reports for a day', () => {
    expect(notificationTarget({ kind: 'menu_import_done', menuImport, venue: sampleVenue }, NOW)).toEqual({
      subject: { importId: 41 },
      subjectKey: '41',
      audience: { kind: 'venue', permission: 'menu.edit' },
      expiresAt: at(24 * HOUR),
    });
    const report = (period: 'day' | 'week'): NotificationEvent => ({
      kind: 'venue_report_ready',
      venue: sampleVenue,
      period,
      date: '2026-09-21',
    });
    expect(notificationTarget(report('day'), NOW)).toEqual({
      subject: { venueId: 7, period: 'day', date: '2026-09-21' },
      subjectKey: '7:day:2026-09-21',
      audience: { kind: 'venue', permission: 'deal.edit' },
      expiresAt: at(24 * HOUR),
    });
    expect(notificationTarget(report('week'), NOW).audience).toEqual({
      kind: 'venue',
      permission: 'analytics.view',
    });
  });
});

describe('dedupKey', () => {
  it('makes one key per kind, subject and recipient', () => {
    expect(dedupKey('booking_reminder', '31', 101)).toBe('booking_reminder:31:101');
    expect(dedupKey('venue_deal_sold_out', '21', 202)).toBe('venue_deal_sold_out:21:202');
    expect(dedupKey('menu_import_done', '41', 202)).toBe('menu_import_done:41:202');
    expect(dedupKey('venue_report_ready', '7:week:2026-09-21', 202)).toBe(
      'venue_report_ready:7:week:2026-09-21:202',
    );
  });
});

describe('recipients and kinds', () => {
  it('skips missing recipients and demo accounts', () => {
    expect(isNotifiableUser(101)).toBe(true);
    expect(isNotifiableUser(null)).toBe(false);
    expect(isNotifiableUser(-1001)).toBe(false);
    expect(isNotifiableUser(0)).toBe(false);
  });

  it('recognizes only known kinds', () => {
    expect(isNotificationKind('booking_reminder')).toBe(true);
    expect(isNotificationKind('booking_spam')).toBe(false);
  });
});

describe('retryAt', () => {
  it('retries after 1, 5 and 15 minutes and gives up after the fourth attempt', () => {
    expect(retryAt(1, NOW)).toEqual(at(MINUTE));
    expect(retryAt(2, NOW)).toEqual(at(5 * MINUTE));
    expect(retryAt(3, NOW)).toEqual(at(15 * MINUTE));
    expect(retryAt(4, NOW)).toBeNull();
  });
});

describe('minutesLeft', () => {
  it('rounds up and never says zero', () => {
    expect(minutesLeft(at(10 * MINUTE), NOW)).toBe(10);
    expect(minutesLeft(at(9 * MINUTE + 1), NOW)).toBe(10);
    expect(minutesLeft(at(1000), NOW)).toBe(1);
    expect(minutesLeft(NOW, NOW)).toBe(1);
  });
});

describe('deal checks', () => {
  const evening = { ...sampleVenue, closesAt: '22:00' };
  const deal = {
    ...sampleDeal,
    startsAt: new Date('2026-09-25T17:00:00Z'),
    endsAt: new Date('2026-09-25T18:30:00Z'),
  };

  it('treats a cancelled, sold out or finished deal as not live', () => {
    const now = new Date('2026-09-25T18:00:00Z');
    expect(isLiveDeal(deal, evening, now)).toBe(true);
    expect(isLiveDeal({ ...deal, cancelledAt: now }, evening, now)).toBe(false);
    expect(isLiveDeal({ ...deal, quantityLeft: 0 }, evening, now)).toBe(false);
    expect(isLiveDeal(deal, evening, deal.endsAt)).toBe(false);
  });

  it('reminds within the last 30 minutes of a deal that has run for at least 30 minutes', () => {
    expect(needsDealEndingReminder(deal, evening, new Date('2026-09-25T17:59:00Z'))).toBe(false);
    expect(needsDealEndingReminder(deal, evening, new Date('2026-09-25T18:00:00Z'))).toBe(true);
    expect(needsDealEndingReminder(deal, evening, new Date('2026-09-25T18:29:00Z'))).toBe(true);
    const fresh = { ...deal, startsAt: new Date('2026-09-25T18:10:00Z') };
    expect(needsDealEndingReminder(fresh, evening, new Date('2026-09-25T18:20:00Z'))).toBe(false);
  });

  it('uses the closing time when the venue closes before the deal ends', () => {
    const closing = { ...evening, closesAt: '21:10' };
    expect(needsDealEndingReminder(deal, closing, new Date('2026-09-25T17:45:00Z'))).toBe(true);
  });

  it('says the portion went back only while the deal was still running', () => {
    expect(dealRestockedOn(deal, evening, new Date('2026-09-25T18:00:00Z'))).toBe(true);
    expect(dealRestockedOn(deal, evening, deal.endsAt)).toBe(false);
    expect(
      dealRestockedOn(
        { ...deal, cancelledAt: new Date('2026-09-25T17:30:00Z') },
        evening,
        new Date('2026-09-25T18:00:00Z'),
      ),
    ).toBe(false);
    expect(
      dealRestockedOn(
        { ...deal, cancelledAt: new Date('2026-09-25T18:10:00Z') },
        evening,
        new Date('2026-09-25T18:00:00Z'),
      ),
    ).toBe(true);
  });
});
