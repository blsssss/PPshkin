import { vi } from 'vitest';
import type { OfferCard } from '../src/bot/guest/offer-card.ts';
import { estimateTarget } from '../src/domain/nutrition/targets.ts';
import type { BehaviorProfile, ProfileReadiness } from '../src/domain/nutrition/profile.ts';
import type { Booking, Deal, MenuItem, Venue } from '../src/domain/models.ts';
import type { BookingsService, BookingView } from '../src/services/bookings.ts';
import type { Insights, InsightsService } from '../src/services/insights.ts';
import type {
  RecommendationsResult,
  RecommendationsService,
  RecommendationStatus,
  RecommendedOffer,
} from '../src/services/recommendations.ts';
import { conflict, notFound } from '../src/shared/errors.ts';
import { guestWorld, type GuestWorld } from './bot.ts';
import { SAMPLE_PNG } from './bookings.ts';
import { sampleDeal, sampleMenuItem, sampleVenue } from './venues.ts';

const HOUR_MS = 3_600_000;
const BOOKING_CODES = ['K7M2QX', 'P3R8TZ', 'W4N6HD', 'Z9Y5LB'];

const DISCLAIMER = 'Калорийность приблизительная, это не медицинская рекомендация';

const croissant: MenuItem = {
  ...sampleMenuItem,
  id: 12,
  name: 'Круассан с миндалём',
  category: 'bakery',
  priceRub: 180,
  kcal: 410,
  tags: ['pastry', 'sweet'],
};

const bakery: Venue = {
  ...sampleVenue,
  id: 8,
  name: 'Пекарня «Колос»',
  address: 'ул. Пушкина, 5',
  category: 'bakery',
  location: { lat: 55.7901, lon: 49.1302 },
};

const salad: MenuItem = {
  ...sampleMenuItem,
  id: 13,
  venueId: bakery.id,
  name: 'Салат с курицей',
  category: 'salad',
  priceRub: 320,
  kcal: 380,
  tags: ['salad', 'poultry', 'high_protein'],
};

function recommendedOffer(overrides: Partial<RecommendedOffer> = {}): RecommendedOffer {
  return {
    offerId: 501,
    item: sampleMenuItem,
    venue: sampleVenue,
    deal: { deal: sampleDeal, item: sampleMenuItem, status: 'active' },
    score: 0.74,
    distanceM: 342,
    priceRub: 130,
    kcal: 330,
    explanation: {
      headline: 'Можно позволить десерт',
      facts: ['Сегодня записано 2 приёма пищи, примерно 900 ккал', 'Вы часто выбираете: десерт, сладкое'],
      calculations: [
        'До ориентира 2000 ккал остаётся около 1100 ккал',
        'Скидка 35%: 130 ₽ вместо 200 ₽, до 14:00',
        'Осталось 3 шт.',
      ],
      assumptions: [DISCLAIMER],
      factors: [],
    },
    ...overrides,
  };
}

export const eclairOffer = recommendedOffer();

export const croissantOffer = recommendedOffer({
  offerId: 502,
  item: croissant,
  deal: null,
  score: 0.61,
  distanceM: 342,
  priceRub: 180,
  kcal: 410,
  explanation: {
    headline: 'Лёгкий перекус',
    facts: ['«Круассан с миндалём» в «Кофейня «Зерно»»: около 410 ккал, оценка по описанию блюда'],
    calculations: ['До ориентира 2000 ккал остаётся около 1100 ккал'],
    assumptions: [DISCLAIMER],
    factors: [],
  },
});

export const saladOffer = recommendedOffer({
  offerId: 503,
  item: salad,
  venue: bakery,
  deal: null,
  score: 0.55,
  distanceM: 1234,
  priceRub: 320,
  kcal: 380,
  explanation: {
    headline: 'Поможет добрать белок',
    facts: ['Сегодня записано 2 приёма пищи, примерно 900 ккал'],
    calculations: ['До ориентира 2000 ккал остаётся около 1100 ккал', 'Около 1,2 км'],
    assumptions: [DISCLAIMER, 'Заведение и меню тестовые'],
    factors: [],
  },
});

export function recommendationsResult(
  status: RecommendationStatus,
  items: RecommendedOffer[] = [],
  remainingKcal = 1100,
): RecommendationsResult {
  return { status, slot: 'snack', remainingKcal, slotBudgetKcal: 300, demoCenterUsed: false, items };
}

export const eclairCard: OfferCard = {
  offerId: 501,
  menuItemId: 11,
  dealId: 21,
  venueId: 7,
  headline: 'Можно позволить десерт',
  itemName: 'Эклер',
  venueName: 'Кофейня «Зерно»',
  venueAddress: 'ул. Баумана, 36',
  location: { lat: 55.7887, lon: 49.1221 },
  priceRub: 130,
  kcal: 330,
  distanceM: 342,
  reasons: ['Сегодня записано 2 приёма пищи, примерно 900 ккал'],
  assumptions: [DISCLAIMER],
  tags: ['dessert', 'sweet'],
};

function behaviorProfile(readiness: ProfileReadiness, mealsUntilReady = 0): BehaviorProfile {
  const slot = { share: 0, averageKcal: null, typicalHour: null };
  return {
    mealsCount: 5 - mealsUntilReady,
    daysTracked: 2,
    readiness,
    mealsUntilReady,
    averageDailyKcal: null,
    tagAffinity: {},
    topTags: [],
    slots: { breakfast: slot, lunch: slot, snack: slot, dinner: slot },
    sweetTooth: { share: 0, typicalHour: null },
    proteinShare: null,
  };
}

export function insightsOf(readiness: ProfileReadiness, mealsUntilReady = 0): Insights {
  return {
    profile: behaviorProfile(readiness, mealsUntilReady),
    today: {
      date: '2026-09-26',
      slot: 'snack',
      targetKcal: 2000,
      totals: { meals: 2, kcalMin: 800, kcalMax: 1000, kcal: 900, proteinG: 40, fatG: 30, carbsG: 95 },
      remainingKcal: 1100,
    },
  };
}

interface Bookable {
  item: MenuItem;
  venue: Venue;
  deal: Deal | null;
}

export interface FakeBookings extends BookingsService {
  views: BookingView[];
}

function fakeBookings(now: () => Date, catalog: readonly Bookable[]): FakeBookings {
  const views: BookingView[] = [];
  const find = (bookingId: number) => {
    const view = views.find(({ booking }) => booking.id === bookingId);
    if (!view) throw notFound('booking_not_found', 'Booking not found');
    return view;
  };
  const active = () => views.filter(({ booking }) => booking.status === 'active');
  const reject = (method: string) => () => Promise.reject(new Error(`bookings.${method} is not stubbed`));

  return {
    views,
    create: vi.fn<BookingsService['create']>(async (userId, input) => {
      await Promise.resolve();
      const entry = catalog.find(({ item }) => item.id === input.menuItemId);
      if (!entry) throw notFound('menu_item_not_found', 'Menu item not found');
      const deal = input.dealId === undefined ? null : entry.deal;
      if (input.dealId !== undefined && deal?.id !== input.dealId)
        throw notFound('deal_not_found', 'No deal');
      if (active().some(({ booking }) => booking.menuItemId === entry.item.id)) {
        throw conflict('booking_exists', 'Already booked');
      }
      if (deal?.quantityLeft === 0) throw conflict('deal_sold_out', 'Sold out');
      if (active().length >= 3) throw conflict('too_many_bookings', 'Too many');
      const createdAt = now();
      const booking: Booking = {
        id: 31 + views.length,
        userId,
        venueId: entry.venue.id,
        menuItemId: entry.item.id,
        dealId: deal?.id ?? null,
        offerId: input.offerId ?? null,
        code: BOOKING_CODES[views.length % BOOKING_CODES.length] ?? 'K7M2QX',
        itemName: entry.item.name,
        priceRub: deal?.priceRub ?? entry.item.priceRub,
        kcal: entry.item.kcal,
        status: 'active',
        expiresAt: new Date(createdAt.getTime() + HOUR_MS),
        createdAt,
        resolvedAt: null,
      };
      const view = { booking, item: entry.item, venue: entry.venue };
      views.push(view);
      return view;
    }),
    list: vi.fn<BookingsService['list']>((_userId, status) =>
      Promise.resolve(
        status === 'active'
          ? active()
          : views
              .filter(({ booking }) => booking.status !== 'active')
              .toSorted(
                (left, right) => right.booking.createdAt.getTime() - left.booking.createdAt.getTime(),
              ),
      ),
    ),
    get: vi.fn<BookingsService['get']>((_userId, bookingId) => Promise.resolve().then(() => find(bookingId))),
    qr: vi.fn<BookingsService['qr']>((_userId, bookingId) =>
      Promise.resolve().then(() => {
        find(bookingId);
        return SAMPLE_PNG;
      }),
    ),
    cancel: vi.fn<BookingsService['cancel']>((_userId, bookingId) =>
      Promise.resolve().then(() => {
        const view = find(bookingId);
        if (view.booking.status !== 'active') throw conflict('booking_not_active', 'Not active');
        view.booking = { ...view.booking, status: 'cancelled', resolvedAt: now() };
        return view;
      }),
    ),
    listForVenue: reject('listForVenue'),
    redeem: reject('redeem'),
    expireDue: reject('expireDue'),
  };
}

export interface OffersWorld extends GuestWorld {
  recommend: ReturnType<typeof vi.fn<RecommendationsService['recommend']>>;
  decline: ReturnType<typeof vi.fn<RecommendationsService['decline']>>;
  insights: ReturnType<typeof vi.fn<InsightsService['get']>>;
  bookings: FakeBookings;
}

export function offersWorld(options: { now?: string; offers?: RecommendedOffer[] } = {}): OffersWorld {
  const offers = options.offers ?? [eclairOffer, croissantOffer, saladOffer];
  const recommend = vi.fn<RecommendationsService['recommend']>(() =>
    Promise.resolve(recommendationsResult('ok', offers)),
  );
  const decline = vi.fn<RecommendationsService['decline']>(() => Promise.resolve());
  const insights = vi.fn<InsightsService['get']>(() => Promise.resolve(insightsOf('ready')));
  const catalog = offers.map(({ item, venue, deal }) => ({ item, venue, deal: deal?.deal ?? null }));
  const bookings = fakeBookings(() => world.clock.now(), catalog);
  const world = guestWorld({
    now: options.now,
    services: {
      recommendations: { recommend, decline },
      insights: { get: insights, estimateTarget },
      bookings,
    },
  });
  world.consent('personal_data');
  return Object.assign(world, { recommend, decline, insights, bookings });
}
