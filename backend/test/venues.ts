import type { Queryable } from '../src/db/pool.ts';
import type { Deal, GeoPoint, MenuItem, Venue } from '../src/domain/models.ts';
import * as deals from '../src/repositories/deals.ts';
import * as menuItems from '../src/repositories/menu-items.ts';
import * as users from '../src/repositories/users.ts';
import * as venues from '../src/repositories/venues.ts';

export const BAUMANA: GeoPoint = { lat: 55.7887, lon: 49.1221 };
export const KREMLIN: GeoPoint = { lat: 55.7986, lon: 49.1054 };
export const KAZAN_ARENA: GeoPoint = { lat: 55.8209, lon: 49.1607 };

const SEEDED_AT = new Date('2026-09-20T09:00:00Z');

export const sampleVenue: Venue = {
  id: 7,
  ownerId: 202,
  name: 'Кофейня «Зерно»',
  address: 'ул. Баумана, 36',
  category: 'coffee',
  location: BAUMANA,
  opensAt: '08:00',
  closesAt: '22:00',
  timezone: 'Europe/Moscow',
  isDemo: false,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
};

export const sampleMenuItem: MenuItem = {
  id: 11,
  venueId: sampleVenue.id,
  name: 'Эклер',
  description: 'Заварное тесто и ванильный крем',
  category: 'dessert',
  priceRub: 200,
  weightG: 80,
  kcal: 330,
  proteinG: 5,
  fatG: 18,
  carbsG: 38.2,
  nutritionSource: 'venue',
  tags: ['dessert', 'sweet'],
  isAvailable: true,
  archivedAt: null,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
};

export const sampleDeal: Deal = {
  id: 21,
  venueId: sampleVenue.id,
  menuItemId: sampleMenuItem.id,
  priceRub: 130,
  quantityTotal: 5,
  quantityLeft: 3,
  startsAt: new Date('2026-09-25T09:00:00Z'),
  endsAt: new Date('2026-09-25T11:00:00Z'),
  cancelledAt: null,
  createdAt: new Date('2026-09-25T09:00:00Z'),
};

export async function seedUser(db: Queryable, id: number, location: GeoPoint | null = null): Promise<void> {
  await users.upsert(db, { id, firstName: null, username: null });
  if (location) {
    await db.query('update users set location_lat = $2, location_lon = $3 where id = $1', [
      id,
      location.lat,
      location.lon,
    ]);
  }
}

const DEFAULT_VENUE: venues.VenueFields = {
  name: 'Кофейня «Зерно»',
  address: 'ул. Баумана, 36',
  category: 'coffee',
  location: BAUMANA,
  opensAt: '08:00',
  closesAt: '22:00',
  timezone: 'Europe/Moscow',
};

export async function seedVenue(
  db: Queryable,
  ownerId: number,
  fields: Partial<venues.VenueFields> = {},
): Promise<Venue> {
  await seedUser(db, ownerId);
  const venue = await venues.insert(db, ownerId, { ...DEFAULT_VENUE, ...fields }, SEEDED_AT);
  if (!venue) throw new Error(`User ${ownerId} already owns a venue`);
  return venue;
}

export async function seedDemoVenue(
  db: Queryable,
  id: number,
  fields: Partial<venues.VenueFields> = {},
  ownerId: number | null = null,
): Promise<Venue> {
  if (ownerId !== null) await seedUser(db, ownerId);
  const venue = { ...DEFAULT_VENUE, ...fields };
  await db.query(
    `insert into venues (id, owner_id, name, address, category, lat, lon, opens_at, closes_at, timezone, is_demo,
                         created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $11)`,
    [
      id,
      ownerId,
      venue.name,
      venue.address,
      venue.category,
      venue.location.lat,
      venue.location.lon,
      venue.opensAt,
      venue.closesAt,
      venue.timezone,
      SEEDED_AT,
    ],
  );
  const seeded = await venues.findById(db, id);
  if (!seeded) throw new Error(`Demo venue ${id} was not stored`);
  return seeded;
}

export async function seedDemoCopy(db: Queryable, sourceId: number, ownerId: number): Promise<Venue> {
  await seedUser(db, ownerId);
  const copy = await venues.insertDemoCopy(db, sourceId, ownerId, SEEDED_AT);
  if (!copy) throw new Error(`User ${ownerId} already owns a venue`);
  return copy;
}

export async function seedMenuItem(
  db: Queryable,
  venueId: number,
  fields: Partial<menuItems.MenuItemFields> = {},
): Promise<MenuItem> {
  return menuItems.insert(
    db,
    venueId,
    {
      name: 'Эклер',
      description: null,
      category: 'dessert',
      priceRub: 200,
      weightG: 80,
      kcal: 330,
      proteinG: 5,
      fatG: 18,
      carbsG: 38,
      nutritionSource: 'venue',
      tags: ['dessert', 'sweet'],
      isAvailable: true,
      ...fields,
    },
    SEEDED_AT,
  );
}

export interface DealSeed {
  priceRub?: number;
  quantity?: number;
  startsAt: Date;
  endsAt: Date;
}

export async function seedDeal(db: Queryable, item: MenuItem, seed: DealSeed): Promise<Deal> {
  return deals.insert(
    db,
    {
      venueId: item.venueId,
      menuItemId: item.id,
      priceRub: seed.priceRub ?? Math.floor(item.priceRub / 2),
      quantity: seed.quantity ?? 5,
      endsAt: seed.endsAt,
    },
    seed.startsAt,
  );
}
