import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedDeal, seedMenuItem, seedUser, seedVenue } from '../../test/venues.ts';
import type { Venue } from '../domain/models.ts';
import * as deals from '../repositories/deals.ts';
import { createMenuService, type MenuItemInput } from './menu.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const service = createMenuService({ pool, clock });

const OWNER = 202;
const OTHER_OWNER = 303;
const HOUR = 3_600_000;

const eclair: MenuItemInput = {
  name: ' Эклер ',
  description: '  Заварное тесто и крем  ',
  category: 'dessert',
  priceRub: 200,
  weightG: 80,
  kcal: 330,
  proteinG: 5.04,
  fatG: 17.96,
  carbsG: 38.15,
  tags: ['dessert', 'sweet', 'dessert'],
};

let venue: Venue;

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-25T09:00:00Z');
  venue = await seedVenue(pool, OWNER);
});

afterAll(async () => {
  await closeTestPool();
});

describe('menu service', () => {
  it('creates an item entered by the venue with normalized fields', async () => {
    const item = await service.create(OWNER, eclair);
    expect(item).toMatchObject({
      venueId: venue.id,
      name: 'Эклер',
      description: 'Заварное тесто и крем',
      priceRub: 200,
      weightG: 80,
      kcal: 330,
      proteinG: 5,
      fatG: 18,
      carbsG: 38.2,
      tags: ['dessert', 'sweet'],
      nutritionSource: 'venue',
      isAvailable: true,
      archivedAt: null,
      createdAt: clock.now(),
    });
  });

  it('stores optional fields as null when they are missing or blank', async () => {
    const item = await service.create(OWNER, {
      name: 'Американо',
      description: '   ',
      category: 'drink',
      priceRub: 150,
      kcal: 5,
      isAvailable: false,
    });
    expect(item).toMatchObject({
      description: null,
      weightG: null,
      proteinG: null,
      fatG: null,
      carbsG: null,
      tags: [],
      isAvailable: false,
    });
  });

  it('lists the menu by category order and name, with hidden but not archived items', async () => {
    const make = (name: string, category: MenuItemInput['category'], isAvailable = true) =>
      service.create(OWNER, { name, category, priceRub: 100, kcal: 100, isAvailable });
    await make('Чай', 'drink');
    await make('Эклер', 'dessert');
    await make('Борщ', 'soup');
    await make('Ёлочка', 'dessert', false);
    await make('Брауни', 'dessert');
    await make('Сырники', 'breakfast');
    const archived = await make('Бублик', 'bakery');
    await service.archive(OWNER, archived.id);
    const names = (await service.list(OWNER)).map((item) => item.name);
    expect(names).toEqual(['Сырники', 'Борщ', 'Брауни', 'Ёлочка', 'Эклер', 'Чай']);
  });

  it('updates only the given fields', async () => {
    const created = await service.create(OWNER, eclair);
    clock.advance(60_000);
    const updated = await service.update(OWNER, created.id, {
      name: 'Эклер ванильный',
      description: null,
      weightG: null,
      tags: ['pastry', 'pastry'],
      isAvailable: false,
    });
    expect(updated).toEqual({
      ...created,
      name: 'Эклер ванильный',
      description: null,
      weightG: null,
      tags: ['pastry'],
      isAvailable: false,
      updatedAt: clock.now(),
    });
  });

  it('marks nutrition as entered by the venue once kcal or macros change', async () => {
    const estimated = await seedMenuItem(pool, venue.id, { nutritionSource: 'estimate' });
    const renamed = await service.update(OWNER, estimated.id, { name: 'Эклер большой', priceRub: 250 });
    expect(renamed.nutritionSource).toBe('estimate');
    const clearedFat = await service.update(OWNER, estimated.id, { fatG: null });
    expect(clearedFat).toMatchObject({ nutritionSource: 'venue', fatG: null });

    const other = await seedMenuItem(pool, venue.id, { nutritionSource: 'estimate' });
    expect(await service.update(OWNER, other.id, { kcal: 300 })).toMatchObject({
      nutritionSource: 'venue',
      kcal: 300,
    });
    const third = await seedMenuItem(pool, venue.id, { nutritionSource: 'estimate' });
    expect(await service.update(OWNER, third.id, { proteinG: 6.26 })).toMatchObject({
      nutritionSource: 'venue',
      proteinG: 6.3,
    });
  });

  it('keeps the menu price above the price of a live deal', async () => {
    const item = await seedMenuItem(pool, venue.id, { priceRub: 200 });
    await seedDeal(pool, item, {
      priceRub: 120,
      startsAt: clock.now(),
      endsAt: new Date(clock.now().getTime() + HOUR),
    });
    for (const priceRub of [120, 100]) {
      await expect(service.update(OWNER, item.id, { priceRub })).rejects.toMatchObject({
        status: 422,
        code: 'deal_price_not_lower',
      });
    }
    expect(await service.update(OWNER, item.id, { priceRub: 121 })).toMatchObject({ priceRub: 121 });
  });

  it('lets the price drop freely once the deal is over', async () => {
    const item = await seedMenuItem(pool, venue.id, { priceRub: 200 });
    const deal = await seedDeal(pool, item, {
      priceRub: 120,
      startsAt: clock.now(),
      endsAt: new Date(clock.now().getTime() + HOUR),
    });
    await deals.update(pool, deal.id, { quantityLeft: 0, endsAt: deal.endsAt });
    expect(await service.update(OWNER, item.id, { priceRub: 90 })).toMatchObject({ priceRub: 90 });
    clock.advance(2 * HOUR);
    const later = await seedMenuItem(pool, venue.id, { priceRub: 200 });
    await seedDeal(pool, later, {
      priceRub: 150,
      startsAt: new Date(clock.now().getTime() - 2 * HOUR),
      endsAt: new Date(clock.now().getTime() - HOUR),
    });
    expect(await service.update(OWNER, later.id, { priceRub: 100 })).toMatchObject({ priceRub: 100 });
  });

  it('archives an item, cancels its live deal and keeps finished deals untouched', async () => {
    const item = await seedMenuItem(pool, venue.id);
    const soldOut = await seedDeal(pool, item, {
      startsAt: new Date(clock.now().getTime() - 2 * HOUR),
      endsAt: new Date(clock.now().getTime() + HOUR),
    });
    await deals.update(pool, soldOut.id, { quantityLeft: 0, endsAt: soldOut.endsAt });
    const live = await seedDeal(pool, item, {
      startsAt: clock.now(),
      endsAt: new Date(clock.now().getTime() + HOUR),
    });

    clock.advance(60_000);
    await service.archive(OWNER, item.id);

    expect(await service.list(OWNER)).toEqual([]);
    expect(await deals.findInVenue(pool, venue.id, live.id)).toMatchObject({ cancelledAt: clock.now() });
    expect(await deals.findInVenue(pool, venue.id, soldOut.id)).toMatchObject({ cancelledAt: null });
    await expect(service.archive(OWNER, item.id)).rejects.toMatchObject({
      status: 404,
      code: 'menu_item_not_found',
    });
    await expect(service.update(OWNER, item.id, { priceRub: 300 })).rejects.toMatchObject({
      status: 404,
      code: 'menu_item_not_found',
    });
  });

  it('hides the items of other venues from their owners', async () => {
    const item = await seedMenuItem(pool, venue.id);
    await seedVenue(pool, OTHER_OWNER, { name: 'Пекарня' });
    await expect(service.update(OTHER_OWNER, item.id, { priceRub: 1 })).rejects.toMatchObject({
      status: 404,
      code: 'menu_item_not_found',
    });
    await expect(service.archive(OTHER_OWNER, item.id)).rejects.toMatchObject({
      status: 404,
      code: 'menu_item_not_found',
    });
    expect(await service.list(OTHER_OWNER)).toEqual([]);
    await expect(service.update(OWNER, 999_999, { priceRub: 1 })).rejects.toMatchObject({
      code: 'menu_item_not_found',
    });
  });

  it('requires a venue for every call', async () => {
    const guest = 101;
    await seedUser(pool, guest);
    await expect(service.list(guest)).rejects.toMatchObject({ status: 404, code: 'venue_not_found' });
    await expect(service.create(guest, eclair)).rejects.toMatchObject({ code: 'venue_not_found' });
    await expect(service.update(guest, 1, { name: 'x' })).rejects.toMatchObject({ code: 'venue_not_found' });
    await expect(service.archive(guest, 1)).rejects.toMatchObject({ code: 'venue_not_found' });
  });
});
