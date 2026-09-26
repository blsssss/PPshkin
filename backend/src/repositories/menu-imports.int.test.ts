import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedVenue } from '../../test/venues.ts';
import type { ParsedMenuItem, Venue } from '../domain/models.ts';
import * as menuImports from './menu-imports.ts';

const pool = testPool();
const now = new Date('2026-09-25T09:00:00Z');
const MINUTE = 60_000;
const minutesFromNow = (minutes: number) => new Date(now.getTime() + minutes * MINUTE);

const items: ParsedMenuItem[] = [
  {
    name: 'Капучино',
    description: null,
    category: 'drink',
    priceRub: null,
    weightG: null,
    kcal: 120,
    proteinG: 6,
    fatG: 6,
    carbsG: 10,
    tags: ['coffee'],
  },
];

let venue: Venue;

beforeEach(async () => {
  await resetDatabase(pool);
  venue = await seedVenue(pool, 1);
});

afterAll(async () => {
  await closeTestPool();
});

describe('menu imports repository', () => {
  it('creates a processing import and stores its outcome once', async () => {
    const created = await menuImports.insert(pool, venue.id, 'photo', now);
    expect(created).toEqual({
      id: expect.any(Number) as number,
      venueId: venue.id,
      source: 'photo',
      status: 'processing',
      items: [],
      error: null,
      model: null,
      createdAt: now,
      completedAt: null,
    });
    const outcome: menuImports.ImportOutcome = { status: 'ready', items, error: null, model: 'test-model' };
    const completed = await menuImports.complete(pool, created.id, outcome, minutesFromNow(1), now);
    expect(completed).toEqual({
      ...created,
      status: 'ready',
      items,
      model: 'test-model',
      completedAt: minutesFromNow(1),
    });
    expect(await menuImports.complete(pool, created.id, outcome, minutesFromNow(2), now)).toBeNull();
    await menuImports.markApplied(pool, created.id);
    expect(await menuImports.findInVenue(pool, venue.id, created.id)).toMatchObject({ status: 'applied' });
  });

  it('does not complete an import that started before the processing window', async () => {
    const created = await menuImports.insert(pool, venue.id, 'text', now);
    const failure: menuImports.ImportOutcome = { status: 'failed', items: [], error: 'Ошибка', model: null };
    expect(
      await menuImports.complete(pool, created.id, failure, minutesFromNow(31), minutesFromNow(1)),
    ).toBeNull();
    expect(await menuImports.lockInVenue(pool, venue.id, created.id)).toMatchObject({ status: 'processing' });
  });

  it('counts fresh processing imports and imports started in a period', async () => {
    const stale = await menuImports.insert(pool, venue.id, 'text', minutesFromNow(-40));
    const done = await menuImports.insert(pool, venue.id, 'text', minutesFromNow(-20));
    await menuImports.complete(
      pool,
      done.id,
      { status: 'failed', items: [], error: 'x', model: null },
      now,
      stale.createdAt,
    );
    await menuImports.insert(pool, venue.id, 'photo', minutesFromNow(-10));
    const other = await seedVenue(pool, 2, { name: 'Пекарня' });
    await menuImports.insert(pool, other.id, 'text', now);

    expect(
      await menuImports.countRecent(pool, venue.id, {
        processingSince: minutesFromNow(-30),
        startedFrom: minutesFromNow(-30),
        startedTo: minutesFromNow(1),
      }),
    ).toEqual({ processing: 1, started: 2 });
    expect(
      await menuImports.countRecent(pool, venue.id, {
        processingSince: minutesFromNow(-30),
        startedFrom: minutesFromNow(-60),
        startedTo: minutesFromNow(-15),
      }),
    ).toEqual({ processing: 1, started: 2 });
    expect(await menuImports.findInVenue(pool, other.id, stale.id)).toBeNull();
  });
});
