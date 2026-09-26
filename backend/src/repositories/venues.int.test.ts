import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { BAUMANA, KAZAN_ARENA, KREMLIN, seedUser } from '../../test/venues.ts';
import * as venues from './venues.ts';

const pool = testPool();
const createdAt = new Date('2026-09-25T09:00:00Z');

const fields: venues.VenueFields = {
  name: 'Зерно',
  address: 'ул. Баумана, 36',
  category: 'coffee',
  location: BAUMANA,
  opensAt: '07:30',
  closesAt: '01:15',
  timezone: 'Europe/Moscow',
};

beforeEach(async () => {
  await resetDatabase(pool);
  await seedUser(pool, 1);
  await seedUser(pool, 2);
});

afterAll(async () => {
  await closeTestPool();
});

describe('venues repository', () => {
  it('stores a venue and returns its hours as HH:MM', async () => {
    const venue = await venues.insert(pool, 1, fields, createdAt);
    expect(venue).toEqual({
      id: expect.any(Number) as number,
      ownerId: 1,
      ...fields,
      isDemo: false,
      createdAt,
      updatedAt: createdAt,
    });
    const { rows } = await pool.query<{ opens_at: string }>('select opens_at from venues');
    expect(rows[0]?.opens_at).toBe('07:30:00');
    expect(await venues.findById(pool, venue!.id)).toEqual(venue);
    expect(await venues.findByOwner(pool, 1)).toEqual(venue);
    expect(await venues.lockByOwner(pool, 1)).toEqual(venue);
  });

  it('returns null instead of a second venue for the same owner', async () => {
    await venues.insert(pool, 1, fields, createdAt);
    expect(await venues.insert(pool, 1, { ...fields, name: 'Второе' }, createdAt)).toBeNull();
    expect(await venues.insert(pool, 2, { ...fields, name: 'Второе' }, createdAt)).not.toBeNull();
  });

  it('changes only the given fields', async () => {
    const venue = await venues.insert(pool, 1, fields, createdAt);
    const updatedAt = new Date('2026-09-25T10:00:00Z');
    const updated = await venues.update(pool, venue!.id, { location: KREMLIN, opensAt: '09:00' }, updatedAt);
    expect(updated).toEqual({ ...venue, location: KREMLIN, opensAt: '09:00', updatedAt });
  });

  it('lists venues inside a bounding box', async () => {
    const baumana = await venues.insert(pool, 1, fields, createdAt);
    const arena = await venues.insert(pool, 2, { ...fields, location: KAZAN_ARENA }, createdAt);
    const box = { minLat: 55.78, maxLat: 55.8, minLon: 49.1, maxLon: 49.13 };
    expect(await venues.listWithin(pool, box)).toEqual([baumana]);
    expect(await venues.listAll(pool)).toEqual([baumana, arena]);
    expect(await venues.findByOwner(pool, 404)).toBeNull();
    expect(await venues.findById(pool, 404)).toBeNull();
  });
});
