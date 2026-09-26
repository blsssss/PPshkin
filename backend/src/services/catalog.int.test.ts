import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import {
  BAUMANA,
  KAZAN_ARENA,
  KREMLIN,
  seedDeal,
  seedMenuItem,
  seedUser,
  seedVenue,
} from '../../test/venues.ts';
import type { GeoPoint, MenuItem, Venue } from '../domain/models.ts';
import * as deals from '../repositories/deals.ts';
import * as menuItems from '../repositories/menu-items.ts';
import { distanceMeters } from '../shared/geo.ts';
import { createCatalogService, type CatalogQuery } from './catalog.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const catalog = createCatalogService({ pool, clock });

const GUEST = 101;
const HOUR = 3_600_000;

const near = (point: GeoPoint | null, radiusM = 3000): CatalogQuery => ({ point, radiusM });
const inHours = (hours: number) => new Date(clock.now().getTime() + hours * HOUR);
const names = (cards: { venue: Venue }[]) => cards.map((card) => card.venue.name);

async function liveDeal(item: MenuItem, endsInHours = 2) {
  return seedDeal(pool, item, { startsAt: clock.now(), endsAt: inHours(endsInHours) });
}

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-25T09:00:00Z');
  await seedUser(pool, GUEST);
});

afterAll(async () => {
  await closeTestPool();
});

describe('nearby venues', () => {
  it('filters by radius and sorts by distance from the given point', async () => {
    await seedVenue(pool, 1, { name: 'Арена', location: KAZAN_ARENA });
    await seedVenue(pool, 2, { name: 'Кремлёвская', location: KREMLIN });
    await seedVenue(pool, 3, { name: 'Зерно', location: BAUMANA });

    const close = await catalog.venues(GUEST, near(BAUMANA));
    expect(names(close)).toEqual(['Зерно', 'Кремлёвская']);
    expect(close.map((card) => card.distanceM)).toEqual([0, Math.round(distanceMeters(BAUMANA, KREMLIN))]);
    expect(close[1]?.distanceM).toBeGreaterThan(1000);
    expect(close[1]?.distanceM).toBeLessThan(1600);

    expect(names(await catalog.venues(GUEST, near(BAUMANA, 1000)))).toEqual(['Зерно']);
    expect(names(await catalog.venues(GUEST, near(BAUMANA, 10_000)))).toEqual([
      'Зерно',
      'Кремлёвская',
      'Арена',
    ]);
    expect(names(await catalog.venues(GUEST, near(KREMLIN, 10_000)))).toEqual([
      'Кремлёвская',
      'Зерно',
      'Арена',
    ]);
  });

  it('falls back to the saved location of the user', async () => {
    await seedVenue(pool, 1, { name: 'Зерно', location: BAUMANA });
    await seedVenue(pool, 2, { name: 'Кремлёвская', location: KREMLIN });
    await seedUser(pool, 102, KREMLIN);
    const cards = await catalog.venues(102, near(null, 1000));
    expect(names(cards)).toEqual(['Кремлёвская']);
    expect(cards[0]?.distanceM).toBe(0);
    expect(names(await catalog.venues(102, near(BAUMANA, 1000)))).toEqual(['Зерно']);
  });

  it('lists every venue without a point, open ones first and then by name', async () => {
    await seedVenue(pool, 1, {
      name: 'Ночной бар',
      location: KAZAN_ARENA,
      opensAt: '20:00',
      closesAt: '02:00',
    });
    await seedVenue(pool, 2, { name: 'Кремлёвская', location: KREMLIN });
    await seedVenue(pool, 3, { name: 'Бублик', location: { lat: 43.1155, lon: 131.8855 } });
    await seedVenue(pool, 4, { name: 'Зерно', location: BAUMANA, opensAt: '00:00', closesAt: '00:00' });
    const cards = await catalog.venues(GUEST, near(null, 100));
    expect(cards.map((card) => [card.venue.name, card.openNow, card.distanceM])).toEqual([
      ['Бублик', true, null],
      ['Зерно', true, null],
      ['Кремлёвская', true, null],
      ['Ночной бар', false, null],
    ]);
  });

  it('tells whether a venue is open, including hours past midnight and round the clock', async () => {
    await seedVenue(pool, 1, { name: 'Ночной бар', opensAt: '20:00', closesAt: '02:00' });
    await seedVenue(pool, 2, { name: 'Круглосуточная', opensAt: '00:00', closesAt: '00:00' });
    await seedVenue(pool, 3, { name: 'Дневная', opensAt: '08:00', closesAt: '22:00' });
    const openAt = async (iso: string) => {
      clock.set(iso);
      const cards = await catalog.venues(GUEST, near(BAUMANA));
      return Object.fromEntries(cards.map((card) => [card.venue.name, card.openNow]));
    };
    expect(await openAt('2026-09-25T20:30:00Z')).toEqual({
      'Ночной бар': true,
      Круглосуточная: true,
      Дневная: false,
    });
    expect(await openAt('2026-09-25T22:59:00Z')).toEqual({
      'Ночной бар': true,
      Круглосуточная: true,
      Дневная: false,
    });
    expect(await openAt('2026-09-25T23:00:00Z')).toEqual({
      'Ночной бар': false,
      Круглосуточная: true,
      Дневная: false,
    });
    expect(await openAt('2026-09-26T05:00:00Z')).toEqual({
      'Ночной бар': false,
      Круглосуточная: true,
      Дневная: true,
    });
  });

  it('counts only deals a guest can book right now', async () => {
    const venue = await seedVenue(pool, 1, { name: 'Зерно' });
    const visible = await seedMenuItem(pool, venue.id, { name: 'Эклер' });
    await liveDeal(visible);
    const hidden = await seedMenuItem(pool, venue.id, { name: 'Скрытый', isAvailable: false });
    await liveDeal(hidden);
    const archived = await seedMenuItem(pool, venue.id, { name: 'Архивный' });
    await liveDeal(archived);
    await menuItems.archive(pool, archived.id, clock.now());
    const extra = await seedMenuItem(pool, venue.id, { name: 'Круассан' });
    const soldOut = await liveDeal(extra);
    await deals.update(pool, soldOut.id, { quantityLeft: 0, endsAt: soldOut.endsAt });
    const cancelled = await liveDeal(extra);
    await deals.cancelInVenue(pool, venue.id, cancelled.id, clock.now());
    await seedDeal(pool, extra, { startsAt: inHours(1), endsAt: inHours(2) });
    await seedDeal(pool, extra, { startsAt: inHours(-2), endsAt: inHours(-1) });
    const other = await seedVenue(pool, 2, { name: 'Пусто', location: KREMLIN });

    const cards = await catalog.venues(GUEST, near(BAUMANA));
    expect(cards.map((card) => [card.venue.id, card.activeDeals])).toEqual([
      [venue.id, 1],
      [other.id, 0],
    ]);
  });

  it('returns at most 50 venues', async () => {
    for (let index = 1; index <= 55; index += 1) {
      await seedVenue(pool, index, {
        name: `Кофейня ${String(index).padStart(2, '0')}`,
        location: { lat: BAUMANA.lat + index / 100_000, lon: BAUMANA.lon },
      });
    }
    const cards = await catalog.venues(GUEST, near(BAUMANA));
    expect(cards).toHaveLength(50);
    expect(cards[49]?.venue.name).toBe('Кофейня 50');
    expect(await catalog.venues(GUEST, near(null))).toHaveLength(50);
  });

  it('finds venues across the antimeridian and near the poles', async () => {
    await seedVenue(pool, 1, { name: 'Восток', location: { lat: 0, lon: 179.999 } });
    await seedVenue(pool, 2, { name: 'Полюс', location: { lat: 89.999, lon: 180 } });
    expect(names(await catalog.venues(GUEST, near({ lat: 0, lon: -179.999 }, 1000)))).toEqual(['Восток']);
    expect(names(await catalog.venues(GUEST, near({ lat: 89.999, lon: 0 }, 1000)))).toEqual(['Полюс']);
  });
});

describe('venue details', () => {
  it('shows the guest menu and the deals that can be booked now', async () => {
    const venue = await seedVenue(pool, 1, { name: 'Зерно' });
    const eclair = await seedMenuItem(pool, venue.id, { name: 'Эклер', category: 'dessert' });
    const soup = await seedMenuItem(pool, venue.id, { name: 'Борщ', category: 'soup' });
    await seedMenuItem(pool, venue.id, { name: 'Скрытый', isAvailable: false });
    const archived = await seedMenuItem(pool, venue.id, { name: 'Архивный' });
    await menuItems.archive(pool, archived.id, clock.now());
    const deal = await liveDeal(eclair);
    await seedDeal(pool, soup, { startsAt: inHours(1), endsAt: inHours(3) });

    const details = await catalog.venue(GUEST, venue.id);
    expect(details.venue).toEqual(venue);
    expect(details.openNow).toBe(true);
    expect(details.menu.map((item) => item.name)).toEqual(['Борщ', 'Эклер']);
    expect(details.deals).toEqual([{ deal, item: eclair, status: 'active' }]);
  });

  it('reports an unknown venue', async () => {
    await expect(catalog.venue(GUEST, 999_999)).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
  });
});

describe('nearby deals', () => {
  it('shows live deals of open venues nearby, ending soonest first, then closest', async () => {
    const baumana = await seedVenue(pool, 1, { name: 'Зерно', location: BAUMANA });
    const kremlin = await seedVenue(pool, 2, { name: 'Кремлёвская', location: KREMLIN });
    const closed = await seedVenue(pool, 3, {
      name: 'Ночной бар',
      location: BAUMANA,
      opensAt: '20:00',
      closesAt: '02:00',
    });
    const far = await seedVenue(pool, 4, { name: 'Арена', location: KAZAN_ARENA });

    const kremlinSoon = await liveDeal(await seedMenuItem(pool, kremlin.id, { name: 'Пирожок' }), 1);
    const baumanaSoon = await liveDeal(await seedMenuItem(pool, baumana.id, { name: 'Эклер' }), 1);
    const baumanaLate = await liveDeal(await seedMenuItem(pool, baumana.id, { name: 'Круассан' }), 3);
    await liveDeal(await seedMenuItem(pool, closed.id, { name: 'Коктейль' }));
    await liveDeal(await seedMenuItem(pool, far.id, { name: 'Хот-дог' }));
    await liveDeal(await seedMenuItem(pool, baumana.id, { name: 'Скрытый', isAvailable: false }));

    const cards = await catalog.deals(GUEST, near(BAUMANA));
    expect(cards.map((card) => [card.deal.deal.id, card.venue.id, card.distanceM])).toEqual([
      [baumanaSoon.id, baumana.id, 0],
      [kremlinSoon.id, kremlin.id, Math.round(distanceMeters(BAUMANA, KREMLIN))],
      [baumanaLate.id, baumana.id, 0],
    ]);
    expect(cards[0]?.deal).toMatchObject({ status: 'active', item: { name: 'Эклер' } });

    const everywhere = await catalog.deals(GUEST, near(null));
    expect(everywhere.map((card) => card.venue.name)).toEqual(['Кремлёвская', 'Зерно', 'Арена', 'Зерно']);
    expect(everywhere.every((card) => card.distanceM === null)).toBe(true);
  });

  it('returns at most 50 deals', async () => {
    const venue = await seedVenue(pool, 1);
    for (let index = 1; index <= 52; index += 1) {
      await liveDeal(await seedMenuItem(pool, venue.id, { name: `Позиция ${index}` }), index / 10);
    }
    const cards = await catalog.deals(GUEST, near(BAUMANA));
    expect(cards).toHaveLength(50);
    expect(cards[0]?.deal.item.name).toBe('Позиция 1');
  });
});

describe('deal card', () => {
  it('shows a live deal with the distance from the saved location', async () => {
    const venue = await seedVenue(pool, 1, { location: BAUMANA });
    const item = await seedMenuItem(pool, venue.id);
    const deal = await liveDeal(item);
    expect(await catalog.deal(GUEST, deal.id)).toEqual({
      deal: { deal, item, status: 'active' },
      venue,
      distanceM: null,
    });
    await seedUser(pool, 102, KREMLIN);
    expect((await catalog.deal(102, deal.id)).distanceM).toBe(Math.round(distanceMeters(KREMLIN, BAUMANA)));
  });

  it('hides deals a guest cannot book', async () => {
    const venue = await seedVenue(pool, 1);
    const hidden = await seedMenuItem(pool, venue.id, { isAvailable: false });
    const hiddenDeal = await liveDeal(hidden);
    const item = await seedMenuItem(pool, venue.id, { name: 'Круассан' });
    const scheduled = await seedDeal(pool, item, { startsAt: inHours(1), endsAt: inHours(2) });
    for (const id of [hiddenDeal.id, scheduled.id, 999_999]) {
      await expect(catalog.deal(GUEST, id)).rejects.toMatchObject({ status: 404, code: 'deal_not_found' });
    }
  });
});
