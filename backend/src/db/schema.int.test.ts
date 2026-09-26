import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { one } from './pool.ts';

const pool = testPool();

async function venue(name: string): Promise<number> {
  const row = await one<{ id: number }>(
    pool,
    `insert into venues (name, address, category, lat, lon)
     values ($1, 'ул. Баумана, 1', 'cafe', 55.79, 49.12)
     returning id`,
    [name],
  );
  return row.id;
}

async function menuItem(venueId: number): Promise<number> {
  const row = await one<{ id: number }>(
    pool,
    `insert into menu_items (venue_id, name, category, price_rub, kcal, nutrition_source)
     values ($1, 'Эклер', 'dessert', 150, 260, 'estimate')
     returning id`,
    [venueId],
  );
  return row.id;
}

async function deal(venueId: number, menuItemId: number): Promise<number> {
  const row = await one<{ id: number }>(
    pool,
    `insert into deals (venue_id, menu_item_id, price_rub, quantity_total, quantity_left, ends_at)
     values ($1, $2, 90, 3, 3, now() + interval '2 hours')
     returning id`,
    [venueId, menuItemId],
  );
  return row.id;
}

let first: number;
let second: number;

beforeEach(async () => {
  await resetDatabase(pool);
  first = await venue('Первое');
  second = await venue('Второе');
});

afterAll(async () => {
  await closeTestPool();
});

describe('schema integrity', () => {
  it('rejects a deal for a dish of another venue', async () => {
    const foreignItem = await menuItem(second);
    await expect(deal(first, foreignItem)).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects a booking that mixes venues', async () => {
    const itemAtFirst = await menuItem(first);
    const dealAtFirst = await deal(first, itemAtFirst);
    await expect(
      pool.query(
        `insert into bookings (venue_id, menu_item_id, deal_id, code, item_name, price_rub, kcal, expires_at)
         values ($1, $2, $3, 'ABC234', 'Эклер', 90, 260, now() + interval '1 hour')`,
        [second, itemAtFirst, dealAtFirst],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('allows only one active booking per guest and deal', async () => {
    await pool.query('insert into users (id) values (1)');
    const item = await menuItem(first);
    const dealId = await deal(first, item);
    const book = (code: string) =>
      pool.query(
        `insert into bookings (user_id, venue_id, menu_item_id, deal_id, code, item_name, price_rub, kcal, expires_at)
         values (1, $1, $2, $3, $4, 'Эклер', 90, 260, now() + interval '1 hour')`,
        [first, item, dealId, code],
      );
    await book('ABC234');
    await expect(book('ABC235')).rejects.toMatchObject({ code: '23505' });
  });

  it('keeps booking status and resolution time consistent', async () => {
    const item = await menuItem(first);
    await expect(
      pool.query(
        `insert into bookings (venue_id, menu_item_id, code, item_name, price_rub, kcal, expires_at, status)
         values ($1, $2, 'ABC234', 'Эклер', 150, 260, now() + interval '1 hour', 'redeemed')`,
        [first, item],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects booking codes with ambiguous characters', async () => {
    const item = await menuItem(first);
    await expect(
      pool.query(
        `insert into bookings (venue_id, menu_item_id, code, item_name, price_rub, kcal, expires_at)
         values ($1, $2, 'ABCD10', 'Эклер', 150, 260, now() + interval '1 hour')`,
        [first, item],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts only known reasons for declining an offer', async () => {
    const item = await menuItem(first);
    const decline = (reason: string | null) =>
      pool.query(
        `insert into offers (venue_id, menu_item_id, channel, score, explanation, status, decline_reason)
         values ($1, $2, 'miniapp', 0.5, '{}', 'declined', $3)`,
        [first, item, reason],
      );
    await decline('not_today');
    await decline('dislike');
    await decline(null);
    await expect(decline('too_expensive')).rejects.toMatchObject({ code: '23514' });
  });

  it('deletes a venue together with its menu, deals and bookings', async () => {
    const item = await menuItem(first);
    await deal(first, item);
    await pool.query('delete from venues where id = $1', [first]);
    const row = await one<{ items: number; deals: number }>(
      pool,
      'select (select count(*) from menu_items)::int as items, (select count(*) from deals)::int as deals',
    );
    expect(row).toEqual({ items: 0, deals: 0 });
  });

  it('links only demo venues to the demo venue they copy and unlinks them when it is deleted', async () => {
    await pool.query('update venues set is_demo = true where id in ($1, $2)', [first, second]);
    await pool.query('update venues set demo_source_id = $1 where id = $2', [first, second]);
    await expect(
      pool.query('update venues set is_demo = false where id = $1', [second]),
    ).rejects.toMatchObject({
      code: '23514',
    });
    await pool.query('delete from venues where id = $1', [first]);
    const row = await one<{ demo_source_id: number | null }>(
      pool,
      'select demo_source_id from venues where id = $1',
      [second],
    );
    expect(row.demo_source_id).toBeNull();
  });
});
