import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { BAUMANA, KREMLIN, seedDeal, seedMenuItem, seedVenue } from '../../test/venues.ts';
import type { Candidate } from '../domain/intent/types.ts';
import type { Venue } from '../domain/models.ts';
import { loadCandidates } from './candidates.ts';
import * as deals from './deals.ts';
import * as menuItems from './menu-items.ts';

const pool = testPool();
const now = new Date('2026-09-26T13:00:00Z');
const HOUR = 3_600_000;
const inHours = (hours: number) => new Date(now.getTime() + hours * HOUR);

const AROUND_BAUMANA = { minLat: 55.78, maxLat: 55.795, minLon: 49.115, maxLon: 49.13 };

const summary = (candidates: Candidate[]) =>
  candidates.map(({ item, venue, deal }) => [item.name, venue.name, deal?.id ?? null]);

let zerno: Venue;
let kremlin: Venue;

beforeEach(async () => {
  await resetDatabase(pool);
  zerno = await seedVenue(pool, 1, { name: 'Зерно', location: BAUMANA });
  kremlin = await seedVenue(pool, 2, { name: 'Кремлёвская', location: KREMLIN });
});

afterAll(async () => {
  await closeTestPool();
});

describe('candidate loader', () => {
  it('pairs every available item with its venue and the live deal that ends first', async () => {
    const eclair = await seedMenuItem(pool, zerno.id, { name: 'Эклер' });
    await seedDeal(pool, eclair, { startsAt: inHours(-1), endsAt: inHours(3) });
    const endsFirst = await seedDeal(pool, eclair, { startsAt: inHours(-1), endsAt: inHours(1) });
    const croissant = await seedMenuItem(pool, zerno.id, { name: 'Круассан', category: 'bakery' });
    const cancelled = await seedDeal(pool, croissant, { startsAt: inHours(-1), endsAt: inHours(2) });
    await deals.cancelLiveInVenue(pool, zerno.id, cancelled.id, now);
    const soldOut = await seedDeal(pool, croissant, { startsAt: inHours(-1), endsAt: inHours(2) });
    await deals.update(pool, soldOut.id, { quantityLeft: 0, endsAt: soldOut.endsAt });
    await seedDeal(pool, croissant, { startsAt: inHours(1), endsAt: inHours(2) });
    await seedDeal(pool, croissant, { startsAt: inHours(-3), endsAt: now });
    const hidden = await seedMenuItem(pool, zerno.id, { name: 'Скрытый', isAvailable: false });
    await seedDeal(pool, hidden, { startsAt: inHours(-1), endsAt: inHours(2) });
    const archived = await seedMenuItem(pool, zerno.id, { name: 'Архивный' });
    await menuItems.archive(pool, archived.id, now);
    await seedMenuItem(pool, kremlin.id, { name: 'Борщ', category: 'soup' });

    const candidates = await loadCandidates(pool, null, now);
    expect(summary(candidates)).toEqual([
      ['Эклер', 'Зерно', endsFirst.id],
      ['Круассан', 'Зерно', null],
      ['Борщ', 'Кремлёвская', null],
    ]);
    expect(candidates[0]).toEqual({ item: eclair, venue: zerno, deal: endsFirst });
  });

  it('keeps only venues inside the area', async () => {
    await seedMenuItem(pool, zerno.id, { name: 'Эклер' });
    await seedMenuItem(pool, kremlin.id, { name: 'Борщ', category: 'soup' });
    expect(summary(await loadCandidates(pool, AROUND_BAUMANA, now))).toEqual([['Эклер', 'Зерно', null]]);
    const nowhere = { minLat: 43.1, maxLat: 43.2, minLon: 131.8, maxLon: 131.9 };
    expect(await loadCandidates(pool, nowhere, now)).toEqual([]);
  });
});
