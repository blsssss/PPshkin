import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedMenuItem, seedUser, seedVenue } from '../../test/venues.ts';
import { createMetricsService } from './metrics.ts';

const pool = testPool();
const service = createMetricsService(pool);

beforeEach(async () => {
  await resetDatabase(pool);
});

afterAll(async () => {
  await closeTestPool();
});

describe('metrics service', () => {
  it('reports zeros and empty status maps on an empty database', async () => {
    expect(await service.snapshot()).toEqual({
      users: 0,
      mealsLastDay: 0,
      activeDeals: 0,
      bookings: {},
      offers: {},
    });
  });

  it('counts real users, recent meals, live deals and bookings by status', async () => {
    await seedUser(pool, 101);
    await seedUser(pool, 102);
    await seedUser(pool, -1001);
    const venue = await seedVenue(pool, 101);
    const item = await seedMenuItem(pool, venue.id, { priceRub: 200 });

    await pool.query(
      `insert into meals (user_id, title, kcal_min, kcal_max, source, created_at) values
         (101, 'fresh', 100, 200, 'manual', now() - interval '1 hour'),
         (101, 'old', 100, 200, 'manual', now() - interval '2 days')`,
    );
    await pool.query(
      `insert into deals (venue_id, menu_item_id, price_rub, quantity_total, quantity_left, starts_at, ends_at, cancelled_at) values
         ($1, $2, 100, 5, 3, now() - interval '1 hour', now() + interval '1 hour', null),
         ($1, $2, 100, 5, 0, now() - interval '1 hour', now() + interval '1 hour', null),
         ($1, $2, 100, 5, 3, now() - interval '3 hours', now() - interval '1 hour', null),
         ($1, $2, 100, 5, 3, now() - interval '1 hour', now() + interval '1 hour', now())`,
      [venue.id, item.id],
    );
    await pool.query(
      `insert into bookings (user_id, venue_id, menu_item_id, code, item_name, price_rub, kcal, status, expires_at, resolved_at) values
         (102, $1, $2, 'ABCDEF', 'item', 100, 300, 'redeemed', now() + interval '1 hour', now()),
         (102, $1, $2, 'ABCDEG', 'item', 100, 300, 'redeemed', now() + interval '1 hour', now()),
         (102, $1, $2, 'ABCDEH', 'item', 100, 300, 'active', now() + interval '1 hour', null)`,
      [venue.id, item.id],
    );

    expect(await service.snapshot()).toEqual({
      users: 2,
      mealsLastDay: 1,
      activeDeals: 1,
      bookings: { redeemed: 2, active: 1 },
      offers: {},
    });
  });
});
