import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedMenuItem, seedVenue } from '../../test/venues.ts';
import type { Venue } from '../domain/models.ts';
import * as menuItems from './menu-items.ts';

const pool = testPool();
const now = new Date('2026-09-25T09:00:00Z');

let venue: Venue;
let other: Venue;

beforeEach(async () => {
  await resetDatabase(pool);
  venue = await seedVenue(pool, 1);
  other = await seedVenue(pool, 2, { name: 'Пекарня' });
});

afterAll(async () => {
  await closeTestPool();
});

describe('menu items repository', () => {
  it('stores every field and maps it back', async () => {
    const fields: menuItems.MenuItemFields = {
      name: 'Сырники',
      description: 'Со сметаной',
      category: 'breakfast',
      priceRub: 320,
      weightG: 210,
      kcal: 480,
      proteinG: 24.5,
      fatG: 18.2,
      carbsG: 52,
      nutritionSource: 'estimate',
      tags: ['breakfast', 'dairy'],
      isAvailable: false,
    };
    const item = await menuItems.insert(pool, venue.id, fields, now);
    expect(item).toEqual({
      id: expect.any(Number) as number,
      venueId: venue.id,
      ...fields,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const later = new Date('2026-09-25T10:00:00Z');
    expect(await menuItems.update(pool, item.id, { ...fields, priceRub: 300, weightG: null }, later)).toEqual(
      {
        ...item,
        priceRub: 300,
        weightG: null,
        updatedAt: later,
      },
    );
  });

  it('separates the menu, the guest menu and archived items', async () => {
    const shown = await seedMenuItem(pool, venue.id, { name: 'Эклер' });
    const hidden = await seedMenuItem(pool, venue.id, { name: 'Скрытый', isAvailable: false });
    const archived = await seedMenuItem(pool, venue.id, { name: 'Архивный' });
    await menuItems.archive(pool, archived.id, now);
    const foreign = await seedMenuItem(pool, other.id);

    expect(await menuItems.listOnMenu(pool, venue.id)).toEqual([shown, hidden]);
    expect(await menuItems.listAvailable(pool, venue.id)).toEqual([shown]);
    expect(await menuItems.findByIds(pool, [archived.id, foreign.id])).toMatchObject([
      { id: archived.id, archivedAt: now },
      { id: foreign.id },
    ]);
    expect(await menuItems.findByIds(pool, [])).toEqual([]);
  });

  it('lists the guest menu of several venues at once', async () => {
    const shown = await seedMenuItem(pool, venue.id, { name: 'Эклер' });
    await seedMenuItem(pool, venue.id, { name: 'Скрытый', isAvailable: false });
    const archived = await seedMenuItem(pool, venue.id, { name: 'Архивный' });
    await menuItems.archive(pool, archived.id, now);
    const foreign = await seedMenuItem(pool, other.id, { name: 'Багет' });
    const third = await seedVenue(pool, 3, { name: 'Столовая' });
    await seedMenuItem(pool, third.id, { name: 'Борщ' });

    expect(await menuItems.listAvailableInVenues(pool, [other.id, venue.id])).toEqual([shown, foreign]);
    expect(await menuItems.listAvailableInVenues(pool, [])).toEqual([]);
  });

  it('locks only current items of the given venue', async () => {
    const item = await seedMenuItem(pool, venue.id);
    expect(await menuItems.lockOnMenu(pool, venue.id, item.id)).toEqual(item);
    expect(await menuItems.lockOnMenu(pool, other.id, item.id)).toBeNull();
    await menuItems.archive(pool, item.id, now);
    expect(await menuItems.lockOnMenu(pool, venue.id, item.id)).toBeNull();
    expect(await menuItems.lockById(pool, item.id)).toMatchObject({ id: item.id, archivedAt: now });
  });

  it('drops tags that are not in the vocabulary', async () => {
    const item = await seedMenuItem(pool, venue.id);
    await pool.query(`update menu_items set tags = '{dessert,retired_tag}' where id = $1`, [item.id]);
    expect((await menuItems.findByIds(pool, [item.id]))[0]?.tags).toEqual(['dessert']);
  });

  it('copies the available items of one venue to another with new ids', async () => {
    const croissant = await seedMenuItem(pool, venue.id, {
      name: 'Круассан',
      category: 'bakery',
      nutritionSource: 'estimate',
      tags: ['pastry'],
    });
    const eclair = await seedMenuItem(pool, venue.id);
    await seedMenuItem(pool, venue.id, { name: 'Скрытое', isAvailable: false });
    const archived = await seedMenuItem(pool, venue.id, { name: 'Старое' });
    await menuItems.archive(pool, archived.id, now);
    const copiedAt = new Date('2026-09-26T09:00:00Z');

    const copies = await menuItems.copyAvailable(pool, venue.id, other.id, copiedAt);

    expect(copies.map((item) => item.name)).toEqual(['Круассан', 'Эклер']);
    const [first, second] = copies;
    expect(first).toEqual({
      ...croissant,
      id: expect.any(Number) as number,
      venueId: other.id,
      createdAt: copiedAt,
      updatedAt: copiedAt,
    });
    expect(second).toMatchObject({ name: eclair.name, venueId: other.id, kcal: eclair.kcal });
    expect(copies.every((item) => ![croissant.id, eclair.id].includes(item.id))).toBe(true);
    expect(await menuItems.listOnMenu(pool, venue.id)).toHaveLength(3);
  });
});
