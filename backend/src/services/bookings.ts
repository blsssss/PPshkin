import QRCode, { type QRCodeToBufferOptions } from 'qrcode';
import { withTransaction, type Pool, type Queryable } from '../db/pool.ts';
import {
  bookingExpiresAt,
  bookingMeal,
  generateBookingCode,
  MAX_ACTIVE_BOOKINGS,
  normalizeBookingCode,
  qrPayload,
} from '../domain/bookings.ts';
import type { Booking, Deal, MenuItem, Venue } from '../domain/models.ts';
import type { BookingNotice, Notifier } from '../ports/notifier.ts';
import * as bookings from '../repositories/bookings.ts';
import * as deals from '../repositories/deals.ts';
import * as meals from '../repositories/meals.ts';
import * as menuItems from '../repositories/menu-items.ts';
import * as offers from '../repositories/offers.ts';
import * as venues from '../repositories/venues.ts';
import type { BackgroundTasks } from '../shared/background.ts';
import type { Clock } from '../shared/clock.ts';
import { badRequest, conflict, notFound, unprocessable } from '../shared/errors.ts';
import { dayRange, isLocalDate, isOpenAt } from '../shared/time.ts';
import type { ConsentsService } from './consents.ts';
import { lockMenuItem } from './menu.ts';
import { requireOwnedVenue } from './venues.ts';

export const BOOKING_LIST_FILTERS = ['active', 'history'] as const;
export type BookingListFilter = (typeof BOOKING_LIST_FILTERS)[number];

export const GUEST_HISTORY_LIMIT = 50;
export const VENUE_HISTORY_LIMIT = 100;
export const VENUE_HISTORY_DAYS = 7;

export interface BookingView {
  booking: Booking;
  item: MenuItem;
  venue: Venue;
}

export type ExpireScope = bookings.BookingScope;

export interface BookingInput {
  menuItemId: number;
  dealId?: number;
  offerId?: number;
}

export interface VenueBookingsQuery {
  status: BookingListFilter;
  date?: string;
}

export interface BookingsService {
  create(userId: number, input: BookingInput): Promise<BookingView>;
  list(userId: number, status: BookingListFilter): Promise<BookingView[]>;
  get(userId: number, bookingId: number): Promise<BookingView>;
  qr(userId: number, bookingId: number): Promise<Buffer>;
  cancel(userId: number, bookingId: number): Promise<BookingView>;
  listForVenue(ownerId: number, query: VenueBookingsQuery): Promise<BookingView[]>;
  redeem(ownerId: number, code: string): Promise<BookingView>;
  expireDue(scope: ExpireScope): Promise<Booking[]>;
}

export interface BookingsDependencies {
  pool: Pool;
  clock: Clock;
  consents: Pick<ConsentsService, 'requirePersonalData'>;
  notifier: Notifier;
  background: BackgroundTasks;
  generateCode?: () => string;
}

type NoticeKind = keyof Notifier;

const CODE_ATTEMPTS = 5;
const DAY_MS = 86_400_000;
const QR_PNG: QRCodeToBufferOptions = { type: 'png', width: 512, margin: 2, errorCorrectionLevel: 'M' };

const bookingNotFound = () => notFound('booking_not_found', 'Booking not found');
const bookingExpired = () => conflict('booking_expired', 'The booking has expired, the portion is released');
const bookingNotActive = () => conflict('booking_not_active', 'The booking is already redeemed or cancelled');

function dealRunning(deal: Deal, now: Date): boolean {
  return deal.cancelledAt === null && deal.startsAt <= now && deal.endsAt > now;
}

async function lockBookableItem(db: Queryable, itemId: number): Promise<MenuItem> {
  const [found] = await menuItems.findByIds(db, [itemId]);
  if (!found) throw notFound('menu_item_not_found', 'Menu item not found');
  const item = await lockMenuItem(db, found.venueId, found.id);
  if (!item.isAvailable) {
    throw unprocessable('menu_item_unavailable', 'The venue has hidden this item from guests');
  }
  return item;
}

async function lockBookableDeal(db: Queryable, item: MenuItem, dealId: number, now: Date): Promise<Deal> {
  const deal = await deals.lockInVenue(db, item.venueId, dealId);
  if (deal?.menuItemId !== item.id) throw notFound('deal_not_found', 'Deal not found');
  if (!dealRunning(deal, now)) {
    throw conflict('deal_not_active', 'The deal is cancelled, over or has not started yet');
  }
  return deal;
}

async function bookingViews(db: Queryable, list: readonly Booking[]): Promise<BookingView[]> {
  const [items, places] = await Promise.all([
    menuItems.findByIds(db, [...new Set(list.map((booking) => booking.menuItemId))]),
    venues.findByIds(db, [...new Set(list.map((booking) => booking.venueId))]),
  ]);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const venuesById = new Map(places.map((venue) => [venue.id, venue]));
  return list.map((booking) => {
    const item = itemsById.get(booking.menuItemId);
    const venue = venuesById.get(booking.venueId);
    if (!item || !venue) throw new Error(`Booking ${booking.id} refers to a missing menu item or venue`);
    return { booking, item, venue };
  });
}

async function bookingView(db: Queryable, booking: Booking): Promise<BookingView> {
  const [view] = await bookingViews(db, [booking]);
  if (!view) throw new Error(`Booking ${booking.id} has no view`);
  return view;
}

export function createBookingsService({
  pool,
  clock,
  consents,
  notifier,
  background,
  generateCode = generateBookingCode,
}: BookingsDependencies): BookingsService {
  const notify = (kind: NoticeKind, notice: BookingNotice) => {
    background.run(`${kind}-${notice.booking.id}`, () => notifier[kind](notice));
  };

  async function expire(scope: ExpireScope): Promise<Booking[]> {
    const expired = await bookings.expireDue(pool, scope, clock.now());
    if (expired.length === 0) return expired;
    const places = await venues.findByIds(pool, [...new Set(expired.map((booking) => booking.venueId))]);
    for (const booking of expired) {
      const venue = places.find((place) => place.id === booking.venueId);
      if (venue) notify('bookingExpired', { booking, venue });
    }
    return expired;
  }

  async function reserve(
    client: Queryable,
    userId: number,
    input: BookingInput,
    now: Date,
  ): Promise<BookingView> {
    if (!(await bookings.lockUser(client, userId))) throw notFound('user_not_found', 'User not found');
    const item = await lockBookableItem(client, input.menuItemId);
    const venue = await venues.findById(client, item.venueId);
    if (!venue) throw new Error(`Menu item ${item.id} refers to a missing venue`);
    if (!isOpenAt(venue.opensAt, venue.closesAt, now, venue.timezone)) {
      throw conflict('venue_closed', 'The venue is closed now');
    }
    const deal = input.dealId === undefined ? null : await lockBookableDeal(client, item, input.dealId, now);
    const activeItems = await bookings.listActiveItemIds(client, userId);
    if (activeItems.includes(item.id)) {
      throw conflict('booking_exists', 'You already have an active booking of this item');
    }
    if (deal?.quantityLeft === 0) throw conflict('deal_sold_out', 'The deal is sold out');
    if (activeItems.length >= MAX_ACTIVE_BOOKINGS) {
      throw conflict('too_many_bookings', `You can hold at most ${MAX_ACTIVE_BOOKINGS} active bookings`);
    }
    if (input.offerId !== undefined) {
      const accepted = await offers.accept(client, {
        id: input.offerId,
        userId,
        menuItemId: item.id,
        at: now,
      });
      if (!accepted) throw notFound('offer_not_found', 'Offer not found');
    }
    if (deal) {
      await deals.update(client, deal.id, { quantityLeft: deal.quantityLeft - 1, endsAt: deal.endsAt });
    }
    const fields = {
      userId,
      venueId: venue.id,
      menuItemId: item.id,
      dealId: deal?.id ?? null,
      offerId: input.offerId ?? null,
      itemName: item.name,
      priceRub: deal?.priceRub ?? item.priceRub,
      kcal: item.kcal,
      expiresAt: bookingExpiresAt({ now, dealEndsAt: deal?.endsAt ?? null, venue }),
      createdAt: now,
    };
    for (let attempt = 1; attempt <= CODE_ATTEMPTS; attempt += 1) {
      const booking = await bookings.insertIfCodeFree(client, { ...fields, code: generateCode() });
      if (booking) return { booking, item, venue };
    }
    throw new Error(`No free booking code in venue ${venue.id} after ${CODE_ATTEMPTS} attempts`);
  }

  async function settle(
    lock: (client: Queryable) => Promise<Booking | null>,
    complete: (client: Queryable, booking: Booking, now: Date) => Promise<BookingView>,
    kind: 'bookingCancelled' | 'bookingRedeemed',
  ): Promise<BookingView> {
    const now = clock.now();
    const { view, expired } = await withTransaction(pool, async (client) => {
      const booking = await lock(client);
      if (!booking) throw bookingNotFound();
      if (booking.status === 'expired') throw bookingExpired();
      if (booking.status !== 'active') throw bookingNotActive();
      if (booking.expiresAt <= now) {
        const released = await bookings.release(client, booking.id, 'expired', now);
        return { view: await bookingView(client, released), expired: true };
      }
      return { view: await complete(client, booking, now), expired: false };
    });
    notify(expired ? 'bookingExpired' : kind, { booking: view.booking, venue: view.venue });
    if (expired) throw bookingExpired();
    return view;
  }

  return {
    async create(userId, input) {
      await consents.requirePersonalData(userId);
      await expire({ userId });
      const now = clock.now();
      const view = await withTransaction(pool, (client) => reserve(client, userId, input, now));
      notify('bookingCreated', { booking: view.booking, venue: view.venue });
      return view;
    },

    async list(userId, status) {
      await expire({ userId });
      const found =
        status === 'active'
          ? await bookings.listActiveForUser(pool, userId)
          : await bookings.listFinishedForUser(pool, userId, GUEST_HISTORY_LIMIT);
      return bookingViews(pool, found);
    },

    async get(userId, bookingId) {
      await expire({ userId });
      const booking = await bookings.findForUser(pool, userId, bookingId);
      if (!booking) throw bookingNotFound();
      return bookingView(pool, booking);
    },

    async qr(userId, bookingId) {
      const booking = await bookings.findForUser(pool, userId, bookingId);
      if (!booking) throw bookingNotFound();
      return QRCode.toBuffer(qrPayload(booking.code), QR_PNG);
    },

    cancel(userId, bookingId) {
      return settle(
        (client) => bookings.lockForUser(client, userId, bookingId),
        async (client, booking, now) =>
          bookingView(client, await bookings.release(client, booking.id, 'cancelled', now)),
        'bookingCancelled',
      );
    },

    async listForVenue(ownerId, { status, date }) {
      if (date !== undefined && !isLocalDate(date)) {
        throw badRequest('validation_failed', 'Request validation failed', [
          { path: 'date', message: 'must be a calendar date in YYYY-MM-DD format' },
        ]);
      }
      const venue = await requireOwnedVenue(pool, ownerId);
      await expire({ venueId: venue.id });
      const created = date === undefined ? null : dayRange(date, venue.timezone);
      const found =
        status === 'active'
          ? await bookings.listActiveInVenue(pool, venue.id, created)
          : await bookings.listFinishedInVenue(
              pool,
              venue.id,
              {
                created,
                resolvedSince: created ? null : new Date(clock.now().getTime() - VENUE_HISTORY_DAYS * DAY_MS),
              },
              VENUE_HISTORY_LIMIT,
            );
      return bookingViews(pool, found);
    },

    async redeem(ownerId, input) {
      const venue = await requireOwnedVenue(pool, ownerId);
      const code = normalizeBookingCode(input);
      if (code === null) throw bookingNotFound();
      return settle(
        (client) => bookings.lockLatestByCode(client, venue.id, code),
        async (client, booking, now) => {
          const redeemed = await bookings.markRedeemed(client, booking.id, now);
          const view = await bookingView(client, redeemed);
          if (redeemed.userId !== null) {
            await meals.insert(client, {
              ...bookingMeal(redeemed, view.item),
              userId: redeemed.userId,
              source: 'booking',
              confidence: null,
              eatenAt: now,
            });
          }
          return view;
        },
        'bookingRedeemed',
      );
    },

    expireDue: expire,
  };
}
