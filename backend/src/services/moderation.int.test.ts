import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedBooking, seedGuest } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { fakeLogger, fakeMessenger } from '../../test/max-api.ts';
import { queuedNotifications } from '../../test/notifications.ts';
import { seedDeal, seedMenuItem, seedUser, seedVenue } from '../../test/venues.ts';
import { one } from '../db/pool.ts';
import type { Deal, MenuItem, Venue } from '../domain/models.ts';
import { createOutbox } from '../notifications/outbox.ts';
import type { Messenger } from '../ports/messenger.ts';
import * as deals from '../repositories/deals.ts';
import * as venues from '../repositories/venues.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { createAccountService } from './account.ts';
import { createAuditService } from './audit.ts';
import { createBookingsService } from './bookings.ts';
import { createConsentsService } from './consents.ts';
import { createDiaryService } from './diary.ts';
import { createModerationService, type ModerationService } from './moderation.ts';
import { createVenuesService } from './venues.ts';

const pool = testPool();
const START = '2026-09-25T09:00:00Z';
const clock = fixedClock(START);
const ADMIN = 900;
const OWNER = 202;
const GUEST = 101;
const OTHER_GUEST = 102;
const HOUR = 3_600_000;

const background = createBackgroundTasks({ error: () => undefined });
const sendToUser = vi.fn<Messenger['sendToUser']>(() => Promise.resolve({ messageId: 'mid' }));
const outbox = createOutbox({
  pool,
  clock,
  bot: () => ({ messenger: fakeMessenger({ sendToUser }), username: 'ppshkin_bot' }),
  miniAppEnabled: true,
  diaryDay: () => Promise.reject(new Error('the diary is not used here')),
  background,
  logger: fakeLogger(),
});
const consents = createConsentsService({ pool, clock });
const bookings = createBookingsService({ pool, clock, consents, notifications: outbox });
const account = createAccountService({ pool, clock, notifications: outbox });
const venuesService = createVenuesService({ pool, clock });
const audit = createAuditService({ pool });
const diary = createDiaryService({
  pool,
  clock,
  consents,
  dishes: {
    fromPhoto: () => Promise.reject(new Error('unused')),
    fromText: () => Promise.reject(new Error('unused')),
  },
});

let moderation: ModerationService;
let venue: Venue;
let eclair: MenuItem;
let deal: Deal;
let codes = 0;

const later = (ms: number) => new Date(clock.now().getTime() + ms);

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const nextCode = () => {
  codes += 1;
  return `AAAA${ALPHABET[Math.floor(codes / 32)] ?? 'A'}${ALPHABET[codes % 32] ?? 'A'}`;
};

async function book(userId: number, item = eclair, dealId: number | null = null) {
  return seedBooking(pool, { userId, item, code: nextCode(), createdAt: clock.now(), dealId });
}

async function stored<T extends Record<string, unknown>>(sql: string, values: unknown[]): Promise<T> {
  return one<T>(pool, sql, values);
}

async function sentTexts(): Promise<[number, string][]> {
  await background.idle();
  await outbox.deliverDue(clock.now());
  const texts = sendToUser.mock.calls.map(([userId, message]): [number, string] => [userId, message.text]);
  sendToUser.mockClear();
  return texts;
}

beforeEach(async () => {
  await background.idle();
  await resetDatabase(pool);
  clock.set(START);
  codes = 0;
  sendToUser.mockClear();
  moderation = createModerationService({ pool, clock, notifications: outbox, adminIds: [ADMIN] });
  await seedUser(pool, ADMIN);
  venue = await seedVenue(pool, OWNER);
  eclair = await seedMenuItem(pool, venue.id, { name: 'Эклер', priceRub: 200 });
  deal = await seedDeal(pool, eclair, {
    priceRub: 120,
    quantity: 3,
    startsAt: later(-HOUR),
    endsAt: later(5 * HOUR),
  });
  for (const guest of [GUEST, OTHER_GUEST]) await seedGuest(pool, guest, clock.now());
});

afterAll(async () => {
  await background.idle();
  await closeTestPool();
});

describe('who is an administrator', () => {
  it('knows only the configured ids and hides admin actions from everyone else', async () => {
    expect(moderation.isAdmin(ADMIN)).toBe(true);
    expect(moderation.isAdmin(GUEST)).toBe(false);
    await expect(moderation.blockVenue(GUEST, venue.id, 'тест', 'api')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
    await expect(moderation.listForReview(GUEST, null)).rejects.toMatchObject({ status: 404 });
    await expect(moderation.blockUser(OWNER, GUEST, 'тест', 'api')).rejects.toMatchObject({ status: 404 });
  });
});

describe('blocking a venue', () => {
  it('hides the venue from guests and bookings and shows it again after unblocking', async () => {
    expect(await venues.findVisible(pool, venue.id, GUEST)).not.toBeNull();
    await moderation.blockVenue(ADMIN, venue.id, 'Нет подтверждения', 'api');

    expect(await venues.findVisible(pool, venue.id, GUEST)).toBeNull();
    expect((await venues.listVisible(pool, GUEST)).map((entry) => entry.id)).not.toContain(venue.id);
    expect(
      await venues.listVisibleWithin(pool, { minLat: 0, maxLat: 90, minLon: 0, maxLon: 90 }, GUEST),
    ).toEqual([]);
    await expect(bookings.create(GUEST, { menuItemId: eclair.id }, 'miniapp')).rejects.toMatchObject({
      status: 404,
      code: 'menu_item_not_found',
    });

    await moderation.unblockVenue(ADMIN, venue.id, 'api');
    expect(await venues.findVisible(pool, venue.id, GUEST)).not.toBeNull();
    expect(await deals.listVisible(pool, [venue.id], clock.now())).toEqual([]);
  });

  it('keeps a deal that is still live out of the hot offers while the venue is blocked', async () => {
    await pool.query('update venues set blocked_at = $2 where id = $1', [venue.id, clock.now()]);
    expect(await deals.listVisible(pool, [venue.id], clock.now())).toEqual([]);
    expect(await deals.findVisible(pool, deal.id, clock.now())).toBeNull();
  });

  it('withdraws deals, cancels bookings with portions returned and queues messages in one transaction', async () => {
    const first = await book(GUEST, eclair, deal.id);
    await pool.query('update deals set quantity_left = quantity_left - 1 where id = $1', [deal.id]);
    const second = await book(OTHER_GUEST);
    await moderation.blockVenue(ADMIN, venue.id, '  Цена на кассе другая  ', 'api');

    expect(
      await stored<{ status: string }>('select status from bookings where id = $1', [first]),
    ).toMatchObject({ status: 'cancelled' });
    expect(
      await stored<{ status: string }>('select status from bookings where id = $1', [second]),
    ).toMatchObject({ status: 'cancelled' });
    const dealRow = await stored<{ cancelled_at: Date | null; quantity_left: number }>(
      'select cancelled_at, quantity_left from deals where id = $1',
      [deal.id],
    );
    expect(dealRow.cancelled_at).toEqual(clock.now());
    expect(dealRow.quantity_left).toBe(3);
    expect(
      await stored<{ blocked_reason: string }>('select blocked_reason from venues where id = $1', [venue.id]),
    ).toEqual({ blocked_reason: 'Цена на кассе другая' });

    const queued = (await queuedNotifications(pool)).map((row) => [row.userId, row.kind]);
    expect(queued).toEqual(
      expect.arrayContaining([
        [GUEST, 'booking_venue_blocked'],
        [OTHER_GUEST, 'booking_venue_blocked'],
        [OWNER, 'venue_blocked'],
      ]),
    );

    const texts = await sentTexts();
    expect(texts.find(([userId]) => userId === GUEST)?.[1]).toContain(
      'Бронь отменена: заведение временно недоступно',
    );
    expect(texts.find(([userId]) => userId === OWNER)?.[1]).toContain(
      'Заведение приостановлено: Цена на кассе другая',
    );
  });

  it('rolls everything back when a step fails', async () => {
    await book(GUEST);
    const failing = createModerationService({
      pool,
      clock,
      adminIds: [ADMIN],
      notifications: {
        enqueue: () => Promise.reject(new Error('queue is down')),
        flush: () => undefined,
      },
    });
    await expect(failing.blockVenue(ADMIN, venue.id, 'тест', 'api')).rejects.toThrow('queue is down');
    expect(
      await stored<{ blocked_at: Date | null }>('select blocked_at from venues where id = $1', [venue.id]),
    ).toEqual({ blocked_at: null });
    expect(
      await stored<{ total: number }>(
        `select count(*)::int as total from bookings where status = 'active'`,
        [],
      ),
    ).toEqual({ total: 1 });
  });

  it('answers 409 for a second block or an unblock of an open venue and 404 for an unknown venue', async () => {
    await expect(moderation.unblockVenue(ADMIN, venue.id, 'api')).rejects.toMatchObject({
      status: 409,
      code: 'not_blocked',
    });
    await moderation.blockVenue(ADMIN, venue.id, 'тест', 'api');
    await expect(moderation.blockVenue(ADMIN, venue.id, 'тест', 'api')).rejects.toMatchObject({
      status: 409,
      code: 'already_blocked',
    });
    await expect(moderation.blockVenue(ADMIN, 9999, 'тест', 'api')).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
    await expect(moderation.blockVenue(ADMIN, venue.id, '   ', 'api')).rejects.toMatchObject({ status: 400 });
  });

  it('records the action in the audit log without showing it to the venue owner', async () => {
    await moderation.blockVenue(ADMIN, venue.id, 'тест', 'api');
    const row = await stored<{
      venue_id: number;
      actor_user_id: number;
      target_type: string;
      target_id: number;
    }>(
      `select venue_id, actor_user_id, target_type, target_id from audit_events where action = 'admin.venue.block'`,
      [],
    );
    expect(row).toEqual({
      venue_id: venue.id,
      actor_user_id: ADMIN,
      target_type: 'venue',
      target_id: venue.id,
    });
    expect((await audit.list({ userId: OWNER }, {})).items).toEqual([]);
  });
});

describe('blocking a user', () => {
  it('forbids bookings and venues, keeps the diary and account deletion, and cancels active bookings', async () => {
    const active = await book(GUEST, eclair, deal.id);
    await pool.query('update deals set quantity_left = quantity_left - 1 where id = $1', [deal.id]);
    await moderation.blockUser(ADMIN, GUEST, 'Злоупотребление', 'api');

    expect(
      await stored<{ status: string }>('select status from bookings where id = $1', [active]),
    ).toMatchObject({ status: 'cancelled' });
    expect(
      (await stored<{ quantity_left: number }>('select quantity_left from deals where id = $1', [deal.id]))
        .quantity_left,
    ).toBe(3);
    await expect(bookings.create(GUEST, { menuItemId: eclair.id }, 'miniapp')).rejects.toMatchObject({
      status: 403,
      code: 'user_blocked',
    });
    await expect(
      venuesService.create(GUEST, {
        name: 'Новое',
        address: 'ул. Баумана, 1',
        category: 'coffee',
        location: { lat: 55.79, lon: 49.12 },
      }),
    ).rejects.toMatchObject({ status: 403, code: 'user_blocked' });
    await expect(diary.day(GUEST)).resolves.toBeDefined();
    await expect(account.deleteAccount(GUEST)).resolves.toBeUndefined();
  });

  it('lets the user back in after unblocking and protects administrators and demo accounts', async () => {
    await moderation.blockUser(ADMIN, GUEST, 'тест', 'api');
    await expect(moderation.blockUser(ADMIN, GUEST, 'тест', 'api')).rejects.toMatchObject({
      status: 409,
      code: 'already_blocked',
    });
    await moderation.unblockUser(ADMIN, GUEST, 'api');
    await expect(moderation.unblockUser(ADMIN, GUEST, 'api')).rejects.toMatchObject({
      status: 409,
      code: 'not_blocked',
    });
    await expect(bookings.create(GUEST, { menuItemId: eclair.id }, 'miniapp')).resolves.toBeDefined();
    await expect(moderation.blockUser(ADMIN, ADMIN, 'тест', 'api')).rejects.toMatchObject({ status: 409 });
    await expect(moderation.blockUser(ADMIN, -1001, 'тест', 'api')).rejects.toMatchObject({ status: 404 });
    await expect(moderation.blockUser(ADMIN, 777, 'тест', 'api')).rejects.toMatchObject({ status: 404 });
  });
});

describe('complaints', () => {
  it('files a complaint about a booking and tells administrators without revealing the guest to the venue', async () => {
    const bookingId = await book(GUEST);
    const complaint = await moderation.createComplaint(GUEST, {
      venueId: venue.id,
      bookingId,
      reason: 'not_served',
      text: '  Не выдали  ',
    });
    expect(complaint).toMatchObject({ venueId: venue.id, bookingId, reason: 'not_served', status: 'open' });
    expect(
      await stored<{ text: string }>('select text from complaints where id = $1', [complaint.id]),
    ).toEqual({
      text: 'Не выдали',
    });
    expect((await moderation.listComplaints(GUEST)).map((entry) => entry.id)).toEqual([complaint.id]);
    expect(await moderation.listComplaints(OTHER_GUEST)).toEqual([]);

    const adminTexts = await sentTexts();
    expect(adminTexts).toHaveLength(1);
    expect(adminTexts[0]?.[0]).toBe(ADMIN);
    expect(adminTexts[0]?.[1]).toContain('Не выдали заказ по брони');

    const reviewed = await moderation.resolveComplaint(
      ADMIN,
      complaint.id,
      { status: 'resolved', resolution: 'Связались' },
      'api',
    );
    expect(reviewed).toMatchObject({
      status: 'resolved',
      resolution: 'Связались',
      bookingCode: 'AAAAAB',
      itemName: 'Эклер',
    });
    const texts = await sentTexts();
    expect(texts.map(([userId]) => userId).sort()).toEqual([OWNER, GUEST].sort());
    const venueText = texts.find(([userId]) => userId === OWNER)?.[1] ?? '';
    expect(venueText).toContain('Не выдали заказ по брони');
    expect(venueText).toContain('AAAAAB');
    expect(venueText).not.toContain('Не выдали\n');
    expect(venueText).not.toContain(String(GUEST));
    expect(texts.find(([userId]) => userId === GUEST)?.[1]).toContain('Связались');
    await expect(
      moderation.resolveComplaint(ADMIN, complaint.id, { status: 'rejected' }, 'api'),
    ).rejects.toMatchObject({ status: 409, code: 'already_resolved' });
  });

  it('does not pass a rejected complaint to the venue', async () => {
    const complaint = await moderation.createComplaint(GUEST, { venueId: venue.id, reason: 'quality' });
    await moderation.resolveComplaint(ADMIN, complaint.id, { status: 'rejected' }, 'api');
    expect((await queuedNotifications(pool)).filter((row) => row.kind === 'venue_complaint')).toEqual([]);
    expect(
      (await queuedNotifications(pool))
        .filter((row) => row.kind === 'complaint_decided')
        .map((row) => row.userId),
    ).toEqual([GUEST]);
  });

  it('allows one complaint per booking and treats other guests bookings as missing', async () => {
    const bookingId = await book(GUEST);
    await moderation.createComplaint(GUEST, { venueId: venue.id, bookingId, reason: 'other' });
    await expect(
      moderation.createComplaint(GUEST, { venueId: venue.id, bookingId, reason: 'quality' }),
    ).rejects.toMatchObject({ status: 409, code: 'complaint_exists' });
    await expect(
      moderation.createComplaint(OTHER_GUEST, { venueId: venue.id, bookingId, reason: 'quality' }),
    ).rejects.toMatchObject({ status: 404, code: 'booking_not_found' });
    const elsewhere = await seedVenue(pool, 303);
    await expect(
      moderation.createComplaint(GUEST, { venueId: elsewhere.id, bookingId, reason: 'quality' }),
    ).rejects.toMatchObject({ status: 404, code: 'booking_not_found' });
    await expect(
      moderation.createComplaint(GUEST, { venueId: 9999, reason: 'quality' }),
    ).rejects.toMatchObject({ status: 404, code: 'venue_not_found' });
  });

  it('limits a guest to five complaints a day by the clock', async () => {
    for (let index = 0; index < 5; index += 1) {
      await moderation.createComplaint(GUEST, { venueId: venue.id, reason: 'wrong_info' });
    }
    await expect(
      moderation.createComplaint(GUEST, { venueId: venue.id, reason: 'wrong_info' }),
    ).rejects.toMatchObject({ status: 409, code: 'complaint_limit' });
    await expect(
      moderation.createComplaint(OTHER_GUEST, { venueId: venue.id, reason: 'wrong_info' }),
    ).resolves.toBeDefined();
    clock.advance(24 * HOUR + 1000);
    await expect(
      moderation.createComplaint(GUEST, { venueId: venue.id, reason: 'wrong_info' }),
    ).resolves.toBeDefined();
  });

  it('lists complaints for review by status and rejects text over the limit', async () => {
    const open = await moderation.createComplaint(GUEST, { venueId: venue.id, reason: 'other' });
    const done = await moderation.createComplaint(OTHER_GUEST, { venueId: venue.id, reason: 'other' });
    await moderation.resolveComplaint(ADMIN, done.id, { status: 'rejected' }, 'api');
    expect((await moderation.listForReview(ADMIN, 'open')).map((entry) => entry.id)).toEqual([open.id]);
    expect((await moderation.listForReview(ADMIN, null)).map((entry) => entry.id)).toEqual([
      done.id,
      open.id,
    ]);
    await expect(
      moderation.createComplaint(GUEST, { venueId: venue.id, reason: 'other', text: 'я'.repeat(501) }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('erases the text and the reporter when the account is deleted', async () => {
    const complaint = await moderation.createComplaint(GUEST, {
      venueId: venue.id,
      reason: 'other',
      text: 'Личные подробности',
    });
    await account.deleteAccount(GUEST);
    expect(
      await stored<{ text: string | null; reporter_id: number | null }>(
        'select text, reporter_id from complaints where id = $1',
        [complaint.id],
      ),
    ).toEqual({ text: null, reporter_id: null });
  });
});

describe('moderation signals', () => {
  async function bookingsOf(item: MenuItem, redeemed: number, total: number) {
    for (let index = 0; index < total; index += 1) {
      await seedBooking(pool, {
        userId: GUEST,
        item,
        code: nextCode(),
        createdAt: later(-HOUR),
        status: index < redeemed ? 'redeemed' : 'expired',
      });
    }
  }

  it('flags three open complaints within a week and not two', async () => {
    await moderation.createComplaint(GUEST, { venueId: venue.id, reason: 'other' });
    await moderation.createComplaint(OTHER_GUEST, { venueId: venue.id, reason: 'other' });
    expect(await moderation.signals()).toEqual([]);
    await seedGuest(pool, 103, clock.now());
    await moderation.createComplaint(103, { venueId: venue.id, reason: 'other' });
    expect(await moderation.signals()).toMatchObject([{ venueId: venue.id, reasons: ['open_complaints'] }]);
    clock.advance(8 * 24 * HOUR);
    expect(await moderation.signals()).toEqual([]);
  });

  it('flags a redeem rate below 0.3 only from ten bookings', async () => {
    await bookingsOf(eclair, 0, 9);
    expect(await moderation.signals()).toEqual([]);
    await bookingsOf(await seedMenuItem(pool, venue.id, { name: 'Тарт', priceRub: 250 }), 0, 1);
    expect(await moderation.signals()).toMatchObject([{ venueId: venue.id, reasons: ['low_redeem_rate'] }]);
  });

  it('does not flag a redeem rate of 0.3 and skips blocked venues', async () => {
    await bookingsOf(eclair, 3, 10);
    expect(await moderation.signals()).toEqual([]);
    await pool.query('delete from bookings');
    await bookingsOf(eclair, 2, 10);
    expect(await moderation.signals()).toHaveLength(1);
    await moderation.blockVenue(ADMIN, venue.id, 'тест', 'api');
    expect(await moderation.signals()).toEqual([]);
  });
});
