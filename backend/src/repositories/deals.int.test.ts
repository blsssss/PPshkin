import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedDeal, seedMenuItem, seedVenue } from '../../test/venues.ts';
import type { MenuItem, Venue } from '../domain/models.ts';
import * as deals from './deals.ts';
import * as menuItems from './menu-items.ts';

const pool = testPool();
const now = new Date('2026-09-25T09:00:00Z');
const HOUR = 3_600_000;
const inHours = (hours: number) => new Date(now.getTime() + hours * HOUR);

let venue: Venue;
let item: MenuItem;

beforeEach(async () => {
  await resetDatabase(pool);
  venue = await seedVenue(pool, 1);
  item = await seedMenuItem(pool, venue.id);
});

afterAll(async () => {
  await closeTestPool();
});

describe('deals repository', () => {
  it('starts a deal with the whole quantity left', async () => {
    const deal = await deals.insert(
      pool,
      { venueId: venue.id, menuItemId: item.id, priceRub: 99, quantity: 4, endsAt: inHours(2) },
      now,
    );
    expect(deal).toEqual({
      id: expect.any(Number) as number,
      venueId: venue.id,
      menuItemId: item.id,
      priceRub: 99,
      quantityTotal: 4,
      quantityLeft: 4,
      startsAt: now,
      endsAt: inHours(2),
      cancelledAt: null,
      createdAt: now,
    });
    expect(await deals.update(pool, deal.id, { quantityLeft: 1, endsAt: inHours(3) })).toEqual({
      ...deal,
      quantityLeft: 1,
      endsAt: inHours(3),
    });
  });

  it('finds the live deal of an item until it ends, sells out or is cancelled', async () => {
    const deal = await seedDeal(pool, item, { startsAt: now, endsAt: inHours(1) });
    expect(await deals.findLiveForItem(pool, item.id, now)).toEqual(deal);
    expect(await deals.findLiveForItem(pool, item.id, inHours(1))).toBeNull();
    await deals.update(pool, deal.id, { quantityLeft: 0, endsAt: deal.endsAt });
    expect(await deals.findLiveForItem(pool, item.id, now)).toBeNull();
    const next = await seedDeal(pool, item, { startsAt: now, endsAt: inHours(1) });
    await deals.cancelLiveInVenue(pool, venue.id, next.id, now);
    expect(await deals.findLiveForItem(pool, item.id, now)).toBeNull();
  });

  it('keeps the first cancellation time and ignores deals of other venues', async () => {
    const deal = await seedDeal(pool, item, { startsAt: now, endsAt: inHours(1) });
    const other = await seedVenue(pool, 2, { name: 'Пекарня' });
    await deals.cancelLiveInVenue(pool, other.id, deal.id, now);
    expect(await deals.findInVenue(pool, venue.id, deal.id)).toMatchObject({ cancelledAt: null });
    expect(await deals.findInVenue(pool, other.id, deal.id)).toBeNull();
    expect(await deals.lockInVenue(pool, other.id, deal.id)).toBeNull();
    await deals.cancelLiveInVenue(pool, venue.id, deal.id, now);
    await deals.cancelLiveInVenue(pool, venue.id, deal.id, inHours(1));
    expect(await deals.lockInVenue(pool, venue.id, deal.id)).toMatchObject({ cancelledAt: now });
  });

  it('leaves sold out and ended deals as they are when cancelling', async () => {
    const soldOut = await seedDeal(pool, item, { startsAt: now, endsAt: inHours(2) });
    await deals.update(pool, soldOut.id, { quantityLeft: 0, endsAt: soldOut.endsAt });
    const ended = await seedDeal(pool, item, { startsAt: inHours(-3), endsAt: inHours(-1) });
    const scheduled = await seedDeal(pool, item, { startsAt: inHours(1), endsAt: inHours(2) });
    for (const deal of [soldOut, ended, scheduled])
      await deals.cancelLiveInVenue(pool, venue.id, deal.id, now);
    expect(await deals.findInVenue(pool, venue.id, soldOut.id)).toMatchObject({ cancelledAt: null });
    expect(await deals.findInVenue(pool, venue.id, ended.id)).toMatchObject({ cancelledAt: null });
    expect(await deals.findInVenue(pool, venue.id, scheduled.id)).toMatchObject({ cancelledAt: now });
  });

  it('cancels only the live deal when an item leaves the menu', async () => {
    const ended = await seedDeal(pool, item, { startsAt: inHours(-3), endsAt: inHours(-1) });
    const live = await seedDeal(pool, item, { startsAt: now, endsAt: inHours(1) });
    await deals.cancelLiveForItem(pool, item.id, now);
    expect(await deals.findInVenue(pool, venue.id, ended.id)).toMatchObject({ cancelledAt: null });
    expect(await deals.findInVenue(pool, venue.id, live.id)).toMatchObject({ cancelledAt: now });
  });

  it('shows guests only started live deals on available items', async () => {
    const visible = await seedDeal(pool, item, { startsAt: now, endsAt: inHours(2) });
    const scheduled = await seedDeal(pool, await seedMenuItem(pool, venue.id, { name: 'Позже' }), {
      startsAt: inHours(1),
      endsAt: inHours(2),
    });
    const hiddenItem = await seedMenuItem(pool, venue.id, { name: 'Скрытый', isAvailable: false });
    await seedDeal(pool, hiddenItem, { startsAt: now, endsAt: inHours(2) });
    const archivedItem = await seedMenuItem(pool, venue.id, { name: 'Архивный' });
    const onArchived = await seedDeal(pool, archivedItem, { startsAt: now, endsAt: inHours(2) });
    await menuItems.archive(pool, archivedItem.id, now);

    expect(await deals.listVisible(pool, [venue.id], now)).toEqual([visible]);
    expect(await deals.findVisible(pool, visible.id, now)).toEqual(visible);
    expect(await deals.findVisible(pool, onArchived.id, now)).toBeNull();
    expect(await deals.findVisible(pool, scheduled.id, now)).toBeNull();
    expect(await deals.countVisibleByVenue(pool, [venue.id], now)).toEqual(new Map([[venue.id, 1]]));
    expect(await deals.countVisibleByVenue(pool, [venue.id], inHours(1))).toEqual(new Map([[venue.id, 2]]));
    expect(await deals.listVisible(pool, [], now)).toEqual([]);
    expect(await deals.countVisibleByVenue(pool, [], now)).toEqual(new Map());
  });
});
