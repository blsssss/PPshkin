import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { BAUMANA, KREMLIN, seedDeal, seedMenuItem, seedUser, seedVenue } from '../../test/venues.ts';
import type { Deal, GeoPoint, MenuItem, Venue } from '../domain/models.ts';
import type { Tag } from '../domain/vocabulary.ts';
import * as deals from '../repositories/deals.ts';
import * as meals from '../repositories/meals.ts';
import * as menuItems from '../repositories/menu-items.ts';
import { distanceMeters } from '../shared/geo.ts';
import {
  createRecommendationsService,
  type RecommendationRequest,
  type RecommendationsResult,
} from './recommendations.ts';

const NOW = '2026-09-26T13:00:00Z';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const GUEST = 101;
const OTHER = 102;
const AIRPORT: GeoPoint = { lat: 55.6064, lon: 49.2786 };

const pool = testPool();
const clock = fixedClock(NOW);
const service = createRecommendationsService({ pool, clock });

interface World {
  zerno: Venue;
  kremlin: Venue;
  airport: Venue;
  cheesecake: MenuItem;
  cappuccino: MenuItem;
  eclair: MenuItem;
  croissant: MenuItem;
  cheesecakeDeal: Deal;
}

const at = (iso: string) => new Date(iso);
const later = (ms: number) => new Date(new Date(NOW).getTime() + ms);

const request = (overrides: Partial<RecommendationRequest> = {}): RecommendationRequest => ({
  location: BAUMANA,
  limit: 10,
  channel: 'miniapp',
  ...overrides,
});

const names = (result: RecommendationsResult) => result.items.map((offer) => offer.item.name);

async function logMeal(eatenAt: Date, title: string, kcal: number, tags: Tag[] = []) {
  await meals.insert(pool, {
    userId: GUEST,
    title,
    kcalMin: kcal,
    kcalMax: kcal,
    proteinG: null,
    fatG: null,
    carbsG: null,
    tags,
    source: 'manual',
    confidence: null,
    eatenAt,
  });
}

async function seedHistory() {
  await logMeal(at('2026-09-24T06:00:00Z'), 'Овсянка', 350, ['breakfast', 'grain']);
  await logMeal(at('2026-09-24T13:00:00Z'), 'Эклер', 300, ['dessert', 'sweet']);
  await logMeal(at('2026-09-25T10:00:00Z'), 'Суп', 400, ['soup']);
  await logMeal(at('2026-09-25T13:30:00Z'), 'Чизкейк', 350, ['dessert', 'sweet']);
  await logMeal(at('2026-09-26T06:00:00Z'), 'Сырники', 450, ['breakfast', 'dairy']);
}

async function seedWorld(): Promise<World> {
  const zerno = await seedVenue(pool, 1, { name: 'Зерно', location: BAUMANA });
  const kremlin = await seedVenue(pool, 2, { name: 'Кремлёвская', location: KREMLIN });
  const airport = await seedVenue(pool, 3, { name: 'Аэропорт', location: AIRPORT });
  const cheesecake = await seedMenuItem(pool, zerno.id, {
    name: 'Чизкейк',
    priceRub: 250,
    kcal: 320,
    tags: ['dessert', 'sweet'],
  });
  const cappuccino = await seedMenuItem(pool, zerno.id, {
    name: 'Капучино',
    category: 'drink',
    priceRub: 180,
    kcal: 120,
    tags: ['coffee', 'drink'],
  });
  const eclair = await seedMenuItem(pool, kremlin.id, {
    name: 'Эклер',
    tags: ['dessert', 'sweet', 'pastry'],
  });
  const croissant = await seedMenuItem(pool, airport.id, {
    name: 'Круассан',
    category: 'bakery',
    kcal: 280,
    tags: ['pastry', 'bread'],
  });
  const cheesecakeDeal = await seedDeal(pool, cheesecake, {
    priceRub: 160,
    startsAt: later(-HOUR),
    endsAt: at('2026-09-26T15:00:00Z'),
  });
  return { zerno, kremlin, airport, cheesecake, cappuccino, eclair, croissant, cheesecakeDeal };
}

async function seedTwins(): Promise<[MenuItem, MenuItem]> {
  const venue = await seedVenue(pool, 1, { name: 'Зерно', location: BAUMANA });
  const twin = { category: 'drink', priceRub: 120, kcal: 150, tags: ['drink', 'juice'] } as const;
  const mors = await seedMenuItem(pool, venue.id, { name: 'Морс', ...twin, tags: [...twin.tags] });
  const kompot = await seedMenuItem(pool, venue.id, { name: 'Компот', ...twin, tags: [...twin.tags] });
  return [mors, kompot];
}

async function storedOffers() {
  const { rows } = await pool.query<Record<string, unknown>>(
    `select id, user_id, venue_id, menu_item_id, deal_id, channel, score, explanation, status, decline_reason,
            created_at, responded_at
       from offers order by id`,
  );
  return rows;
}

async function queriesDuring(run: () => Promise<unknown>): Promise<number> {
  const spy = vi.spyOn(pool, 'query');
  try {
    await run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set(NOW);
  await seedUser(pool, GUEST);
  await seedUser(pool, OTHER);
});

afterAll(async () => {
  await closeTestPool();
});

describe('recommendations', () => {
  it('asks for a first meal while the diary of the last 14 days is empty and stores no offers', async () => {
    await seedWorld();
    const empty = {
      status: 'profile_empty',
      slot: 'snack',
      remainingKcal: 2000,
      slotBudgetKcal: 200,
      items: [],
    };
    expect(await service.recommend(GUEST, request())).toEqual(empty);
    await logMeal(later(-15 * DAY), 'Старый ужин', 600);
    expect(await service.recommend(GUEST, request())).toEqual(empty);
    expect(await storedOffers()).toEqual([]);
  });

  it('stores every recommendation as a shown offer and returns its id', async () => {
    const world = await seedWorld();
    await seedHistory();
    const result = await service.recommend(GUEST, request({ limit: 3, channel: 'bot' }));

    expect(result).toMatchObject({ status: 'ok', slot: 'snack', remainingKcal: 1550, slotBudgetKcal: 200 });
    expect(result.items).toHaveLength(3);
    expect(await storedOffers()).toEqual(
      result.items.map((offer) => ({
        id: offer.offerId,
        user_id: GUEST,
        venue_id: offer.venue.id,
        menu_item_id: offer.item.id,
        deal_id: offer.deal?.deal.id ?? null,
        channel: 'bot',
        score: offer.score,
        explanation: offer.explanation,
        status: 'shown',
        decline_reason: null,
        created_at: new Date(NOW),
        responded_at: null,
      })),
    );
    const scores = result.items.map((offer) => offer.score);
    expect(scores).toEqual(scores.toSorted((left, right) => right - left));

    const cheesecake = result.items.find((offer) => offer.item.id === world.cheesecake.id);
    expect(cheesecake).toMatchObject({
      venue: world.zerno,
      deal: { deal: world.cheesecakeDeal, item: world.cheesecake, status: 'active' },
      priceRub: 160,
      kcal: 320,
      distanceM: 0,
    });
    expect(cheesecake?.explanation).toMatchObject({
      headline: 'Можно позволить десерт',
      facts: expect.arrayContaining(['Сегодня записано 1 приём пищи, примерно 450 ккал']) as string[],
      calculations: [
        'До ориентира 2000 ккал остаётся около 1550 ккал',
        'Идти около 50 м',
        'Скидка 36%: 160 ₽ вместо 250 ₽, до 18:00',
        'Осталось 5 шт.',
      ],
      assumptions: ['Калорийность приблизительная, это не медицинская рекомендация'],
    });
    expect(cheesecake?.explanation.factors.map(({ factor }) => factor)).toEqual([
      'fit',
      'taste',
      'habit',
      'macros',
      'proximity',
      'deal',
      'novelty',
    ]);
  });

  it('reports a spent daily budget without offers', async () => {
    await seedWorld();
    await seedHistory();
    await logMeal(later(-HOUR), 'Бизнес-ланч', 1500, ['hearty']);
    expect(await service.recommend(GUEST, request())).toEqual({
      status: 'budget_exhausted',
      slot: 'snack',
      remainingKcal: 50,
      slotBudgetKcal: 50,
      items: [],
    });
    expect(await storedOffers()).toEqual([]);
  });

  it('reports that nothing fits when every venue is closed', async () => {
    await seedWorld();
    await seedHistory();
    clock.set('2026-09-26T19:30:00Z');
    expect(await service.recommend(GUEST, request())).toEqual({
      status: 'nothing_fits',
      slot: 'dinner',
      remainingKcal: 1550,
      slotBudgetKcal: 600,
      items: [],
    });
    expect(await storedOffers()).toEqual([]);
  });

  it('searches within 5 km of the requested point', async () => {
    const world = await seedWorld();
    await seedHistory();
    await seedUser(pool, GUEST, KREMLIN);
    const result = await service.recommend(GUEST, request({ location: BAUMANA }));
    expect(names(result).toSorted()).toEqual(['Капучино', 'Чизкейк', 'Эклер']);
    const distances = Object.fromEntries(result.items.map((offer) => [offer.item.name, offer.distanceM]));
    expect(distances).toEqual({
      Чизкейк: 0,
      Капучино: 0,
      Эклер: Math.round(distanceMeters(BAUMANA, world.kremlin.location)),
    });
  });

  it('falls back to the saved location of the guest', async () => {
    const world = await seedWorld();
    await seedHistory();
    await seedUser(pool, GUEST, KREMLIN);
    const result = await service.recommend(GUEST, request({ location: null }));
    const distances = Object.fromEntries(result.items.map((offer) => [offer.item.name, offer.distanceM]));
    expect(distances).toEqual({
      Чизкейк: Math.round(distanceMeters(KREMLIN, world.zerno.location)),
      Капучино: Math.round(distanceMeters(KREMLIN, world.zerno.location)),
      Эклер: 0,
    });
  });

  it('searches every venue without distances when no location is known', async () => {
    await seedWorld();
    await seedHistory();
    const result = await service.recommend(GUEST, request({ location: null }));
    expect(names(result).toSorted()).toEqual(['Капучино', 'Круассан', 'Чизкейк', 'Эклер']);
    expect(result.items.map((offer) => offer.distanceM)).toEqual([null, null, null, null]);
    const routeLines = result.items
      .flatMap((offer) => offer.explanation.calculations)
      .filter((line) => /^(Идти|Около) /.test(line));
    expect(routeLines).toEqual([]);
  });

  it('attaches only a live deal and never offers hidden or archived items', async () => {
    const world = await seedWorld();
    await seedHistory();
    await seedDeal(pool, world.cappuccino, { startsAt: later(-3 * HOUR), endsAt: later(-HOUR) });
    const cancelled = await seedDeal(pool, world.cappuccino, { startsAt: later(-HOUR), endsAt: later(HOUR) });
    await deals.cancelLiveInVenue(pool, world.zerno.id, cancelled.id, later(-HOUR / 2));
    await seedDeal(pool, world.eclair, { startsAt: later(HOUR), endsAt: later(2 * HOUR) });
    const hidden = await seedMenuItem(pool, world.zerno.id, { name: 'Тирамису', isAvailable: false });
    await seedDeal(pool, hidden, { startsAt: later(-HOUR), endsAt: later(HOUR) });
    const archived = await seedMenuItem(pool, world.zerno.id, { name: 'Штрудель' });
    await menuItems.archive(pool, archived.id, later(-DAY));

    const result = await service.recommend(GUEST, request());
    const dealIds = Object.fromEntries(
      result.items.map((offer) => [offer.item.name, offer.deal?.deal.id ?? null]),
    );
    expect(dealIds).toEqual({ Чизкейк: world.cheesecakeDeal.id, Капучино: null, Эклер: null });
    const prices = Object.fromEntries(result.items.map((offer) => [offer.item.name, offer.priceRub]));
    expect(prices).toEqual({ Чизкейк: 160, Капучино: 180, Эклер: 200 });
  });

  it('moves an item already offered today below the others', async () => {
    await seedTwins();
    await seedHistory();
    const first = await service.recommend(GUEST, request({ limit: 1 }));
    expect(names(first)).toEqual(['Морс']);

    const second = await service.recommend(GUEST, request({ limit: 2 }));
    expect(names(second)).toEqual(['Компот', 'Морс']);
    const [fresh, repeated] = second.items;
    expect(repeated?.explanation.factors).toContainEqual({ factor: 'novelty', value: -1, weight: 0.2 });
    expect(fresh?.explanation.factors).toContainEqual({ factor: 'novelty', value: 0, weight: 0.2 });
    expect(fresh!.score - repeated!.score).toBeCloseTo(0.2, 4);

    clock.set(later(DAY));
    expect(names(await service.recommend(GUEST, request({ limit: 1 })))).toEqual(['Морс']);
  });

  it('hides an item for 3 days after not today and for 30 days after dislike', async () => {
    await seedTwins();
    await seedHistory();
    const shown = await service.recommend(GUEST, request({ limit: 2 }));
    const offerOf = (name: string) => shown.items.find((offer) => offer.item.name === name)!.offerId;
    await service.decline(GUEST, offerOf('Морс'), 'not_today');
    await service.decline(GUEST, offerOf('Компот'), 'dislike');

    const visibleAt = async (moment: Date) => {
      clock.set(moment);
      await logMeal(new Date(moment.getTime() - 2 * HOUR), 'Салат', 300, ['salad']);
      return names(await service.recommend(GUEST, request({ limit: 2 }))).toSorted();
    };
    expect(await visibleAt(later(0))).toEqual([]);
    expect(await visibleAt(later(3 * DAY - HOUR))).toEqual([]);
    expect(await visibleAt(later(3 * DAY))).toEqual(['Морс']);
    expect(await visibleAt(later(30 * DAY - HOUR))).toEqual(['Морс']);
    expect(await visibleAt(later(30 * DAY))).toEqual(['Компот', 'Морс']);
  });

  it('loads everything with the same eight queries however many venues there are', async () => {
    await seedWorld();
    await seedHistory();
    const few = await queriesDuring(() => service.recommend(GUEST, request({ location: null })));
    for (let owner = 10; owner < 16; owner += 1) {
      const venue = await seedVenue(pool, owner, { name: `Кафе ${owner}` });
      const item = await seedMenuItem(pool, venue.id, { name: `Сэндвич ${owner}`, category: 'snack' });
      await seedMenuItem(pool, venue.id, { name: `Чай ${owner}`, category: 'drink', kcal: 40 });
      await seedDeal(pool, item, { startsAt: later(-HOUR), endsAt: later(HOUR) });
    }
    const many = await queriesDuring(() => service.recommend(GUEST, request({ location: null })));
    expect([few, many]).toEqual([8, 8]);
  });

  it('validates the request and the user', async () => {
    await seedHistory();
    for (const invalid of [{ limit: 0 }, { limit: 11 }, { limit: 2.5 }]) {
      await expect(service.recommend(GUEST, request(invalid))).rejects.toMatchObject({
        status: 400,
        code: 'validation_failed',
        details: [{ path: 'limit' }],
      });
    }
    await expect(
      service.recommend(GUEST, request({ location: { lat: 91, lon: 190 } })),
    ).rejects.toMatchObject({
      status: 400,
      details: [{ path: 'lat' }, { path: 'lon' }],
    });
    await expect(
      service.recommend(GUEST, request({ limit: 0, location: { lat: 55.79, lon: -181 } })),
    ).rejects.toMatchObject({
      status: 400,
      details: [
        { path: 'limit', message: 'must be an integer from 1 to 10' },
        { path: 'lon', message: 'must be from -180 to 180' },
      ],
    });
    await expect(service.recommend(404, request())).rejects.toMatchObject({
      status: 404,
      code: 'user_not_found',
    });
  });
});

describe('declining an offer', () => {
  async function offerFor(userId: number): Promise<number> {
    await seedWorld();
    await seedHistory();
    const [offer] = (await service.recommend(userId, request({ limit: 1 }))).items;
    return offer!.offerId;
  }

  async function offerRow(id: number) {
    const { rows } = await pool.query(
      'select status, decline_reason, responded_at from offers where id = $1',
      [id],
    );
    return rows[0] as unknown;
  }

  it('records the reason and lets the guest change it', async () => {
    const offerId = await offerFor(GUEST);
    await service.decline(GUEST, offerId, 'not_today');
    expect(await offerRow(offerId)).toEqual({
      status: 'declined',
      decline_reason: 'not_today',
      responded_at: new Date(NOW),
    });
    clock.advance(60_000);
    await service.decline(GUEST, offerId, 'dislike');
    expect(await offerRow(offerId)).toEqual({
      status: 'declined',
      decline_reason: 'dislike',
      responded_at: later(60_000),
    });
  });

  it('does not reveal offers of other guests', async () => {
    const offerId = await offerFor(GUEST);
    await expect(service.decline(OTHER, offerId, 'dislike')).rejects.toMatchObject({
      status: 404,
      code: 'offer_not_found',
    });
    await expect(service.decline(GUEST, offerId + 100, 'dislike')).rejects.toMatchObject({
      status: 404,
      code: 'offer_not_found',
    });
    expect(await offerRow(offerId)).toEqual({ status: 'shown', decline_reason: null, responded_at: null });
  });

  it('keeps an offer that already became a booking', async () => {
    const offerId = await offerFor(GUEST);
    await pool.query(`update offers set status = 'accepted', responded_at = $2 where id = $1`, [
      offerId,
      NOW,
    ]);
    await expect(service.decline(GUEST, offerId, 'not_today')).rejects.toMatchObject({
      status: 409,
      code: 'offer_already_accepted',
    });
    expect(await offerRow(offerId)).toEqual({
      status: 'accepted',
      decline_reason: null,
      responded_at: new Date(NOW),
    });
  });
});
