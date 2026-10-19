import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedBooking } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { fakeMessenger } from '../../test/max-api.ts';
import { recordingNotifications } from '../../test/notifications.ts';
import {
  seedCompany,
  seedCompanyVenue,
  seedDeal,
  seedMember,
  seedMenuItem,
  seedUser,
  seedVenue,
} from '../../test/venues.ts';
import type { MenuItem, Venue } from '../domain/models.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { createBookingsService } from './bookings.ts';
import { createConsentsService } from './consents.ts';
import { createReportsService } from './reports.ts';

const pool = testPool();
const clock = fixedClock('2026-10-18T19:30:00Z');
const recorded = recordingNotifications();
const bookings = createBookingsService({
  pool,
  clock,
  consents: createConsentsService({ pool, clock }),
  notifications: recorded.notifications,
});
const background = createBackgroundTasks({ error: () => undefined });
const messenger = fakeMessenger({
  uploadFile: vi.fn(() => Promise.resolve('file-token')),
  sendToUser: vi.fn(() => Promise.resolve({ messageId: 'mid.1' })),
});
let live = true;
const service = createReportsService({
  pool,
  clock,
  bookings,
  notifications: recorded.notifications,
  messenger: () => (live ? messenger : null),
  background,
});

const OWNER = 202;
const GUESTS = [101, 102, 103];
const at = (iso: string) => new Date(iso);
const actor = { userId: OWNER };

let venue: Venue;
let eclair: MenuItem;
let latte: MenuItem;
let codeCounter = 0;

function code(): string {
  codeCounter += 1;
  const letters = 'ABCDEFGH';
  return `AAAA${letters[Math.floor(codeCounter / 8) % 8] ?? 'A'}${letters[codeCounter % 8] ?? 'A'}`;
}

async function booking(
  item: MenuItem,
  dealId: number,
  userId: number | null,
  status: 'redeemed' | 'expired' | 'active' | 'cancelled',
  resolvedAt = '2026-10-18T09:00:00Z',
  priceRub = 120,
) {
  await seedBooking(pool, {
    userId,
    item,
    code: code(),
    createdAt: at('2026-10-18T08:30:00Z'),
    dealId,
    status,
    priceRub,
    resolvedAt: at(resolvedAt),
    expiresAt: at(status === 'active' ? '2026-10-19T08:30:00Z' : '2026-10-18T09:30:00Z'),
  });
}

async function eclairDeal(overrides: { quantity?: number; startsAt?: string; endsAt?: string } = {}) {
  return seedDeal(pool, eclair, {
    priceRub: 120,
    quantity: overrides.quantity ?? 5,
    startsAt: at(overrides.startsAt ?? '2026-10-18T07:00:00Z'),
    endsAt: at(overrides.endsAt ?? '2026-10-18T12:00:00Z'),
  });
}

beforeEach(async () => {
  await resetDatabase(pool);
  recorded.clear();
  live = true;
  clock.set('2026-10-18T19:30:00Z');
  for (const id of GUESTS) await seedUser(pool, id);
  venue = await seedVenue(pool, OWNER);
  eclair = await seedMenuItem(pool, venue.id, { name: 'Эклер', priceRub: 200 });
  latte = await seedMenuItem(pool, venue.id, { name: 'Латте', priceRub: 180 });
});

afterAll(closeTestPool);

describe('day report', () => {
  it('counts listed, sold, reserved, revenue and discount of the day', async () => {
    const deal = await eclairDeal();
    await booking(eclair, deal.id, 101, 'redeemed');
    await booking(eclair, deal.id, 102, 'redeemed', '2026-10-18T10:00:00Z');
    await booking(eclair, deal.id, 103, 'expired');
    const report = await service.day(actor, '2026-10-18');
    expect(report).toMatchObject({
      from: '2026-10-18',
      to: '2026-10-18',
      listed: 5,
      soldViaApp: 2,
      reserved: 0,
      writtenOff: 0,
      unaccounted: 0,
      notClosed: 1,
      soldShare: 0.4,
      revenueRub: 240,
      discountRub: 160,
      missingListPrice: 0,
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      dealId: deal.id,
      listPriceRub: 200,
      writtenOff: null,
      unaccounted: null,
    });
  });

  it('attributes a deal to the local day of its start', async () => {
    const late = await eclairDeal({ startsAt: '2026-10-18T21:30:00Z', endsAt: '2026-10-18T22:00:00Z' });
    expect((await service.day(actor, '2026-10-18')).rows).toHaveLength(0);
    expect((await service.day(actor, '2026-10-19')).rows.map((row) => row.dealId)).toEqual([late.id]);
  });

  it('skips a deal cancelled before the first booking but keeps one cancelled after it', async () => {
    const early = await eclairDeal();
    const later = await seedDeal(pool, latte, {
      priceRub: 90,
      startsAt: at('2026-10-18T07:00:00Z'),
      endsAt: at('2026-10-18T12:00:00Z'),
    });
    await booking(latte, later.id, 101, 'redeemed', '2026-10-18T09:00:00Z', 90);
    await pool.query('update deals set cancelled_at = $1', [at('2026-10-18T10:00:00Z')]);
    const report = await service.day(actor, '2026-10-18');
    expect(report.rows.map((row) => row.dealId)).toEqual([later.id]);
    expect(early.id).not.toBe(later.id);
  });

  it('keeps old deals without a menu price out of the discount', async () => {
    const deal = await eclairDeal();
    await pool.query('update deals set list_price_rub = null where id = $1', [deal.id]);
    await booking(eclair, deal.id, 101, 'redeemed');
    const report = await service.day(actor, '2026-10-18');
    expect(report).toMatchObject({ discountRub: 0, missingListPrice: 1 });
  });

  it('shows active bookings of a running deal as reserved and not closed yet', async () => {
    clock.set('2026-10-18T09:00:00Z');
    const deal = await eclairDeal();
    await booking(eclair, deal.id, 101, 'active');
    const report = await service.day(actor, '2026-10-18');
    expect(report).toMatchObject({ reserved: 1, notClosed: 0 });
  });

  it('counts first redeemed visits of real guests once', async () => {
    const deal = await eclairDeal();
    const yesterday = await eclairDeal({ startsAt: '2026-10-17T07:00:00Z', endsAt: '2026-10-17T12:00:00Z' });
    await booking(eclair, yesterday.id, 101, 'redeemed', '2026-10-17T09:00:00Z');
    await booking(eclair, deal.id, 101, 'redeemed', '2026-10-18T09:00:00Z');
    await booking(eclair, deal.id, 102, 'redeemed', '2026-10-18T09:10:00Z');
    await booking(eclair, deal.id, 103, 'redeemed', '2026-10-18T09:20:00Z');
    await booking(eclair, deal.id, null, 'redeemed', '2026-10-18T09:30:00Z');
    expect((await service.day(actor, '2026-10-18')).newGuests).toBe(2);
    expect((await service.day(actor, '2026-10-17')).newGuests).toBe(1);
  });

  it('builds a period report and validates the period', async () => {
    const report = await service.period(actor, { from: '2026-10-12', to: '2026-10-18' });
    expect(report).toMatchObject({ from: '2026-10-12', to: '2026-10-18', listed: 0 });
    await expect(service.period(actor, { from: '2026-10-18', to: '2026-10-12' })).rejects.toMatchObject({
      code: 'invalid_period',
    });
    await expect(service.period(actor, { from: 'x' })).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('is closed to a cashier and to a stranger', async () => {
    const company = await seedCompany(pool, 400);
    const place = await seedCompanyVenue(pool, company.id);
    await seedMember(pool, company.id, 401, 'cashier');
    await seedMember(pool, company.id, 402, 'manager');
    await expect(service.day({ userId: 401, venueId: place.id })).rejects.toMatchObject({
      code: 'venue_forbidden',
    });
    await expect(service.day({ userId: 402, venueId: place.id })).resolves.toMatchObject({ listed: 0 });
    await expect(service.day({ userId: 999 })).rejects.toMatchObject({ code: 'venue_not_found' });
  });
});

describe('closing out a deal', () => {
  it('stores the write-off and reports it', async () => {
    const deal = await eclairDeal();
    await booking(eclair, deal.id, 101, 'redeemed');
    const closed = await service.closeOut(actor, deal.id, 2, 'bot');
    expect(closed).toMatchObject({ dealId: deal.id, writtenOff: 2, channel: 'bot', date: '2026-10-18' });
    const report = await service.day(actor, '2026-10-18');
    expect(report).toMatchObject({ writtenOff: 2, unaccounted: 2, notClosed: 0, writeOffShare: 0.4 });
  });

  it('writes off the rest on request', async () => {
    const deal = await eclairDeal();
    await booking(eclair, deal.id, 101, 'redeemed');
    expect((await service.closeOut(actor, deal.id, 'rest', 'bot')).writtenOff).toBe(4);
  });

  it('answers 404 for a deal of another venue', async () => {
    const other = await seedVenue(pool, 303);
    const item = await seedMenuItem(pool, other.id);
    const foreign = await seedDeal(pool, item, {
      startsAt: at('2026-10-18T07:00:00Z'),
      endsAt: at('2026-10-18T12:00:00Z'),
    });
    await expect(service.closeOut(actor, foreign.id, 1, 'miniapp')).rejects.toMatchObject({
      status: 404,
      code: 'deal_not_found',
    });
    await expect(service.closeOut(actor, 999_999, 1, 'miniapp')).rejects.toMatchObject({ status: 404 });
  });

  it('answers 409 while the deal is running', async () => {
    clock.set('2026-10-18T09:00:00Z');
    const deal = await eclairDeal();
    await expect(service.closeOut(actor, deal.id, 1, 'miniapp')).rejects.toMatchObject({
      status: 409,
      code: 'deal_not_finished',
    });
  });

  it.each(['ended', 'sold_out', 'cancelled'])('accepts a %s deal', async (state) => {
    clock.set('2026-10-18T09:00:00Z');
    const deal = await eclairDeal({ quantity: 2 });
    if (state === 'ended') clock.set('2026-10-18T13:00:00Z');
    if (state === 'sold_out') await pool.query('update deals set quantity_left = 0');
    if (state === 'cancelled') await pool.query('update deals set cancelled_at = $1', [clock.now()]);
    await expect(service.closeOut(actor, deal.id, 0, 'miniapp')).resolves.toMatchObject({ writtenOff: 0 });
  });

  it('answers 422 when the write-off exceeds free portions', async () => {
    const deal = await eclairDeal();
    await booking(eclair, deal.id, 101, 'redeemed');
    await booking(eclair, deal.id, 102, 'active');
    await expect(service.closeOut(actor, deal.id, 4, 'miniapp')).rejects.toMatchObject({
      status: 422,
      code: 'writeoff_too_large',
    });
    await expect(service.closeOut(actor, deal.id, 3, 'miniapp')).resolves.toMatchObject({ writtenOff: 3 });
  });

  it('lets the mark change within 48 hours and locks it afterwards', async () => {
    const deal = await eclairDeal();
    const first = await service.closeOut(actor, deal.id, 1, 'bot');
    clock.advance(47 * 3_600_000);
    const second = await service.closeOut(actor, deal.id, 3, 'miniapp');
    expect(second.closedAt).toEqual(first.closedAt);
    expect(second).toMatchObject({ writtenOff: 3, channel: 'miniapp' });
    clock.advance(2 * 3_600_000);
    await expect(service.closeOut(actor, deal.id, 2, 'miniapp')).rejects.toMatchObject({
      status: 409,
      code: 'closeout_locked',
    });
  });

  it('requires the deal.edit permission', async () => {
    const company = await seedCompany(pool, 400);
    const place = await seedCompanyVenue(pool, company.id);
    await seedMember(pool, company.id, 401, 'cashier');
    await expect(service.closeOut({ userId: 401, venueId: place.id }, 1, 1, 'bot')).rejects.toMatchObject({
      code: 'venue_forbidden',
    });
  });
});

describe('day close queue', () => {
  it('queues one event after closing and never repeats it', async () => {
    await eclairDeal();
    clock.set('2026-10-18T19:10:00Z');
    expect(await service.queueDayClose(clock.now())).toBe(0);
    clock.set('2026-10-18T19:20:00Z');
    expect(await service.queueDayClose(clock.now())).toBe(1);
    expect(await service.queueDayClose(clock.now())).toBe(0);
    expect(recorded.events).toMatchObject([
      { kind: 'venue_report_ready', period: 'day', date: '2026-10-18', venue: { id: venue.id } },
    ]);
    expect(recorded.notifications.flush).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a venue without deals and for a closed day', async () => {
    expect(await service.queueDayClose(clock.now())).toBe(0);
    const deal = await eclairDeal();
    await service.closeOut(actor, deal.id, 0, 'bot');
    expect(await service.queueDayClose(clock.now())).toBe(0);
    expect(recorded.events).toEqual([]);
  });

  it('stays silent when every portion was sold', async () => {
    const deal = await eclairDeal({ quantity: 1 });
    await booking(eclair, deal.id, 101, 'redeemed');
    expect(await service.queueDayClose(clock.now())).toBe(0);
  });

  it('waits for the night closing of a venue that closes after midnight', async () => {
    await pool.query("update venues set opens_at = '18:00', closes_at = '02:00' where id = $1", [venue.id]);
    await seedDeal(pool, eclair, {
      startsAt: at('2026-10-18T15:30:00Z'),
      endsAt: at('2026-10-18T21:30:00Z'),
    });
    clock.set('2026-10-18T22:00:00Z');
    expect(await service.queueDayClose(clock.now())).toBe(0);
    clock.set('2026-10-18T23:10:00Z');
    expect(await service.queueDayClose(clock.now())).toBe(0);
    clock.set('2026-10-18T23:20:00Z');
    expect(await service.queueDayClose(clock.now())).toBe(1);
    expect(recorded.events).toMatchObject([{ date: '2026-10-18' }]);
  });

  it('closes the day of a round-the-clock venue at 23:45 local time', async () => {
    await pool.query("update venues set opens_at = '00:00', closes_at = '00:00' where id = $1", [venue.id]);
    await eclairDeal({ startsAt: '2026-10-18T07:00:00Z', endsAt: '2026-10-18T12:00:00Z' });
    clock.set('2026-10-18T20:40:00Z');
    expect(await service.queueDayClose(clock.now())).toBe(0);
    clock.set('2026-10-18T20:46:00Z');
    expect(await service.queueDayClose(clock.now())).toBe(1);
  });

  it('keeps one event when two schedulers race', async () => {
    await eclairDeal();
    const results = await Promise.all([
      service.queueDayClose(clock.now()),
      service.queueDayClose(clock.now()),
    ]);
    expect(results.reduce((total, value) => total + value, 0)).toBe(1);
  });
});

describe('weekly report queue', () => {
  it('queues the previous week on Monday after 09:00 local time, once', async () => {
    await eclairDeal({ startsAt: '2026-10-14T07:00:00Z', endsAt: '2026-10-14T12:00:00Z' });
    clock.set('2026-10-19T05:30:00Z');
    expect(await service.queueWeekly(clock.now())).toBe(0);
    clock.set('2026-10-19T06:00:00Z');
    expect(await service.queueWeekly(clock.now())).toBe(1);
    expect(await service.queueWeekly(clock.now())).toBe(0);
    expect(recorded.events).toMatchObject([
      { kind: 'venue_report_ready', period: 'week', date: '2026-10-12' },
    ]);
  });

  it('does not run on other days and skips weeks without deals', async () => {
    await eclairDeal({ startsAt: '2026-10-14T07:00:00Z', endsAt: '2026-10-14T12:00:00Z' });
    clock.set('2026-10-20T10:00:00Z');
    expect(await service.queueWeekly(clock.now())).toBe(0);
    clock.set('2026-10-26T10:00:00Z');
    expect(await service.queueWeekly(clock.now())).toBe(0);
    expect(recorded.events).toEqual([]);
  });

  it('follows the time zone of each venue', async () => {
    const east = await seedVenue(pool, 303, { timezone: 'Asia/Vladivostok' });
    const item = await seedMenuItem(pool, east.id);
    await seedDeal(pool, item, { startsAt: at('2026-10-14T01:00:00Z'), endsAt: at('2026-10-14T05:00:00Z') });
    await eclairDeal({ startsAt: '2026-10-14T07:00:00Z', endsAt: '2026-10-14T12:00:00Z' });
    clock.set('2026-10-18T23:30:00Z');
    expect(await service.queueWeekly(clock.now())).toBe(1);
    expect(recorded.events).toMatchObject([{ venue: { id: east.id } }]);
    clock.set('2026-10-19T06:00:00Z');
    expect(await service.queueWeekly(clock.now())).toBe(1);
  });
});

describe('streak of days without a mark', () => {
  async function dealOn(date: string) {
    return seedDeal(pool, eclair, {
      startsAt: at(`${date}T07:00:00Z`),
      endsAt: at(`${date}T12:00:00Z`),
    });
  }

  it('returns venues with three full days in a row', async () => {
    await dealOn('2026-10-15');
    await dealOn('2026-10-16');
    await dealOn('2026-10-17');
    expect(await service.venuesWithNotClosedStreak(clock.now())).toEqual([
      { venueId: venue.id, days: ['2026-10-15', '2026-10-16', '2026-10-17'] },
    ]);
  });

  it('does not return a venue with a gap, with a closed day or only today', async () => {
    await dealOn('2026-10-15');
    const middle = await dealOn('2026-10-16');
    await dealOn('2026-10-17');
    await dealOn('2026-10-18');
    await service.closeOut(actor, middle.id, 0, 'bot');
    expect(await service.venuesWithNotClosedStreak(clock.now())).toEqual([]);
  });

  it('accepts a different length', async () => {
    await dealOn('2026-10-17');
    expect(await service.venuesWithNotClosedStreak(clock.now(), 1)).toMatchObject([{ days: ['2026-10-17'] }]);
  });
});

describe('export to chat', () => {
  it('sends a CSV file and then the message with its token', async () => {
    await eclairDeal();
    await service.exportToChat(actor, { from: '2026-10-18', to: '2026-10-18' }, 'csv');
    await background.idle();
    expect(messenger.uploadFile).toHaveBeenCalledWith(expect.any(Buffer), 'report-2026-10-18_2026-10-18.csv');
    expect(messenger.sendToUser).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ fileTokens: ['file-token'] }),
    );
  });

  it('answers 503 while the bot is not running', async () => {
    live = false;
    await expect(
      service.exportToChat(actor, { from: '2026-10-18', to: '2026-10-18' }, 'pdf'),
    ).rejects.toMatchObject({ status: 503, code: 'messenger_unavailable' });
  });
});
