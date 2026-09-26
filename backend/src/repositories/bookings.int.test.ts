import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooking } from '../../test/bookings.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedDeal, seedMenuItem, seedUser, seedVenue } from '../../test/venues.ts';
import { withTransaction } from '../db/pool.ts';
import type { Deal, MenuItem } from '../domain/models.ts';
import * as bookings from './bookings.ts';

const pool = testPool();
const now = new Date('2026-09-25T09:00:00Z');
const HOUR = 3_600_000;
const GUEST = 101;

let eclair: MenuItem;
let deal: Deal;

const booking = (code: string, overrides: Partial<bookings.NewBooking> = {}): bookings.NewBooking => ({
  userId: GUEST,
  venueId: eclair.venueId,
  menuItemId: eclair.id,
  dealId: deal.id,
  offerId: null,
  code,
  itemName: 'Эклер',
  priceRub: 130,
  kcal: 330,
  expiresAt: new Date(now.getTime() + HOUR),
  createdAt: now,
  ...overrides,
});

async function quantityLeft(): Promise<number | undefined> {
  const { rows } = await pool.query<{ quantity_left: number }>(
    'select quantity_left from deals where id = $1',
    [deal.id],
  );
  return rows[0]?.quantity_left;
}

beforeEach(async () => {
  await resetDatabase(pool);
  await seedUser(pool, GUEST);
  const venue = await seedVenue(pool, 202);
  eclair = await seedMenuItem(pool, venue.id, { name: 'Эклер' });
  deal = await seedDeal(pool, eclair, {
    quantity: 3,
    startsAt: new Date(now.getTime() - HOUR),
    endsAt: new Date(now.getTime() + 2 * HOUR),
  });
  await pool.query('update deals set quantity_left = 1 where id = $1', [deal.id]);
});

afterAll(async () => {
  await closeTestPool();
});

describe('bookings repository', () => {
  it('stores a booking and reports a taken code without breaking the transaction', async () => {
    const [stored, taken, next] = await withTransaction(pool, async (client) => [
      await bookings.insertIfCodeFree(client, booking('ABC234')),
      await bookings.insertIfCodeFree(client, booking('ABC234', { dealId: null })),
      await bookings.insertIfCodeFree(client, booking('XYZ789', { dealId: null })),
    ]);
    expect(stored).toEqual({
      id: expect.any(Number) as number,
      ...booking('ABC234'),
      status: 'active',
      resolvedAt: null,
    });
    expect(taken).toBeNull();
    expect(next).toMatchObject({ code: 'XYZ789', dealId: null });
    expect(await bookings.listActiveItemIds(pool, GUEST)).toEqual([eclair.id, eclair.id]);
  });

  it('lets other database errors through', async () => {
    await expect(
      withTransaction(pool, (client) => bookings.insertIfCodeFree(client, booking('OOOOOO'))),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('finds the latest booking with a code in the venue', async () => {
    await seedBooking(pool, {
      userId: GUEST,
      item: eclair,
      code: 'ABC234',
      status: 'redeemed',
      createdAt: new Date(now.getTime() - HOUR),
    });
    const latest = await seedBooking(pool, {
      userId: null,
      item: eclair,
      code: 'ABC234',
      status: 'cancelled',
      createdAt: now,
    });
    const found = await withTransaction(pool, (client) =>
      bookings.lockLatestByCode(client, eclair.venueId, 'ABC234'),
    );
    expect(found).toMatchObject({ id: latest, userId: null, status: 'cancelled' });
    expect(
      await withTransaction(pool, (client) =>
        bookings.lockLatestByCode(client, eclair.venueId + 1, 'ABC234'),
      ),
    ).toBeNull();
  });

  it('releases a booking and returns its unit to the deal within the total', async () => {
    const id = await seedBooking(pool, {
      userId: GUEST,
      item: eclair,
      code: 'ABC234',
      dealId: deal.id,
      createdAt: now,
    });
    const released = await bookings.release(pool, id, 'cancelled', now);
    expect(released).toMatchObject({ id, status: 'cancelled', resolvedAt: now });
    expect(await quantityLeft()).toBe(2);
    await pool.query('update deals set quantity_left = quantity_total where id = $1', [deal.id]);
    const full = await seedBooking(pool, {
      userId: GUEST,
      item: eclair,
      code: 'XYZ789',
      dealId: deal.id,
      createdAt: now,
    });
    await bookings.release(pool, full, 'expired', now);
    expect(await quantityLeft()).toBe(3);
  });

  it('expires due bookings in the scope in id order', async () => {
    const due = new Date(now.getTime() - 1);
    const first = await seedBooking(pool, {
      userId: GUEST,
      item: eclair,
      code: 'AAAAA2',
      dealId: deal.id,
      createdAt: now,
      expiresAt: due,
    });
    const second = await seedBooking(pool, {
      userId: null,
      item: eclair,
      code: 'BBBBB2',
      createdAt: now,
      expiresAt: now,
    });
    await seedBooking(pool, {
      userId: GUEST,
      item: eclair,
      code: 'CCCCC2',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 1),
    });
    expect(await bookings.expireDue(pool, { venueId: eclair.venueId + 1 }, now)).toEqual([]);
    expect((await bookings.expireDue(pool, { userId: GUEST }, now)).map((expired) => expired.id)).toEqual([
      first,
    ]);
    expect(await quantityLeft()).toBe(2);
    const rest = await bookings.expireDue(pool, {}, now);
    expect(rest).toEqual([
      expect.objectContaining({ id: second, status: 'expired', resolvedAt: now, userId: null }),
    ]);
  });

  it('cancels every active booking of a user and returns units to running deals', async () => {
    const ended = await seedDeal(pool, eclair, {
      quantity: 2,
      startsAt: new Date(now.getTime() - 2 * HOUR),
      endsAt: now,
    });
    await pool.query('update deals set quantity_left = 0 where id = $1', [ended.id]);
    const live = await seedBooking(pool, {
      userId: GUEST,
      item: eclair,
      code: 'AAAAA2',
      dealId: deal.id,
      createdAt: now,
    });
    const late = await seedBooking(pool, {
      userId: GUEST,
      item: eclair,
      code: 'BBBBB2',
      dealId: ended.id,
      createdAt: now,
    });
    const redeemed = await seedBooking(pool, {
      userId: GUEST,
      item: eclair,
      code: 'CCCCC2',
      dealId: deal.id,
      status: 'redeemed',
      createdAt: now,
    });
    const anonymous = await seedBooking(pool, {
      userId: null,
      item: eclair,
      code: 'DDDDD2',
      dealId: deal.id,
      createdAt: now,
    });
    await bookings.cancelActiveForUser(pool, GUEST, now);
    const { rows } = await pool.query<{ id: number; status: string; resolved_at: Date | null }>(
      'select id, status, resolved_at from bookings order by id',
    );
    expect(rows).toEqual([
      { id: live, status: 'cancelled', resolved_at: now },
      { id: late, status: 'cancelled', resolved_at: now },
      { id: redeemed, status: 'redeemed', resolved_at: now },
      { id: anonymous, status: 'active', resolved_at: null },
    ]);
    expect(await quantityLeft()).toBe(2);
    const { rows: endedRows } = await pool.query<{ quantity_left: number }>(
      'select quantity_left from deals where id = $1',
      [ended.id],
    );
    expect(endedRows).toEqual([{ quantity_left: 0 }]);
  });

  it('marks a booking redeemed', async () => {
    const id = await seedBooking(pool, {
      userId: GUEST,
      item: eclair,
      code: 'ABC234',
      dealId: deal.id,
      createdAt: now,
    });
    expect(await bookings.markRedeemed(pool, id, now)).toMatchObject({
      id,
      status: 'redeemed',
      resolvedAt: now,
    });
    expect(await quantityLeft()).toBe(1);
    expect(await bookings.listActiveItemIds(pool, GUEST)).toEqual([]);
  });
});
