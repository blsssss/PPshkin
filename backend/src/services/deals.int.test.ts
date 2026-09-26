import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedDeal, seedMenuItem, seedUser, seedVenue } from '../../test/venues.ts';
import type { MenuItem, Venue } from '../domain/models.ts';
import * as menuItems from '../repositories/menu-items.ts';
import { createDealsService, type DealInput } from './deals.ts';
import { createMenuService } from './menu.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const service = createDealsService({ pool, clock });
const menu = createMenuService({ pool, clock });

const OWNER = 202;
const OTHER_OWNER = 303;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const inHours = (hours: number) => new Date(clock.now().getTime() + hours * HOUR);

let venue: Venue;
let item: MenuItem;

const input = (overrides: Partial<DealInput> = {}): DealInput => ({
  menuItemId: item.id,
  priceRub: 120,
  quantity: 5,
  endsAt: inHours(2),
  ...overrides,
});

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-25T09:00:00Z');
  venue = await seedVenue(pool, OWNER);
  item = await seedMenuItem(pool, venue.id, { priceRub: 200 });
});

afterAll(async () => {
  await closeTestPool();
});

describe('creating deals', () => {
  it('starts a deal now with the whole quantity left', async () => {
    const view = await service.create(OWNER, input());
    expect(view.status).toBe('active');
    expect(view.item).toEqual(item);
    expect(view.deal).toMatchObject({
      venueId: venue.id,
      menuItemId: item.id,
      priceRub: 120,
      quantityTotal: 5,
      quantityLeft: 5,
      startsAt: clock.now(),
      endsAt: inHours(2),
      cancelledAt: null,
      createdAt: clock.now(),
    });
  });

  it('only sells available items of the own menu', async () => {
    const hidden = await seedMenuItem(pool, venue.id, { name: 'Скрытый', isAvailable: false });
    await expect(service.create(OWNER, input({ menuItemId: hidden.id }))).rejects.toMatchObject({
      status: 422,
      code: 'menu_item_unavailable',
    });
    await menu.archive(OWNER, item.id);
    await expect(service.create(OWNER, input())).rejects.toMatchObject({
      status: 404,
      code: 'menu_item_not_found',
    });
    const foreign = await seedMenuItem(pool, (await seedVenue(pool, OTHER_OWNER)).id);
    await expect(service.create(OWNER, input({ menuItemId: foreign.id }))).rejects.toMatchObject({
      status: 404,
      code: 'menu_item_not_found',
    });
    await expect(service.create(OWNER, input({ menuItemId: 999_999 }))).rejects.toMatchObject({
      code: 'menu_item_not_found',
    });
  });

  it('needs a price strictly below the menu price', async () => {
    for (const priceRub of [200, 250]) {
      await expect(service.create(OWNER, input({ priceRub }))).rejects.toMatchObject({
        status: 422,
        code: 'deal_price_not_lower',
      });
    }
    expect((await service.create(OWNER, input({ priceRub: 199 }))).deal.priceRub).toBe(199);
  });

  it('needs an end in the future and within 24 hours', async () => {
    for (const endsAt of [clock.now(), inHours(-1), new Date(inHours(24).getTime() + 1)]) {
      await expect(service.create(OWNER, input({ endsAt }))).rejects.toMatchObject({
        status: 422,
        code: 'deal_window_invalid',
      });
    }
    expect((await service.create(OWNER, input({ endsAt: inHours(24) }))).status).toBe('active');
  });

  it('allows one live deal per item and a new one after it sells out, ends or is cancelled', async () => {
    const first = await service.create(OWNER, input());
    await expect(service.create(OWNER, input())).rejects.toMatchObject({ status: 409, code: 'deal_exists' });

    await service.update(OWNER, first.deal.id, { quantityLeft: 0 });
    const second = await service.create(OWNER, input({ endsAt: inHours(1) }));

    await service.cancel(OWNER, second.deal.id);
    const third = await service.create(OWNER, input({ endsAt: inHours(1) }));

    clock.advance(HOUR);
    expect((await service.create(OWNER, input())).deal.id).toBeGreaterThan(third.deal.id);
  });

  it('serializes concurrent deals on the same item', async () => {
    const results = await Promise.allSettled([
      service.create(OWNER, input()),
      service.create(OWNER, input()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'deal_exists' },
    });
  });
});

describe('changing deals', () => {
  it('changes the quantity left and the end time', async () => {
    const { deal } = await service.create(OWNER, input());
    clock.advance(10 * MINUTE);
    const updated = await service.update(OWNER, deal.id, { quantityLeft: 2, endsAt: inHours(3) });
    expect(updated.deal).toMatchObject({ quantityLeft: 2, quantityTotal: 5, endsAt: inHours(3) });
    expect(updated.status).toBe('active');
    expect((await service.update(OWNER, deal.id, { quantityLeft: 0 })).status).toBe('sold_out');
    expect((await service.update(OWNER, deal.id, { quantityLeft: 5 })).status).toBe('active');
  });

  it('rejects a quantity above the total and a bad end time', async () => {
    const { deal } = await service.create(OWNER, input());
    await expect(service.update(OWNER, deal.id, { quantityLeft: 6 })).rejects.toMatchObject({
      status: 422,
      code: 'deal_quantity_invalid',
    });
    for (const endsAt of [clock.now(), new Date(inHours(24).getTime() + 1)]) {
      await expect(service.update(OWNER, deal.id, { endsAt })).rejects.toMatchObject({
        status: 422,
        code: 'deal_window_invalid',
      });
    }
  });

  it('keeps an end time after the start of a scheduled deal', async () => {
    const scheduled = await seedDeal(pool, item, { startsAt: inHours(2), endsAt: inHours(4) });
    await expect(service.update(OWNER, scheduled.id, { endsAt: inHours(1) })).rejects.toMatchObject({
      code: 'deal_window_invalid',
    });
    const moved = await service.update(OWNER, scheduled.id, { endsAt: inHours(3) });
    expect(moved.status).toBe('scheduled');
  });

  it('refuses to change cancelled and ended deals', async () => {
    const { deal } = await service.create(OWNER, input());
    await service.cancel(OWNER, deal.id);
    await expect(service.update(OWNER, deal.id, { quantityLeft: 1 })).rejects.toMatchObject({
      status: 409,
      code: 'deal_finished',
    });
    const ending = await service.create(OWNER, input({ endsAt: inHours(1) }));
    clock.advance(HOUR);
    await expect(service.update(OWNER, ending.deal.id, { endsAt: inHours(2) })).rejects.toMatchObject({
      status: 409,
      code: 'deal_finished',
    });
  });

  it('refuses to change a sold out deal after its end time', async () => {
    const { deal } = await service.create(OWNER, input({ endsAt: inHours(1) }));
    await service.update(OWNER, deal.id, { quantityLeft: 0 });
    clock.advance(2 * HOUR);
    for (const patch of [
      { quantityLeft: 3, endsAt: inHours(3) },
      { quantityLeft: 3 },
      { endsAt: inHours(3) },
    ]) {
      await expect(service.update(OWNER, deal.id, patch)).rejects.toMatchObject({
        status: 409,
        code: 'deal_finished',
      });
    }
    const [finished] = await service.list(OWNER, 'finished');
    expect(finished).toMatchObject({ status: 'sold_out', deal: { id: deal.id, quantityLeft: 0 } });
  });

  it('checks the menu price and availability again before bringing back a sold out deal', async () => {
    const { deal } = await service.create(OWNER, input({ priceRub: 150 }));
    await service.update(OWNER, deal.id, { quantityLeft: 0 });
    await menu.update(OWNER, item.id, { priceRub: 100 });
    await expect(service.update(OWNER, deal.id, { quantityLeft: 3 })).rejects.toMatchObject({
      status: 422,
      code: 'deal_price_not_lower',
    });
    await menu.update(OWNER, item.id, { priceRub: 150 });
    await expect(service.update(OWNER, deal.id, { quantityLeft: 3 })).rejects.toMatchObject({
      code: 'deal_price_not_lower',
    });
    expect((await service.update(OWNER, deal.id, { endsAt: inHours(3) })).status).toBe('sold_out');

    await menu.update(OWNER, item.id, { priceRub: 300, isAvailable: false });
    await expect(service.update(OWNER, deal.id, { quantityLeft: 3 })).rejects.toMatchObject({
      status: 422,
      code: 'menu_item_unavailable',
    });
    await menu.update(OWNER, item.id, { isAvailable: true });
    const revived = await service.update(OWNER, deal.id, { quantityLeft: 3 });
    expect(revived).toMatchObject({ status: 'active', deal: { quantityLeft: 3, priceRub: 150 } });
  });

  it('keeps a live deal editable while its item is hidden from guests', async () => {
    const { deal } = await service.create(OWNER, input());
    await menu.update(OWNER, item.id, { isAvailable: false });
    const updated = await service.update(OWNER, deal.id, { quantityLeft: 2, endsAt: inHours(3) });
    expect(updated).toMatchObject({ status: 'active', deal: { quantityLeft: 2, endsAt: inHours(3) } });
  });

  it('does not bring back a sold out deal while a newer one is live or the item is archived', async () => {
    const { deal } = await service.create(OWNER, input());
    await service.update(OWNER, deal.id, { quantityLeft: 0 });
    const newer = await service.create(OWNER, input());
    await expect(service.update(OWNER, deal.id, { quantityLeft: 2 })).rejects.toMatchObject({
      status: 409,
      code: 'deal_exists',
    });
    expect((await service.update(OWNER, deal.id, { endsAt: inHours(5) })).status).toBe('sold_out');

    await service.cancel(OWNER, newer.deal.id);
    await menuItems.archive(pool, item.id, clock.now());
    await expect(service.update(OWNER, deal.id, { quantityLeft: 2 })).rejects.toMatchObject({
      status: 409,
      code: 'deal_finished',
    });
  });

  it('cancels a deal idempotently', async () => {
    const { deal } = await service.create(OWNER, input());
    clock.advance(MINUTE);
    await service.cancel(OWNER, deal.id);
    const cancelledAt = clock.now();
    clock.advance(MINUTE);
    await service.cancel(OWNER, deal.id);
    const [finished] = await service.list(OWNER, 'finished');
    expect(finished).toMatchObject({ status: 'cancelled', deal: { id: deal.id, cancelledAt } });
  });

  it('keeps the final status of sold out and ended deals when they are cancelled', async () => {
    const { deal } = await service.create(OWNER, input());
    await service.update(OWNER, deal.id, { quantityLeft: 0 });
    const ended = await seedDeal(pool, item, { startsAt: inHours(-3), endsAt: inHours(-1) });
    await service.cancel(OWNER, deal.id);
    await service.cancel(OWNER, ended.id);
    const finished = await service.list(OWNER, 'finished');
    expect(finished.map((view) => [view.deal.id, view.status, view.deal.cancelledAt])).toEqual([
      [deal.id, 'sold_out', null],
      [ended.id, 'ended', null],
    ]);
  });
});

describe('listing deals', () => {
  it('lists live deals by end time and finished deals of the last 7 days newest first', async () => {
    const other = await seedMenuItem(pool, venue.id, { name: 'Круассан', priceRub: 150 });
    const third = await seedMenuItem(pool, venue.id, { name: 'Маффин', priceRub: 120 });
    const old = await seedDeal(pool, third, {
      startsAt: new Date(clock.now().getTime() - 8 * 24 * HOUR),
      endsAt: new Date(clock.now().getTime() - 8 * 24 * HOUR + HOUR),
    });
    const ended = await seedDeal(pool, third, {
      startsAt: new Date(clock.now().getTime() - 3 * HOUR),
      endsAt: new Date(clock.now().getTime() - 2 * HOUR),
    });
    const soldOut = await seedDeal(pool, third, { startsAt: clock.now(), endsAt: inHours(5) });
    await service.update(OWNER, soldOut.id, { quantityLeft: 0 });
    const later = await service.create(OWNER, input({ endsAt: inHours(3) }));
    const sooner = await service.create(
      OWNER,
      input({ menuItemId: other.id, priceRub: 100, endsAt: inHours(1) }),
    );
    const scheduled = await seedDeal(pool, third, { startsAt: inHours(1), endsAt: inHours(2) });

    const active = await service.list(OWNER, 'active');
    expect(active.map((view) => [view.deal.id, view.status])).toEqual([
      [sooner.deal.id, 'active'],
      [scheduled.id, 'scheduled'],
      [later.deal.id, 'active'],
    ]);
    expect(active[0]?.item.name).toBe('Круассан');

    const finished = await service.list(OWNER, 'finished');
    expect(finished.map((view) => [view.deal.id, view.status])).toEqual([
      [soldOut.id, 'sold_out'],
      [ended.id, 'ended'],
    ]);
    expect(finished.map((view) => view.deal.id)).not.toContain(old.id);
  });

  it('keeps finished deals of archived items in the history', async () => {
    const { deal } = await service.create(OWNER, input());
    await menu.archive(OWNER, item.id);
    const [finished] = await service.list(OWNER, 'finished');
    expect(finished).toMatchObject({ status: 'cancelled', deal: { id: deal.id }, item: { id: item.id } });
  });
});

describe('deal ownership', () => {
  it('hides deals of other venues', async () => {
    const { deal } = await service.create(OWNER, input());
    await seedVenue(pool, OTHER_OWNER, { name: 'Пекарня' });
    await expect(service.update(OTHER_OWNER, deal.id, { quantityLeft: 1 })).rejects.toMatchObject({
      status: 404,
      code: 'deal_not_found',
    });
    await expect(service.cancel(OTHER_OWNER, deal.id)).rejects.toMatchObject({
      status: 404,
      code: 'deal_not_found',
    });
    expect(await service.list(OTHER_OWNER, 'active')).toEqual([]);
    await expect(service.cancel(OWNER, 999_999)).rejects.toMatchObject({ code: 'deal_not_found' });
  });

  it('requires a venue for every call', async () => {
    const guest = 101;
    await seedUser(pool, guest);
    await expect(service.list(guest, 'active')).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
    await expect(service.create(guest, input())).rejects.toMatchObject({ code: 'venue_not_found' });
    await expect(service.update(guest, 1, { quantityLeft: 1 })).rejects.toMatchObject({
      code: 'venue_not_found',
    });
    await expect(service.cancel(guest, 1)).rejects.toMatchObject({ code: 'venue_not_found' });
  });
});
