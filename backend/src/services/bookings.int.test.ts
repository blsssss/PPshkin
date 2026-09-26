import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedBooking, seedGuest } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { decodeQrPng } from '../../test/qr.ts';
import { seedDeal, seedMenuItem, seedUser, seedVenue } from '../../test/venues.ts';
import { qrPayload } from '../domain/bookings.ts';
import type { Deal, MenuItem, Venue } from '../domain/models.ts';
import type { Notifier } from '../ports/notifier.ts';
import * as deals from '../repositories/deals.ts';
import * as meals from '../repositories/meals.ts';
import * as offers from '../repositories/offers.ts';
import * as users from '../repositories/users.ts';
import * as venues from '../repositories/venues.ts';
import { createBackgroundTasks, type BackgroundTasks } from '../shared/background.ts';
import { createBookingsService, type BookingsDependencies, type BookingsService } from './bookings.ts';
import { createConsentsService } from './consents.ts';
import { createMenuService } from './menu.ts';

const pool = testPool();
const START = '2026-09-25T09:00:00Z';
const clock = fixedClock(START);
const consents = createConsentsService({ pool, clock });
const menu = createMenuService({ pool, clock });

const OWNER = 202;
const OTHER_OWNER = 303;
const GUEST = 101;
const SECOND_GUEST = 102;
const THIRD_GUEST = 103;
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;

const notifier = {
  bookingCreated: vi.fn<Notifier['bookingCreated']>(() => Promise.resolve()),
  bookingCancelled: vi.fn<Notifier['bookingCancelled']>(() => Promise.resolve()),
  bookingRedeemed: vi.fn<Notifier['bookingRedeemed']>(() => Promise.resolve()),
  bookingExpired: vi.fn<Notifier['bookingExpired']>(() => Promise.resolve()),
} satisfies Notifier;
const logger = { error: vi.fn() };

let background: BackgroundTasks;
let service: BookingsService;
let venue: Venue;
let eclair: MenuItem;
let tart: MenuItem;
let deal: Deal;

const later = (ms: number) => new Date(clock.now().getTime() + ms);

function createService(overrides: Partial<BookingsDependencies> = {}): BookingsService {
  return createBookingsService({ pool, clock, consents, notifier, background, ...overrides });
}

async function quantityLeft(dealId: number): Promise<number> {
  const { rows } = await pool.query<{ quantity_left: number }>(
    'select quantity_left from deals where id = $1',
    [dealId],
  );
  return rows[0]?.quantity_left ?? -1;
}

async function storedStatus(bookingId: number) {
  const { rows } = await pool.query<{ status: string; resolved_at: Date | null }>(
    'select status, resolved_at from bookings where id = $1',
    [bookingId],
  );
  return rows[0];
}

async function offerState(offerId: number) {
  const { rows } = await pool.query<{
    status: string;
    decline_reason: string | null;
    responded_at: Date | null;
  }>('select status, decline_reason, responded_at from offers where id = $1', [offerId]);
  return rows[0];
}

const diaryOf = (userId: number) => meals.listSince(pool, userId, new Date(0));

async function showOffer(userId: number, item: MenuItem): Promise<number> {
  const [offer] = await offers.insertShown(pool, {
    userId,
    channel: 'miniapp',
    shownAt: clock.now(),
    offers: [
      {
        venueId: item.venueId,
        menuItemId: item.id,
        dealId: null,
        score: 0.5,
        explanation: {
          headline: 'Можно позволить десерт',
          facts: [],
          calculations: [],
          assumptions: [],
          factors: [],
        },
      },
    ],
  });
  if (!offer) throw new Error('Offer was not stored');
  return offer.id;
}

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set(START);
  vi.clearAllMocks();
  background = createBackgroundTasks(logger);
  service = createService();
  venue = await seedVenue(pool, OWNER);
  eclair = await seedMenuItem(pool, venue.id, { name: 'Эклер', priceRub: 200, kcal: 330, carbsG: 38 });
  tart = await seedMenuItem(pool, venue.id, { name: 'Тарт', priceRub: 250, kcal: 410, tags: ['berries'] });
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

describe('creating bookings', () => {
  it('reserves a portion of a hot deal at the deal price for an hour', async () => {
    const view = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    expect(view.booking).toMatchObject({
      userId: GUEST,
      venueId: venue.id,
      menuItemId: eclair.id,
      dealId: deal.id,
      offerId: null,
      itemName: 'Эклер',
      priceRub: 130,
      kcal: 330,
      status: 'active',
      expiresAt: later(HOUR),
      createdAt: clock.now(),
      resolvedAt: null,
    });
    expect(view.booking.code).toMatch(CODE);
    expect(view.item).toEqual(eclair);
    expect(view.venue).toEqual(venue);
    expect(await quantityLeft(deal.id)).toBe(1);
    await background.idle();
    expect(notifier.bookingCreated).toHaveBeenCalledExactlyOnceWith({ booking: view.booking, venue });
  });

  it('books at the menu price without a deal and keeps the deal stock', async () => {
    const view = await service.create(GUEST, { menuItemId: eclair.id });
    expect(view.booking).toMatchObject({ dealId: null, priceRub: 200, expiresAt: later(HOUR) });
    expect(await quantityLeft(deal.id)).toBe(2);
  });

  it('ends the booking with the deal and before the venue closes', async () => {
    const short = await seedDeal(pool, tart, {
      quantity: 3,
      startsAt: later(-HOUR),
      endsAt: later(25 * MINUTE),
    });
    const withDeal = await service.create(GUEST, { menuItemId: tart.id, dealId: short.id });
    expect(withDeal.booking.expiresAt).toEqual(later(25 * MINUTE));

    clock.set('2026-09-25T18:30:00Z');
    const beforeClosing = await service.create(SECOND_GUEST, { menuItemId: eclair.id });
    expect(beforeClosing.booking.expiresAt).toEqual(new Date('2026-09-25T19:00:00Z'));
  });

  it('keeps the price and calories of the moment of booking', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: tart.id });
    await menu.update(OWNER, tart.id, { name: 'Тарт с малиной', priceRub: 280, kcal: 450 });
    const view = await service.get(GUEST, booking.id);
    expect(view.booking).toMatchObject({ itemName: 'Тарт', priceRub: 250, kcal: 410 });
    expect(view.item).toMatchObject({ name: 'Тарт с малиной', priceRub: 280, kcal: 450 });
  });

  it('needs an available item on the menu of an open venue', async () => {
    await expect(service.create(GUEST, { menuItemId: 999_999 })).rejects.toMatchObject({
      status: 404,
      code: 'menu_item_not_found',
    });
    await menu.update(OWNER, tart.id, { isAvailable: false });
    await expect(service.create(GUEST, { menuItemId: tart.id })).rejects.toMatchObject({
      status: 422,
      code: 'menu_item_unavailable',
    });
    await menu.archive(OWNER, tart.id);
    await expect(service.create(GUEST, { menuItemId: tart.id })).rejects.toMatchObject({
      status: 404,
      code: 'menu_item_not_found',
    });
    clock.set('2026-09-25T19:00:00Z');
    await expect(service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id })).rejects.toMatchObject({
      status: 409,
      code: 'venue_closed',
    });
    expect(await quantityLeft(deal.id)).toBe(2);
  });

  it('only books a running deal of the same item', async () => {
    const foreignVenue = await seedVenue(pool, OTHER_OWNER);
    const foreignItem = await seedMenuItem(pool, foreignVenue.id);
    const foreignDeal = await seedDeal(pool, foreignItem, { startsAt: later(-HOUR), endsAt: later(HOUR) });
    const tartDeal = await seedDeal(pool, tart, { startsAt: later(-HOUR), endsAt: later(HOUR) });
    for (const dealId of [999_999, foreignDeal.id, tartDeal.id]) {
      await expect(service.create(GUEST, { menuItemId: eclair.id, dealId })).rejects.toMatchObject({
        status: 404,
        code: 'deal_not_found',
      });
    }
    const scheduled = await seedDeal(pool, tart, { startsAt: later(HOUR), endsAt: later(2 * HOUR) });
    const ended = await seedDeal(pool, tart, { startsAt: later(-2 * HOUR), endsAt: later(-SECOND) });
    const cancelled = await seedDeal(pool, tart, { startsAt: later(-HOUR), endsAt: later(HOUR) });
    await deals.cancelLiveInVenue(pool, venue.id, cancelled.id, clock.now());
    for (const dealId of [scheduled.id, ended.id, cancelled.id]) {
      await expect(service.create(GUEST, { menuItemId: tart.id, dealId })).rejects.toMatchObject({
        status: 409,
        code: 'deal_not_active',
      });
    }
  });

  it('keeps one active booking per guest and item', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    for (const input of [{ menuItemId: eclair.id, dealId: deal.id }, { menuItemId: eclair.id }]) {
      await expect(service.create(GUEST, input)).rejects.toMatchObject({
        status: 409,
        code: 'booking_exists',
      });
    }
    expect(await quantityLeft(deal.id)).toBe(1);
    await service.create(SECOND_GUEST, { menuItemId: eclair.id, dealId: deal.id });
    await service.cancel(GUEST, booking.id);
    expect((await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id })).booking.priceRub).toBe(
      130,
    );
  });

  it('sells no more portions than the deal has', async () => {
    await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    await service.create(SECOND_GUEST, { menuItemId: eclair.id, dealId: deal.id });
    await expect(
      service.create(THIRD_GUEST, { menuItemId: eclair.id, dealId: deal.id }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'deal_sold_out',
    });
    await expect(service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id })).rejects.toMatchObject({
      code: 'booking_exists',
    });
    expect(await quantityLeft(deal.id)).toBe(0);
    expect((await service.create(THIRD_GUEST, { menuItemId: eclair.id })).booking.priceRub).toBe(200);
  });

  it('allows at most 3 active bookings', async () => {
    const coffee = await seedMenuItem(pool, venue.id, { name: 'Капучино', category: 'drink' });
    const bun = await seedMenuItem(pool, venue.id, { name: 'Булочка', category: 'bakery' });
    await service.create(GUEST, { menuItemId: tart.id });
    await service.create(GUEST, { menuItemId: coffee.id });
    const { booking } = await service.create(GUEST, { menuItemId: bun.id });
    await expect(service.create(GUEST, { menuItemId: eclair.id })).rejects.toMatchObject({
      status: 409,
      code: 'too_many_bookings',
    });
    await deals.update(pool, deal.id, { quantityLeft: 0, endsAt: deal.endsAt });
    await expect(service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id })).rejects.toMatchObject({
      code: 'deal_sold_out',
    });
    await service.cancel(GUEST, booking.id);
    expect((await service.create(GUEST, { menuItemId: eclair.id })).booking.status).toBe('active');
  });

  it('releases expired bookings of the guest before checking the limits', async () => {
    const coffee = await seedMenuItem(pool, venue.id, { name: 'Капучино', category: 'drink' });
    const first = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    await service.create(GUEST, { menuItemId: tart.id });
    await service.create(GUEST, { menuItemId: coffee.id });
    clock.advance(HOUR);
    const again = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    expect(again.booking.status).toBe('active');
    expect(await storedStatus(first.booking.id)).toEqual({ status: 'expired', resolved_at: clock.now() });
    expect(await quantityLeft(deal.id)).toBe(1);
    await background.idle();
    expect(notifier.bookingExpired).toHaveBeenCalledTimes(3);
  });

  it('accepts the offer the guest booked from, even a declined one', async () => {
    const offerId = await showOffer(GUEST, eclair);
    const declinedId = await showOffer(GUEST, tart);
    await offers.decline(pool, { id: declinedId, userId: GUEST, reason: 'not_today', at: clock.now() });
    clock.advance(MINUTE);

    const fromOffer = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id, offerId });
    expect(fromOffer.booking.offerId).toBe(offerId);
    expect(await offerState(offerId)).toEqual({
      status: 'accepted',
      decline_reason: null,
      responded_at: clock.now(),
    });

    await service.create(GUEST, { menuItemId: tart.id, offerId: declinedId });
    expect(await offerState(declinedId)).toEqual({
      status: 'accepted',
      decline_reason: null,
      responded_at: clock.now(),
    });
  });

  it('accepts only an offer of the same guest and item and leaves nothing behind otherwise', async () => {
    const othersOffer = await showOffer(SECOND_GUEST, eclair);
    const tartOffer = await showOffer(GUEST, tart);
    for (const offerId of [999_999, othersOffer, tartOffer]) {
      await expect(
        service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id, offerId }),
      ).rejects.toMatchObject({ status: 404, code: 'offer_not_found' });
    }
    expect(await quantityLeft(deal.id)).toBe(2);
    expect(await service.list(GUEST, 'active')).toEqual([]);
    expect((await offerState(othersOffer))?.status).toBe('shown');
  });

  it('needs the personal data consent and an existing account', async () => {
    await seedUser(pool, 104);
    await expect(service.create(104, { menuItemId: eclair.id })).rejects.toMatchObject({
      status: 403,
      code: 'consent_required',
    });
    const consented = createService({ consents: { requirePersonalData: () => Promise.resolve() } });
    await expect(consented.create(999, { menuItemId: eclair.id })).rejects.toMatchObject({
      status: 404,
      code: 'user_not_found',
    });
  });

  it('picks another code when the generated one is taken in the venue', async () => {
    await seedBooking(pool, { userId: SECOND_GUEST, item: tart, code: 'TAKEN2', createdAt: clock.now() });
    await seedBooking(pool, {
      userId: SECOND_GUEST,
      item: eclair,
      code: 'REUSE2',
      status: 'redeemed',
      createdAt: later(-HOUR),
    });
    const foreignItem = await seedMenuItem(pool, (await seedVenue(pool, OTHER_OWNER)).id);
    await seedBooking(pool, {
      userId: SECOND_GUEST,
      item: foreignItem,
      code: 'THERE2',
      createdAt: clock.now(),
    });
    const generateCode = vi
      .fn<() => string>()
      .mockReturnValueOnce('TAKEN2')
      .mockReturnValueOnce('FRESH2')
      .mockReturnValueOnce('REUSE2')
      .mockReturnValueOnce('THERE2');
    const retrying = createService({ generateCode });

    expect((await retrying.create(GUEST, { menuItemId: eclair.id, dealId: deal.id })).booking.code).toBe(
      'FRESH2',
    );
    expect(generateCode).toHaveBeenCalledTimes(2);
    expect((await retrying.create(GUEST, { menuItemId: tart.id })).booking.code).toBe('REUSE2');
    const coffee = await seedMenuItem(pool, venue.id, { name: 'Капучино', category: 'drink' });
    expect((await retrying.create(GUEST, { menuItemId: coffee.id })).booking.code).toBe('THERE2');
  });

  it('gives up after 5 taken codes and rolls everything back', async () => {
    await seedBooking(pool, { userId: SECOND_GUEST, item: tart, code: 'TAKEN2', createdAt: clock.now() });
    const offerId = await showOffer(GUEST, eclair);
    const generateCode = vi.fn(() => 'TAKEN2');
    await expect(
      createService({ generateCode }).create(GUEST, { menuItemId: eclair.id, dealId: deal.id, offerId }),
    ).rejects.toThrow('No free booking code');
    expect(generateCode).toHaveBeenCalledTimes(5);
    expect(await quantityLeft(deal.id)).toBe(2);
    expect((await offerState(offerId))?.status).toBe('shown');
    expect(await service.list(GUEST, 'active')).toEqual([]);
  });
});

describe('expiring bookings', () => {
  it('keeps a booking until the second it expires and then returns the portion', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    clock.set(new Date(booking.expiresAt.getTime() - SECOND));
    expect(await service.expireDue({})).toEqual([]);
    expect((await service.get(GUEST, booking.id)).booking.status).toBe('active');
    expect(await quantityLeft(deal.id)).toBe(1);

    clock.set(booking.expiresAt);
    const expired = await service.expireDue({});
    expect(expired).toEqual([{ ...booking, status: 'expired', resolvedAt: booking.expiresAt }]);
    expect(await quantityLeft(deal.id)).toBe(2);
    await background.idle();
    expect(notifier.bookingExpired).toHaveBeenCalledExactlyOnceWith({ booking: expired[0], venue });
  });

  it('returns the portion only to a live deal and never above its total', async () => {
    const first = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    await deals.update(pool, deal.id, { quantityLeft: 2, endsAt: deal.endsAt });
    const short = await seedDeal(pool, tart, {
      quantity: 2,
      startsAt: later(-HOUR),
      endsAt: later(30 * MINUTE),
    });
    const second = await service.create(GUEST, { menuItemId: tart.id, dealId: short.id });
    const coffee = await seedMenuItem(pool, venue.id, { name: 'Капучино', category: 'drink' });
    const withdrawn = await seedDeal(pool, coffee, {
      quantity: 2,
      startsAt: later(-HOUR),
      endsAt: later(3 * HOUR),
    });
    const third = await service.create(GUEST, { menuItemId: coffee.id, dealId: withdrawn.id });
    await deals.cancelLiveInVenue(pool, venue.id, withdrawn.id, clock.now());

    clock.advance(HOUR);
    const expired = await service.expireDue({ userId: GUEST });
    expect(expired.map((booking) => booking.id)).toEqual([
      first.booking.id,
      second.booking.id,
      third.booking.id,
    ]);
    expect(await quantityLeft(deal.id)).toBe(2);
    expect(await quantityLeft(short.id)).toBe(1);
    expect(await quantityLeft(withdrawn.id)).toBe(1);
  });

  it('expires only the bookings in scope', async () => {
    const foreignVenue = await seedVenue(pool, OTHER_OWNER);
    const foreignItem = await seedMenuItem(pool, foreignVenue.id);
    const own = await service.create(GUEST, { menuItemId: eclair.id });
    const foreign = await service.create(SECOND_GUEST, { menuItemId: foreignItem.id });
    clock.advance(HOUR);
    expect((await service.expireDue({ userId: SECOND_GUEST })).map((booking) => booking.id)).toEqual([
      foreign.booking.id,
    ]);
    expect((await service.expireDue({ venueId: venue.id })).map((booking) => booking.id)).toEqual([
      own.booking.id,
    ]);
    expect(await service.expireDue({})).toEqual([]);
    await background.idle();
    expect(notifier.bookingExpired.mock.calls.map(([notice]) => notice.venue.id)).toEqual([
      foreignVenue.id,
      venue.id,
    ]);
  });
});

describe('guest bookings', () => {
  it('lists active bookings by expiry and finished ones newest first', async () => {
    const short = await seedDeal(pool, tart, {
      quantity: 2,
      startsAt: later(-HOUR),
      endsAt: later(20 * MINUTE),
    });
    const eclairBooking = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    clock.advance(MINUTE);
    const tartBooking = await service.create(GUEST, { menuItemId: tart.id, dealId: short.id });
    expect((await service.list(GUEST, 'active')).map((view) => view.booking.id)).toEqual([
      tartBooking.booking.id,
      eclairBooking.booking.id,
    ]);
    expect(await service.list(SECOND_GUEST, 'active')).toEqual([]);

    clock.advance(20 * MINUTE);
    const active = await service.list(GUEST, 'active');
    expect(active.map((view) => view.booking.id)).toEqual([eclairBooking.booking.id]);
    await service.cancel(GUEST, eclairBooking.booking.id);
    const history = await service.list(GUEST, 'history');
    expect(history.map((view) => [view.booking.id, view.booking.status])).toEqual([
      [tartBooking.booking.id, 'expired'],
      [eclairBooking.booking.id, 'cancelled'],
    ]);
    expect(history[0]).toMatchObject({ item: tart, venue });
  });

  it('keeps the last 50 finished bookings in the history', async () => {
    const oldest = await seedBooking(pool, {
      userId: GUEST,
      item: eclair,
      code: 'AAAAA2',
      status: 'cancelled',
      createdAt: later(-100 * HOUR),
    });
    for (let index = 0; index < 50; index += 1) {
      await seedBooking(pool, {
        userId: GUEST,
        item: eclair,
        code: 'BBBBB2',
        status: 'redeemed',
        createdAt: later(-(index + 1) * HOUR),
      });
    }
    const history = await service.list(GUEST, 'history');
    expect(history).toHaveLength(50);
    expect(history.map((view) => view.booking.id)).not.toContain(oldest);
  });

  it('shows a booking only to its guest and marks it expired when its time is up', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    for (const attempt of [
      () => service.get(SECOND_GUEST, booking.id),
      () => service.qr(SECOND_GUEST, booking.id),
      () => service.cancel(SECOND_GUEST, booking.id),
      () => service.get(GUEST, 999_999),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ status: 404, code: 'booking_not_found' });
    }
    clock.set(booking.expiresAt);
    expect((await service.get(GUEST, booking.id)).booking).toMatchObject({ status: 'expired' });
    expect(await quantityLeft(deal.id)).toBe(2);
  });

  it('renders a scannable QR code with the booking payload', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id });
    const png = await service.qr(GUEST, booking.id);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(await decodeQrPng(png)).toEqual({
      text: qrPayload(booking.code),
      version: 2,
      errorCorrection: 'M',
      quietZoneModules: 2,
      width: 512,
      height: 512,
    });
  });
});

describe('cancelling bookings', () => {
  it('cancels an active booking and returns the portion', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    clock.advance(10 * MINUTE);
    const view = await service.cancel(GUEST, booking.id);
    expect(view.booking).toEqual({ ...booking, status: 'cancelled', resolvedAt: clock.now() });
    expect(await quantityLeft(deal.id)).toBe(2);
    await background.idle();
    expect(notifier.bookingCancelled).toHaveBeenCalledExactlyOnceWith({ booking: view.booking, venue });
  });

  it('refuses bookings that are no longer active', async () => {
    const cancelled = await service.create(GUEST, { menuItemId: eclair.id });
    await service.cancel(GUEST, cancelled.booking.id);
    const redeemed = await service.create(GUEST, { menuItemId: tart.id });
    await service.redeem(OWNER, redeemed.booking.code);
    for (const id of [cancelled.booking.id, redeemed.booking.id]) {
      await expect(service.cancel(GUEST, id)).rejects.toMatchObject({
        status: 409,
        code: 'booking_not_active',
      });
    }
  });

  it('expires a booking whose time is up instead of cancelling it', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    clock.set(booking.expiresAt);
    await expect(service.cancel(GUEST, booking.id)).rejects.toMatchObject({
      status: 409,
      code: 'booking_expired',
    });
    expect(await storedStatus(booking.id)).toEqual({ status: 'expired', resolved_at: booking.expiresAt });
    expect(await quantityLeft(deal.id)).toBe(2);
    await expect(service.cancel(GUEST, booking.id)).rejects.toMatchObject({ code: 'booking_expired' });
    await background.idle();
    expect(notifier.bookingExpired).toHaveBeenCalledTimes(1);
    expect(notifier.bookingCancelled).not.toHaveBeenCalled();
  });
});

describe('redeeming bookings', () => {
  it('redeems the scanned QR code and logs the dish in the guest diary', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    clock.advance(15 * MINUTE);
    const view = await service.redeem(OWNER, ` ${qrPayload(booking.code).toLowerCase()} `);
    expect(view.booking).toEqual({ ...booking, status: 'redeemed', resolvedAt: clock.now() });
    expect(await quantityLeft(deal.id)).toBe(1);
    expect(await diaryOf(GUEST)).toEqual([
      expect.objectContaining({
        title: 'Эклер',
        kcalMin: 297,
        kcalMax: 363,
        proteinG: 5,
        fatG: 18,
        carbsG: 38,
        tags: ['dessert', 'sweet'],
        source: 'booking',
        confidence: null,
        eatenAt: clock.now(),
      }),
    ]);
    await background.idle();
    expect(notifier.bookingRedeemed).toHaveBeenCalledExactlyOnceWith({ booking: view.booking, venue });
  });

  it('redeems a booking only once', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id });
    await service.redeem(OWNER, booking.code);
    await expect(service.redeem(OWNER, booking.code)).rejects.toMatchObject({
      status: 409,
      code: 'booking_not_active',
    });
    expect(await diaryOf(GUEST)).toHaveLength(1);
  });

  it('refuses expired and cancelled bookings', async () => {
    const expiring = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    const cancelled = await service.create(GUEST, { menuItemId: tart.id });
    await service.cancel(GUEST, cancelled.booking.id);
    clock.set(expiring.booking.expiresAt);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(service.redeem(OWNER, expiring.booking.code)).rejects.toMatchObject({
        status: 409,
        code: 'booking_expired',
      });
    }
    expect(await storedStatus(expiring.booking.id)).toEqual({
      status: 'expired',
      resolved_at: expiring.booking.expiresAt,
    });
    expect(await quantityLeft(deal.id)).toBe(2);
    await expect(service.redeem(OWNER, cancelled.booking.code)).rejects.toMatchObject({
      status: 409,
      code: 'booking_not_active',
    });
    expect(await diaryOf(GUEST)).toEqual([]);
  });

  it('finds codes only among the bookings of the own venue', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id });
    await seedVenue(pool, OTHER_OWNER);
    for (const [ownerId, code] of [
      [OTHER_OWNER, booking.code],
      [OWNER, 'ZZZZZ9'],
      [OWNER, 'not a code'],
      [OWNER, `ppshkin:order:${booking.code}`],
    ] as const) {
      await expect(service.redeem(ownerId, code)).rejects.toMatchObject({
        status: 404,
        code: 'booking_not_found',
      });
    }
    await expect(service.redeem(THIRD_GUEST, booking.code)).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
  });

  it('takes the latest booking with the code', async () => {
    const old = await seedBooking(pool, {
      userId: SECOND_GUEST,
      item: tart,
      code: 'ABC234',
      status: 'redeemed',
      createdAt: later(-2 * HOUR),
    });
    const generateCode = vi.fn(() => 'ABC234');
    const { booking } = await createService({ generateCode }).create(GUEST, { menuItemId: eclair.id });
    const view = await service.redeem(OWNER, 'abc 234');
    expect(view.booking.id).toBe(booking.id);
    expect(view.booking.id).not.toBe(old);
  });

  it('redeems after the venue closes and the deal is withdrawn', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    await venues.update(pool, venue.id, { opensAt: '06:00', closesAt: '07:00' }, clock.now());
    await deals.cancelLiveInVenue(pool, venue.id, deal.id, clock.now());
    expect((await service.redeem(OWNER, booking.code)).booking.status).toBe('redeemed');
  });

  it('keeps no diary entry for a deleted account', async () => {
    const { booking } = await service.create(GUEST, { menuItemId: eclair.id });
    await users.remove(pool, GUEST);
    const view = await service.redeem(OWNER, booking.code);
    expect(view.booking).toMatchObject({ status: 'redeemed', userId: null });
    const { rows } = await pool.query('select id from meals');
    expect(rows).toEqual([]);
  });
});

describe('venue bookings', () => {
  it('lists active bookings of the own venue by expiry', async () => {
    const short = await seedDeal(pool, tart, {
      quantity: 2,
      startsAt: later(-HOUR),
      endsAt: later(30 * MINUTE),
    });
    const first = await service.create(GUEST, { menuItemId: eclair.id });
    const second = await service.create(SECOND_GUEST, { menuItemId: tart.id, dealId: short.id });
    const foreignItem = await seedMenuItem(pool, (await seedVenue(pool, OTHER_OWNER)).id);
    await service.create(THIRD_GUEST, { menuItemId: foreignItem.id });
    const listed = await service.listForVenue(OWNER, { status: 'active' });
    expect(listed.map((view) => view.booking.id)).toEqual([second.booking.id, first.booking.id]);
    expect(listed[0]).toMatchObject({ item: tart, venue });
  });

  it('lists finished bookings of the last 7 days, latest first', async () => {
    await seedBooking(pool, {
      userId: GUEST,
      item: eclair,
      code: 'AAAAA2',
      status: 'redeemed',
      createdAt: later(-8 * 24 * HOUR),
    });
    const cancelled = await seedBooking(pool, {
      userId: GUEST,
      item: eclair,
      code: 'BBBBB2',
      status: 'cancelled',
      createdAt: later(-6 * 24 * HOUR),
    });
    const redeemed = await seedBooking(pool, {
      userId: null,
      item: tart,
      code: 'CCCCC2',
      status: 'redeemed',
      createdAt: later(-HOUR),
    });
    const due = await service.create(SECOND_GUEST, { menuItemId: eclair.id });
    clock.advance(HOUR);
    const history = await service.listForVenue(OWNER, { status: 'history' });
    expect(history.map((view) => [view.booking.id, view.booking.status])).toEqual([
      [due.booking.id, 'expired'],
      [redeemed, 'redeemed'],
      [cancelled, 'cancelled'],
    ]);
    expect(await service.listForVenue(OWNER, { status: 'active' })).toEqual([]);
  });

  it('keeps the venue history to 100 bookings', async () => {
    for (let index = 0; index < 101; index += 1) {
      await seedBooking(pool, {
        userId: GUEST,
        item: eclair,
        code: 'DDDDD2',
        status: 'redeemed',
        createdAt: later(-(index + 1) * MINUTE),
      });
    }
    expect(await service.listForVenue(OWNER, { status: 'history' })).toHaveLength(100);
  });

  it('filters by the local day the booking was created', async () => {
    const yekaterinburg = await seedVenue(pool, OTHER_OWNER, { timezone: 'Asia/Yekaterinburg' });
    const pie = await seedMenuItem(pool, yekaterinburg.id, { name: 'Пирог' });
    const lateEvening = await seedBooking(pool, {
      userId: GUEST,
      item: pie,
      code: 'EEEEE2',
      status: 'redeemed',
      createdAt: new Date('2026-09-23T18:59:00Z'),
    });
    const afterMidnight = await seedBooking(pool, {
      userId: GUEST,
      item: pie,
      code: 'FFFFF2',
      status: 'cancelled',
      createdAt: new Date('2026-09-23T19:00:00Z'),
    });
    const active = await seedBooking(pool, {
      userId: SECOND_GUEST,
      item: pie,
      code: 'GGGGG2',
      createdAt: new Date('2026-09-25T08:30:00Z'),
    });
    const byDay = async (status: 'active' | 'history', date: string) =>
      (await service.listForVenue(OTHER_OWNER, { status, date })).map((view) => view.booking.id);
    expect(await byDay('history', '2026-09-23')).toEqual([lateEvening]);
    expect(await byDay('history', '2026-09-24')).toEqual([afterMidnight]);
    expect(await byDay('active', '2026-09-25')).toEqual([active]);
    expect(await byDay('active', '2026-09-24')).toEqual([]);
  });

  it('needs a valid date and a venue', async () => {
    await expect(service.listForVenue(OWNER, { status: 'active', date: '2026-02-30' })).rejects.toMatchObject(
      {
        status: 400,
        code: 'validation_failed',
      },
    );
    await expect(service.listForVenue(GUEST, { status: 'active' })).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
  });
});
