import { vi } from 'vitest';
import { normalizeBookingCode } from '../src/domain/bookings.ts';
import type { Booking, Deal, MenuImport, MenuItem, ParsedMenuItem, Venue } from '../src/domain/models.ts';
import type { VenueAnalytics } from '../src/services/analytics.ts';
import type { BookingView } from '../src/services/bookings.ts';
import { dealStatus, type DealView } from '../src/services/deals.ts';
import type { Services } from '../src/services/index.ts';
import { byMenuOrder } from '../src/services/menu.ts';
import { venueNotFound } from '../src/services/venues.ts';
import type { Clock } from '../src/shared/clock.ts';
import { conflict, notFound, unprocessable } from '../src/shared/errors.ts';
import { addDays, localDate } from '../src/shared/time.ts';
import { botChat, GUEST_ID, guestWorld, type ChatOptions, type Outgoing } from './bot.ts';
import { sampleMenuItem, sampleVenue } from './venues.ts';

export const OWNER_ID = GUEST_ID;
export const VENUE_NOW = '2026-09-26T09:00:00Z';

type VenueServices = Pick<Services, 'venues' | 'menu' | 'menuImports' | 'deals' | 'bookings' | 'analytics'>;

export interface Recognized {
  status: 'ready' | 'failed';
  items: ParsedMenuItem[];
  error: string | null;
  afterMs: number;
}

export function parsedItem(overrides: Partial<ParsedMenuItem> = {}): ParsedMenuItem {
  return {
    name: 'Эклер',
    description: null,
    category: 'dessert',
    priceRub: 200,
    weightG: 80,
    kcal: 330,
    proteinG: 5,
    fatG: 18,
    carbsG: 38,
    tags: ['dessert'],
    ...overrides,
  };
}

export function analyticsFor(overrides: Partial<VenueAnalytics> = {}): VenueAnalytics {
  return {
    from: '2026-09-26',
    to: '2026-09-26',
    timezone: 'Europe/Moscow',
    offersShown: 42,
    offersAccepted: 9,
    bookingsCreated: 9,
    bookingsRedeemed: 7,
    bookingsExpired: 1,
    bookingsCancelled: 1,
    acceptRate: 0.21,
    redeemRate: 0.78,
    revenueRub: 1540,
    surplusUnitsSold: 5,
    surplusRevenueRub: 600,
    topItems: [
      { menuItemId: 11, name: 'Эклер', redeemed: 3, revenueRub: 360 },
      { menuItemId: 12, name: 'Капучино', redeemed: 2, revenueRub: 360 },
    ],
    byDay: [],
    ...overrides,
  };
}

export function venueFake(clock: Clock) {
  let sequence = 100;
  const nextId = () => {
    sequence += 1;
    return sequence;
  };
  const state = {
    venue: null as Venue | null,
    items: [] as MenuItem[],
    deals: [] as Deal[],
    imports: [] as MenuImport[],
    bookings: [] as Booking[],
    analytics: analyticsFor(),
    recognition: {
      status: 'ready',
      items: [parsedItem()],
      error: null,
      afterMs: 15_000,
    } as Recognized,
  };
  const scripts = new Map<number, Recognized>();

  const ownVenue = (ownerId: number): Venue => {
    if (state.venue?.ownerId !== ownerId) throw venueNotFound();
    return state.venue;
  };

  const dealView = (deal: Deal): DealView => {
    const item = state.items.find((candidate) => candidate.id === deal.menuItemId);
    if (!item) throw new Error(`Deal ${deal.id} has no menu item`);
    return { deal: { ...deal }, item: { ...item }, status: dealStatus(deal, clock.now()) };
  };

  const isLive = (deal: Deal) =>
    deal.cancelledAt === null && deal.quantityLeft > 0 && deal.endsAt > clock.now();

  const bookingView = (booking: Booking): BookingView => {
    const item = state.items.find((candidate) => candidate.id === booking.menuItemId);
    if (!item || !state.venue) throw new Error(`Booking ${booking.id} has no item or venue`);
    return { booking: { ...booking }, item: { ...item }, venue: { ...state.venue } };
  };

  const settleImport = (menuImport: MenuImport): MenuImport => {
    const script = scripts.get(menuImport.id);
    if (menuImport.status !== 'processing' || !script) return menuImport;
    if (clock.now().getTime() < menuImport.createdAt.getTime() + script.afterMs) return menuImport;
    Object.assign(menuImport, {
      status: script.status,
      items: script.items,
      error: script.error,
      completedAt: clock.now(),
    });
    return menuImport;
  };

  const startImport = async (ownerId: number, source: MenuImport['source']): Promise<MenuImport> => {
    const venue = ownVenue(ownerId);
    await Promise.resolve();
    const menuImport: MenuImport = {
      id: nextId(),
      venueId: venue.id,
      source,
      status: 'processing',
      items: [],
      error: null,
      model: null,
      createdAt: clock.now(),
      completedAt: null,
    };
    state.imports.push(menuImport);
    scripts.set(menuImport.id, state.recognition);
    return { ...menuImport };
  };

  const findImport = (ownerId: number, importId: number): MenuImport => {
    const venue = ownVenue(ownerId);
    const found = state.imports.find(
      (candidate) => candidate.id === importId && candidate.venueId === venue.id,
    );
    if (!found) throw notFound('import_not_found', 'Menu import not found');
    return settleImport(found);
  };

  const services: VenueServices = {
    venues: {
      get: vi.fn((ownerId: number) => Promise.resolve().then(() => ({ ...ownVenue(ownerId) }))),
      create: vi.fn<VenueServices['venues']['create']>(async (ownerId, input) => {
        await Promise.resolve();
        if (state.venue) throw conflict('venue_exists', 'You already have a venue');
        state.venue = {
          ...sampleVenue,
          id: nextId(),
          ownerId,
          name: input.name,
          address: input.address,
          category: input.category,
          location: input.location,
          opensAt: input.opensAt ?? '08:00',
          closesAt: input.closesAt ?? '22:00',
          timezone: input.timezone ?? 'Europe/Moscow',
        };
        return { ...state.venue };
      }),
      update: () => Promise.reject(new Error('venues.update is not stubbed')),
    },
    menu: {
      list: vi.fn(async (ownerId: number) => {
        const venue = ownVenue(ownerId);
        await Promise.resolve();
        return state.items
          .filter((item) => item.venueId === venue.id && item.archivedAt === null)
          .sort(byMenuOrder)
          .map((item) => ({ ...item }));
      }),
      create: () => Promise.reject(new Error('menu.create is not stubbed')),
      update: () => Promise.reject(new Error('menu.update is not stubbed')),
      archive: () => Promise.reject(new Error('menu.archive is not stubbed')),
    },
    menuImports: {
      fromPhoto: vi.fn((ownerId: number) => startImport(ownerId, 'photo')),
      fromText: vi.fn((ownerId: number) => startImport(ownerId, 'text')),
      get: vi.fn((ownerId: number, importId: number) =>
        Promise.resolve().then(() => ({ ...findImport(ownerId, importId) })),
      ),
      apply: vi.fn<VenueServices['menuImports']['apply']>(async (ownerId, importId, items) => {
        await Promise.resolve();
        const found = findImport(ownerId, importId);
        if (found.status === 'applied') throw conflict('import_already_applied', 'Already applied');
        if (found.status !== 'ready') throw conflict('import_not_ready', 'Not ready');
        found.status = 'applied';
        return items.map((item) => fake.seedItem({ ...item, nutritionSource: 'estimate' }));
      }),
    },
    deals: {
      list: vi.fn(async (ownerId: number) => {
        const venue = ownVenue(ownerId);
        await Promise.resolve();
        return state.deals
          .filter((deal) => deal.venueId === venue.id && isLive(deal))
          .sort((left, right) => left.endsAt.getTime() - right.endsAt.getTime())
          .map(dealView);
      }),
      create: vi.fn<VenueServices['deals']['create']>(async (ownerId, input) => {
        const venue = ownVenue(ownerId);
        await Promise.resolve();
        const item = state.items.find((candidate) => candidate.id === input.menuItemId);
        if (item?.venueId !== venue.id) throw notFound('menu_item_not_found', 'Menu item not found');
        if (!item.isAvailable) throw unprocessable('menu_item_unavailable', 'Hidden');
        if (input.priceRub >= item.priceRub) throw unprocessable('deal_price_not_lower', 'Not lower');
        const now = clock.now();
        if (input.endsAt <= now || input.endsAt.getTime() > now.getTime() + 86_400_000) {
          throw unprocessable('deal_window_invalid', 'Bad window');
        }
        if (state.deals.some((deal) => deal.menuItemId === item.id && isLive(deal))) {
          throw conflict('deal_exists', 'Deal exists');
        }
        const deal = fake.seedDeal(item, {
          priceRub: input.priceRub,
          quantityTotal: input.quantity,
          quantityLeft: input.quantity,
          endsAt: input.endsAt,
        });
        return dealView(deal);
      }),
      update: () => Promise.reject(new Error('deals.update is not stubbed')),
      cancel: vi.fn(async (ownerId: number, dealId: number) => {
        const venue = ownVenue(ownerId);
        await Promise.resolve();
        const deal = state.deals.find(
          (candidate) => candidate.id === dealId && candidate.venueId === venue.id,
        );
        if (!deal) throw notFound('deal_not_found', 'Deal not found');
        if (isLive(deal)) deal.cancelledAt = clock.now();
      }),
    },
    bookings: {
      create: () => Promise.reject(new Error('bookings.create is not stubbed')),
      list: () => Promise.reject(new Error('bookings.list is not stubbed')),
      get: () => Promise.reject(new Error('bookings.get is not stubbed')),
      qr: () => Promise.reject(new Error('bookings.qr is not stubbed')),
      cancel: () => Promise.reject(new Error('bookings.cancel is not stubbed')),
      listForVenue: vi.fn(async (ownerId: number) => {
        const venue = ownVenue(ownerId);
        await Promise.resolve();
        return state.bookings
          .filter((booking) => booking.venueId === venue.id && booking.status === 'active')
          .map(bookingView);
      }),
      redeem: vi.fn(async (ownerId: number, input: string) => {
        const venue = ownVenue(ownerId);
        await Promise.resolve();
        const code = normalizeBookingCode(input);
        const booking = state.bookings.findLast(
          (candidate) => candidate.code === code && candidate.venueId === venue.id,
        );
        if (!booking) throw notFound('booking_not_found', 'Booking not found');
        if (booking.status === 'expired') throw conflict('booking_expired', 'Expired');
        if (booking.status !== 'active') throw conflict('booking_not_active', 'Not active');
        if (booking.expiresAt <= clock.now()) {
          booking.status = 'expired';
          throw conflict('booking_expired', 'Expired');
        }
        booking.status = 'redeemed';
        booking.resolvedAt = clock.now();
        return bookingView(booking);
      }),
      expireDue: () => Promise.resolve([]),
    },
    analytics: {
      get: vi.fn<VenueServices['analytics']['get']>(async (ownerId, period) => {
        const venue = ownVenue(ownerId);
        await Promise.resolve();
        const to = period.to ?? localDate(clock.now(), venue.timezone);
        return { ...state.analytics, from: period.from ?? addDays(to, -6), to };
      }),
    },
  };

  const fake = {
    state,
    services,
    seedVenue(overrides: Partial<Venue> = {}): Venue {
      state.venue = { ...sampleVenue, ownerId: OWNER_ID, ...overrides };
      return state.venue;
    },
    seedItem(overrides: Partial<MenuItem> = {}): MenuItem {
      const item: MenuItem = {
        ...sampleMenuItem,
        id: nextId(),
        venueId: state.venue?.id ?? sampleVenue.id,
        ...overrides,
      };
      state.items.push(item);
      return item;
    },
    seedDeal(item: MenuItem, overrides: Partial<Deal> = {}): Deal {
      const now = clock.now();
      const deal: Deal = {
        id: nextId(),
        venueId: item.venueId,
        menuItemId: item.id,
        priceRub: Math.round(item.priceRub * 0.6),
        quantityTotal: 5,
        quantityLeft: 3,
        startsAt: now,
        endsAt: new Date(now.getTime() + 3 * 3_600_000),
        cancelledAt: null,
        createdAt: now,
        ...overrides,
      };
      state.deals.push(deal);
      return deal;
    },
    seedBooking(item: MenuItem, overrides: Partial<Booking> = {}): Booking {
      const now = clock.now();
      const booking: Booking = {
        id: nextId(),
        userId: 303,
        venueId: item.venueId,
        menuItemId: item.id,
        dealId: null,
        offerId: null,
        code: 'K7M2QX',
        itemName: item.name,
        priceRub: 120,
        kcal: item.kcal,
        status: 'active',
        expiresAt: new Date(now.getTime() + 40 * 60_000),
        createdAt: now,
        resolvedAt: null,
        ...overrides,
      };
      state.bookings.push(booking);
      return booking;
    },
  };
  return fake;
}

export type VenueFake = ReturnType<typeof venueFake>;

export function venueChat(options: Omit<ChatOptions, 'world'> & { now?: string } = {}) {
  const world = guestWorld({ now: options.now ?? VENUE_NOW });
  world.consent('personal_data');
  const fake = venueFake(world.clock);
  Object.assign(world.services, fake.services);
  return { ...botChat({ ...options, world }), fake };
}

export type VenueChat = ReturnType<typeof venueChat>;

export async function withBackground(chat: VenueChat, replies: Promise<Outgoing[]>): Promise<Outgoing[]> {
  const direct = await replies;
  await chat.background.idle();
  return [...direct, ...chat.takeOutgoing()];
}
