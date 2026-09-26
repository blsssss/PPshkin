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
});
