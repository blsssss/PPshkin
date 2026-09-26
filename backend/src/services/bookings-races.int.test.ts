import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedGuest, seedOffer } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { raceBehindLock, waitForLockWaits, type RowLock } from '../../test/locks.ts';
import { seedDeal, seedMenuItem, seedVenue } from '../../test/venues.ts';
import type { Booking, Deal, MenuItem } from '../domain/models.ts';
import type { Notifier } from '../ports/notifier.ts';
import * as deals from '../repositories/deals.ts';
import * as meals from '../repositories/meals.ts';
import * as menuItems from '../repositories/menu-items.ts';
import { createBackgroundTasks, type BackgroundTasks } from '../shared/background.ts';
import { createAccountService } from './account.ts';
import { createBookingsService, type BookingsService } from './bookings.ts';
import { createConsentsService } from './consents.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const consents = createConsentsService({ pool, clock });
const account = createAccountService({ pool, clock });

const OWNER = 202;
const GUEST = 101;
const SECOND_GUEST = 102;
const THIRD_GUEST = 103;
const HOUR = 3_600_000;

const notifier = {
  bookingCreated: vi.fn<Notifier['bookingCreated']>(() => Promise.resolve()),
  bookingCancelled: vi.fn<Notifier['bookingCancelled']>(() => Promise.resolve()),
  bookingRedeemed: vi.fn<Notifier['bookingRedeemed']>(() => Promise.resolve()),
  bookingExpired: vi.fn<Notifier['bookingExpired']>(() => Promise.resolve()),
} satisfies Notifier;

let background: BackgroundTasks;
let service: BookingsService;
let eclair: MenuItem;
let tart: MenuItem;
let deal: Deal;

const later = (ms: number) => new Date(clock.now().getTime() + ms);

const itemLock = (item: MenuItem): RowLock => ({
  text: 'select id from menu_items where id = $1 for update',
  values: [item.id],
});

const bookingLock = (booking: Booking): RowLock => ({
  text: 'select id from bookings where id = $1 for update',
  values: [booking.id],
});

async function quantityLeft(dealId: number): Promise<number> {
  const { rows } = await pool.query<{ quantity_left: number }>(
    'select quantity_left from deals where id = $1',
    [dealId],
  );
  return rows[0]?.quantity_left ?? -1;
}

const afterFirstWaiter =
  <T>(start: () => Promise<T>) =>
  async (): Promise<T> => {
    await waitForLockWaits(pool, 1);
    return start();
  };

async function userExists(userId: number): Promise<boolean> {
  const { rows } = await pool.query('select id from users where id = $1', [userId]);
  return rows.length > 0;
}

async function statusOf(bookingId: number): Promise<string | undefined> {
  const { rows } = await pool.query<{ status: string }>('select status from bookings where id = $1', [
    bookingId,
  ]);
  return rows[0]?.status;
}

function outcomes<T>(results: PromiseSettledResult<T>[]) {
  return {
    fulfilled: results.filter((result) => result.status === 'fulfilled').map((result) => result.value),
    rejected: results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason as unknown),
  };
}

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-25T09:00:00Z');
  vi.clearAllMocks();
  background = createBackgroundTasks({ error: () => undefined });
  service = createBookingsService({ pool, clock, consents, notifier, background });
  const venue = await seedVenue(pool, OWNER);
  eclair = await seedMenuItem(pool, venue.id, { name: 'Эклер', priceRub: 200 });
  tart = await seedMenuItem(pool, venue.id, { name: 'Тарт', priceRub: 250 });
  deal = await seedDeal(pool, eclair, {
    priceRub: 130,
    quantity: 2,
    startsAt: later(-HOUR),
    endsAt: later(3 * HOUR),
  });
  for (const guest of [GUEST, SECOND_GUEST, THIRD_GUEST]) await seedGuest(pool, guest, clock.now());
});

afterAll(async () => {
  await closeTestPool();
});

describe('concurrent bookings', () => {
  it('sells the last portion to exactly one of two guests', async () => {
    await service.create(THIRD_GUEST, { menuItemId: eclair.id, dealId: deal.id });
    const results = await raceBehindLock(pool, itemLock(eclair), [
      () => service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id }),
      () => service.create(SECOND_GUEST, { menuItemId: eclair.id, dealId: deal.id }),
    ]);
    const { fulfilled, rejected } = outcomes(results);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toEqual([expect.objectContaining({ status: 409, code: 'deal_sold_out' })]);
    expect(await quantityLeft(deal.id)).toBe(0);
    const { rows } = await pool.query("select id from bookings where deal_id = $1 and status = 'active'", [
      deal.id,
    ]);
    expect(rows).toHaveLength(2);
  });

  it('turns a double tap into a single booking', async () => {
    for (const input of [{ menuItemId: eclair.id, dealId: deal.id }, { menuItemId: tart.id }]) {
      const results = await raceBehindLock(pool, itemLock(input.menuItemId === eclair.id ? eclair : tart), [
        () => service.create(GUEST, input),
        () => service.create(GUEST, input),
      ]);
      const { fulfilled, rejected } = outcomes(results);
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toEqual([expect.objectContaining({ status: 409, code: 'booking_exists' })]);
    }
    expect(await quantityLeft(deal.id)).toBe(1);
    expect(await service.list(GUEST, 'active')).toHaveLength(2);
  });

  it('keeps the limit of 3 active bookings when a guest books two items at once', async () => {
    const coffee = await seedMenuItem(pool, eclair.venueId, { name: 'Капучино', category: 'drink' });
    const bun = await seedMenuItem(pool, eclair.venueId, { name: 'Булочка', category: 'bakery' });
    await service.create(GUEST, { menuItemId: eclair.id });
    await service.create(GUEST, { menuItemId: tart.id });
    const results = await raceBehindLock(
      pool,
      { text: 'select id from users where id = $1 for update', values: [GUEST] },
      [
        () => service.create(GUEST, { menuItemId: coffee.id }),
        () => service.create(GUEST, { menuItemId: bun.id }),
      ],
    );
    const { fulfilled, rejected } = outcomes(results);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toEqual([expect.objectContaining({ status: 409, code: 'too_many_bookings' })]);
    expect(await service.list(GUEST, 'active')).toHaveLength(3);
  });

  it('never locks the deal before the menu item, so archiving the item cannot deadlock', async () => {
    const results = await raceBehindLock(
      pool,
      itemLock(eclair),
      [() => service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id })],
      async (owner) => {
        await owner.query('select id from deals where id = $1 for update nowait', [deal.id]);
        await menuItems.archive(owner, eclair.id, clock.now());
        await deals.cancelLiveForItem(owner, eclair.id, clock.now());
      },
    );
    expect(results).toHaveLength(1);
    expect(results).toMatchObject([
      { status: 'rejected', reason: { status: 404, code: 'menu_item_not_found' } },
    ]);
    expect(await quantityLeft(deal.id)).toBe(2);
  });
});

describe('account deletion during bookings', () => {
  it('waits for an in-flight booking instead of deadlocking on its deal and offer', async () => {
    const { booking: held } = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    const offerId = await seedOffer(pool, { userId: GUEST, item: tart, createdAt: clock.now() });
    const [created, deleted] = await raceBehindLock<unknown>(pool, itemLock(tart), [
      () => service.create(GUEST, { menuItemId: tart.id, offerId }),
      afterFirstWaiter(() => account.deleteAccount(GUEST)),
    ]);
    expect(created).toMatchObject({ status: 'fulfilled', value: { booking: { status: 'active' } } });
    expect(deleted).toEqual({ status: 'fulfilled', value: undefined });
    expect(await userExists(GUEST)).toBe(false);
    const { rows } = await pool.query<{ id: number; user_id: number | null; status: string }>(
      'select id, user_id, status from bookings order by id',
    );
    expect(rows).toEqual([
      { id: held.id, user_id: null, status: 'cancelled' },
      { id: expect.any(Number) as number, user_id: null, status: 'cancelled' },
    ]);
    expect(await quantityLeft(deal.id)).toBe(2);
    const offer = await pool.query('select user_id, status from offers where id = $1', [offerId]);
    expect(offer.rows).toEqual([{ user_id: null, status: 'accepted' }]);
  });

  it('lets a redemption finish while the guest deletes the account', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    const [redeemed, deleted] = await raceBehindLock<unknown>(pool, bookingLock(booking), [
      () => service.redeem(OWNER, booking.code),
      afterFirstWaiter(() => account.deleteAccount(GUEST)),
    ]);
    expect(redeemed).toMatchObject({ status: 'fulfilled', value: { booking: { status: 'redeemed' } } });
    expect(deleted).toEqual({ status: 'fulfilled', value: undefined });
    expect(await userExists(GUEST)).toBe(false);
    expect(await statusOf(booking.id)).toBe('redeemed');
    expect(await quantityLeft(deal.id)).toBe(1);
  });

  it('answers user_not_found to a booking that waited for the deletion', async () => {
    const results = await raceBehindLock<unknown>(
      pool,
      { text: 'select id from users where id = $1 for no key update', values: [GUEST] },
      [
        () => account.deleteAccount(GUEST),
        afterFirstWaiter(() => service.create(GUEST, { menuItemId: tart.id })),
      ],
    );
    expect(results).toMatchObject([
      { status: 'fulfilled' },
      { status: 'rejected', reason: { status: 404, code: 'user_not_found' } },
    ]);
  });
});

describe('concurrent resolutions', () => {
  it('returns the portion once when cancel and expiry meet', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    clock.set(booking.expiresAt);
    const [cancelled, expired] = await raceBehindLock<unknown>(pool, bookingLock(booking), [
      () => service.cancel(GUEST, booking.id),
      () => service.expireDue({}),
    ]);
    expect(cancelled).toMatchObject({ status: 'rejected', reason: { status: 409, code: 'booking_expired' } });
    expect(expired?.status).toBe('fulfilled');
    expect(await statusOf(booking.id)).toBe('expired');
    expect(await quantityLeft(deal.id)).toBe(2);
    await background.idle();
    expect(notifier.bookingExpired).toHaveBeenCalledTimes(1);
    expect(notifier.bookingCancelled).not.toHaveBeenCalled();
  });

  it('redeems once when two cashiers scan the same code', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    const results = await raceBehindLock(pool, bookingLock(booking), [
      () => service.redeem(OWNER, booking.code),
      () => service.redeem(OWNER, booking.code.toLowerCase()),
    ]);
    const { fulfilled, rejected } = outcomes(results);
    expect(fulfilled.map((view) => view.booking.status)).toEqual(['redeemed']);
    expect(rejected).toEqual([expect.objectContaining({ status: 409, code: 'booking_not_active' })]);
    expect(await meals.listSince(pool, GUEST, new Date(0))).toHaveLength(1);
    expect(await quantityLeft(deal.id)).toBe(1);
  });

  it('lets either cancel or redeem win, never both', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    const results = await raceBehindLock(pool, bookingLock(booking), [
      () => service.cancel(GUEST, booking.id),
      () => service.redeem(OWNER, booking.code),
    ]);
    const { fulfilled, rejected } = outcomes(results);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toEqual([expect.objectContaining({ status: 409, code: 'booking_not_active' })]);
    const diary = await meals.listSince(pool, GUEST, new Date(0));
    if (fulfilled[0]?.booking.status === 'cancelled') {
      expect(diary).toEqual([]);
      expect(await quantityLeft(deal.id)).toBe(2);
    } else {
      expect(await statusOf(booking.id)).toBe('redeemed');
      expect(diary).toHaveLength(1);
      expect(await quantityLeft(deal.id)).toBe(1);
    }
  });

  it('expires every booking once across overlapping scopes', async () => {
    const first = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    await service.create(GUEST, { menuItemId: tart.id });
    await service.create(SECOND_GUEST, { menuItemId: eclair.id, dealId: deal.id });
    clock.advance(HOUR);
    const results = await raceBehindLock(pool, bookingLock(first.booking), [
      () => service.expireDue({ userId: GUEST }),
      () => service.expireDue({}),
    ]);
    const expiredIds = outcomes(results).fulfilled.flatMap((expired) => expired.map((booking) => booking.id));
    expect(expiredIds).toHaveLength(3);
    expect(new Set(expiredIds).size).toBe(3);
    expect(await quantityLeft(deal.id)).toBe(2);
    expect(await service.expireDue({})).toEqual([]);
    await background.idle();
    expect(notifier.bookingExpired).toHaveBeenCalledTimes(3);
  });
});
