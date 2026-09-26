import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooking, seedOffer } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedDeal, seedDemoCopy, seedDemoVenue, seedMenuItem } from '../../test/venues.ts';
import { DEMO_ACCOUNTS } from '../auth/demo.ts';
import { jsonb, one } from '../db/pool.ts';
import * as users from '../repositories/users.ts';
import { createAccountService } from './account.ts';

const pool = testPool();
const NOW = '2026-09-25T15:00:00.000Z';
const clock = fixedClock(NOW);
const account = createAccountService({ pool, clock });

const GUEST = 1;
const OTHER = 2;

const EXPLANATION = {
  headline: 'Сегодня можно десерт',
  facts: ['Вы обычно едите сладкое около 16:00'],
  calculations: ['2000 - 1450 = 550 ккал'],
  assumptions: [],
  factors: [],
};

let venueId: number;
let menuItemId: number;

async function insertId(sql: string, values: unknown[]): Promise<number> {
  return (await one<{ id: number }>(pool, sql, values)).id;
}

async function deal(quantityTotal: number, quantityLeft: number, window: 'live' | 'ended' | 'cancelled') {
  return insertId(
    `insert into deals (venue_id, menu_item_id, price_rub, quantity_total, quantity_left, starts_at, ends_at, cancelled_at)
     values ($1, $2, 90, $3, $4, $5::timestamptz - interval '3 hours',
             $5::timestamptz + case when $6 = 'ended' then interval '-1 hour' else interval '2 hours' end,
             case when $6 = 'cancelled' then $5::timestamptz - interval '10 minutes' end)
     returning id`,
    [venueId, menuItemId, quantityTotal, quantityLeft, NOW, window],
  );
}

async function booking(userId: number, dealId: number | null, code: string, status = 'active') {
  return insertId(
    `insert into bookings (user_id, venue_id, menu_item_id, deal_id, code, item_name, price_rub, kcal, status,
                           expires_at, resolved_at)
     values ($1, $2, $3, $4, $5, 'Эклер', 90, 260, $6, $7::timestamptz + interval '1 hour',
             case when $6 = 'active' then null else $7::timestamptz - interval '1 hour' end)
     returning id`,
    [userId, venueId, menuItemId, dealId, code, status, NOW],
  );
}

async function offer(userId: number, dealId: number) {
  return insertId(
    `insert into offers (user_id, venue_id, menu_item_id, deal_id, channel, score, explanation)
     values ($1, $2, $3, $4, 'miniapp', 0.8, $5::jsonb)
     returning id`,
    [userId, venueId, menuItemId, dealId, jsonb(EXPLANATION)],
  );
}

async function quantityLeft(dealId: number): Promise<number> {
  return (
    await one<{ quantity_left: number }>(pool, 'select quantity_left from deals where id = $1', [dealId])
  ).quantity_left;
}

async function bookingRow(id: number) {
  return one<{ user_id: number | null; status: string; resolved_at: Date | null }>(
    pool,
    'select user_id, status, resolved_at from bookings where id = $1',
    [id],
  );
}

async function count(table: 'meals' | 'consents' | 'chat_states', userId: number): Promise<number> {
  return (
    await one<{ total: number }>(pool, `select count(*)::int as total from ${table} where user_id = $1`, [
      userId,
    ])
  ).total;
}

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set(NOW);
  for (const id of [GUEST, OTHER, DEMO_ACCOUNTS.guest.userId]) {
    await users.upsert(pool, { id, firstName: null, username: null });
    await pool.query(
      `insert into meals (user_id, title, kcal_min, kcal_max, source) values ($1, 'Сырники', 320, 380, 'manual')`,
      [id],
    );
    await pool.query(
      `insert into consents (user_id, kind, version, channel) values ($1, 'personal_data', '2026-09-25', 'bot')`,
      [id],
    );
    await pool.query(`insert into chat_states (user_id, state) values ($1, '{"flow":"idle"}')`, [id]);
  }
  venueId = await insertId(
    `insert into venues (owner_id, name, address, category, lat, lon)
     values ($1, 'Кофейня', 'ул. Баумана, 1', 'coffee', 55.79, 49.12)
     returning id`,
    [GUEST],
  );
  menuItemId = await insertId(
    `insert into menu_items (venue_id, name, category, price_rub, kcal, nutrition_source)
     values ($1, 'Эклер', 'dessert', 150, 260, 'estimate')
     returning id`,
    [venueId],
  );
});

afterAll(async () => {
  await closeTestPool();
});

describe('account deletion', () => {
  it('cancels active bookings, returns units, erases explanations and deletes personal data', async () => {
    const live = await deal(5, 2, 'live');
    const full = await deal(2, 2, 'live');
    const liveBooking = await booking(GUEST, live, 'ABC234');
    const fullBooking = await booking(GUEST, full, 'ABC235');
    const plainBooking = await booking(GUEST, null, 'ABC236');
    const redeemed = await booking(GUEST, live, 'ABC237', 'redeemed');
    const othersBooking = await booking(OTHER, live, 'ABC238');
    const guestOffer = await offer(GUEST, live);
    const othersOffer = await offer(OTHER, live);

    await account.deleteAccount(GUEST);

    expect(await users.findById(pool, GUEST)).toBeNull();
    expect(await count('meals', GUEST)).toBe(0);
    expect(await count('consents', GUEST)).toBe(0);
    expect(await count('chat_states', GUEST)).toBe(0);

    expect(await quantityLeft(live)).toBe(3);
    expect(await quantityLeft(full)).toBe(2);
    for (const id of [liveBooking, fullBooking, plainBooking]) {
      expect(await bookingRow(id)).toEqual({
        user_id: null,
        status: 'cancelled',
        resolved_at: new Date(NOW),
      });
    }
    expect(await bookingRow(redeemed)).toMatchObject({ user_id: null, status: 'redeemed' });
    expect(await bookingRow(othersBooking)).toEqual({ user_id: OTHER, status: 'active', resolved_at: null });

    const offers = await pool.query<{ id: number; user_id: number | null; explanation: unknown }>(
      'select id, user_id, explanation from offers order by id',
    );
    expect(offers.rows).toEqual([
      { id: guestOffer, user_id: null, explanation: {} },
      { id: othersOffer, user_id: OTHER, explanation: EXPLANATION },
    ]);
    const venue = await one<{ owner_id: number | null }>(pool, 'select owner_id from venues where id = $1', [
      venueId,
    ]);
    expect(venue.owner_id).toBeNull();

    expect(await count('meals', OTHER)).toBe(1);
    expect(await count('consents', OTHER)).toBe(1);
  });

  it('does not return units to ended or cancelled deals', async () => {
    const ended = await deal(3, 1, 'ended');
    const cancelled = await deal(3, 1, 'cancelled');
    const endedBooking = await booking(GUEST, ended, 'ABC234');
    const cancelledBooking = await booking(GUEST, cancelled, 'ABC235');

    await account.deleteAccount(GUEST);

    expect(await quantityLeft(ended)).toBe(1);
    expect(await quantityLeft(cancelled)).toBe(1);
    expect(await bookingRow(endedBooking)).toMatchObject({ status: 'cancelled', user_id: null });
    expect(await bookingRow(cancelledBooking)).toMatchObject({ status: 'cancelled', user_id: null });
  });

  it('deletes the demo venue copy of the user with its menu, deals, offers and bookings', async () => {
    const source = await seedDemoVenue(pool, 900001);
    const sourceItem = await seedMenuItem(pool, source.id);
    const copy = await seedDemoCopy(pool, source.id, OTHER);
    const item = await seedMenuItem(pool, copy.id);
    const copyDeal = await seedDeal(pool, item, {
      startsAt: new Date(NOW),
      endsAt: new Date('2026-09-25T18:00:00Z'),
    });
    await seedOffer(pool, { userId: OTHER, item, createdAt: new Date(NOW) });
    await seedBooking(pool, {
      userId: OTHER,
      item,
      code: 'ABC239',
      createdAt: new Date(NOW),
      dealId: copyDeal.id,
    });

    await account.deleteAccount(OTHER);

    const venues = await pool.query<{ id: number; owner_id: number | null }>(
      'select id, owner_id from venues order by id',
    );
    expect(venues.rows).toEqual([
      { id: venueId, owner_id: GUEST },
      { id: source.id, owner_id: null },
    ]);
    const left = await pool.query<{ id: number }>('select id from menu_items order by id');
    expect(left.rows.map((row) => row.id)).toEqual([menuItemId, sourceItem.id]);
    for (const table of ['deals', 'offers', 'bookings']) {
      const { rows } = await pool.query(`select id from ${table} where venue_id = $1`, [copy.id]);
      expect(rows, table).toEqual([]);
    }
  });

  it('succeeds again for an already deleted user', async () => {
    await account.deleteAccount(GUEST);
    await expect(account.deleteAccount(GUEST)).resolves.toBeUndefined();
    await expect(account.deleteAccount(404)).resolves.toBeUndefined();
  });

  it('protects demo accounts', async () => {
    await expect(account.deleteAccount(DEMO_ACCOUNTS.guest.userId)).rejects.toMatchObject({
      status: 403,
      code: 'demo_account_protected',
    });
    expect(await users.findById(pool, DEMO_ACCOUNTS.guest.userId)).not.toBeNull();
    expect(await count('meals', DEMO_ACCOUNTS.guest.userId)).toBe(1);
  });

  it('lets the same person start over with an empty profile', async () => {
    await account.deleteAccount(GUEST);
    const again = await users.upsert(pool, { id: GUEST, firstName: 'Ира', username: null });
    expect(again).toMatchObject({ kcalTarget: 2000, goal: null, dislikedTags: [], location: null });
    expect(await count('consents', GUEST)).toBe(0);
    expect(await count('meals', GUEST)).toBe(0);
  });
});
