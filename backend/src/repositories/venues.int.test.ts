import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { BAUMANA, KAZAN_ARENA, KREMLIN, seedDemoCopy, seedDemoVenue, seedUser } from '../../test/venues.ts';
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
    expect(await venues.findByIds(pool, [venue!.id])).toEqual([venue]);
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
    expect(await venues.listVisibleWithin(pool, box, 1)).toEqual([baumana]);
    expect(await venues.listVisible(pool, 1)).toEqual([baumana, arena]);
    expect(await venues.findByOwner(pool, 404)).toBeNull();
    expect(await venues.findByIds(pool, [404])).toEqual([]);
  });

  it('finds venues by ids in id order', async () => {
    const baumana = await venues.insert(pool, 1, fields, createdAt);
    const arena = await venues.insert(pool, 2, { ...fields, location: KAZAN_ARENA }, createdAt);
    expect(await venues.findByIds(pool, [arena!.id, 404, baumana!.id])).toEqual([baumana, arena]);
    expect(await venues.findByIds(pool, [])).toEqual([]);
  });
});

describe('demo venue visibility', () => {
  const seeded = 900001;
  const everywhere = { minLat: 55, maxLat: 56, minLon: 49, maxLon: 50 };
  const visibleIds = async (viewer: number) =>
    (await venues.listVisible(pool, viewer)).map((venue) => venue.id);

  it('shows regular and seeded demo venues to everyone', async () => {
    const regular = await venues.insert(pool, 1, fields, createdAt);
    await seedDemoVenue(pool, seeded, { name: 'Кофейня «Зерно»' }, -1002);
    expect(await visibleIds(2)).toEqual([regular!.id, seeded]);
    expect(await visibleIds(-1001)).toEqual([regular!.id, seeded]);
    expect(await venues.findVisible(pool, seeded, 2)).toMatchObject({
      id: seeded,
      isDemo: true,
      ownerId: -1002,
    });
  });

  it('replaces the seeded venue with the copy for its owner and hides the copy from others', async () => {
    await seedDemoVenue(pool, seeded);
    const copy = await seedDemoCopy(pool, seeded, 7);
    expect(await visibleIds(7)).toEqual([copy.id]);
    expect(await visibleIds(8)).toEqual([seeded]);
    expect((await venues.listVisibleWithin(pool, everywhere, 7)).map((venue) => venue.id)).toEqual([copy.id]);
    expect((await venues.listVisibleWithin(pool, everywhere, 8)).map((venue) => venue.id)).toEqual([seeded]);
    expect(await venues.findVisible(pool, copy.id, 7)).toEqual(copy);
    expect(await venues.findVisible(pool, copy.id, 8)).toBeNull();
    expect(await venues.findVisible(pool, seeded, 7)).toBeNull();
  });

  it('hides a copy whose owner deleted the account from everyone', async () => {
    await seedDemoVenue(pool, seeded);
    const copy = await seedDemoCopy(pool, seeded, 7);
    await pool.query('delete from users where id = 7');
    expect(await visibleIds(8)).toEqual([seeded]);
    expect(await venues.findVisible(pool, copy.id, 8)).toBeNull();
  });

  it('copies a seeded demo venue once per owner', async () => {
    const source = await seedDemoVenue(pool, seeded, { opensAt: '07:30', closesAt: '21:00' }, -1002);
    const now = new Date('2026-09-26T09:00:00Z');
    const copy = await venues.insertDemoCopy(pool, seeded, 1, now);
    expect(copy).toEqual({
      ...source,
      id: expect.any(Number) as number,
      ownerId: 1,
      createdAt: now,
      updatedAt: now,
    });
    expect(copy!.id).toBeLessThan(seeded);
    const { rows } = await pool.query<{ demo_source_id: number }>(
      'select demo_source_id from venues where id = $1',
      [copy!.id],
    );
    expect(rows[0]?.demo_source_id).toBe(seeded);
    expect(await venues.insertDemoCopy(pool, seeded, 1, now)).toBeNull();
  });

  it('finds only seeded demo venues as copy sources', async () => {
    const regular = await venues.insert(pool, 1, fields, createdAt);
    await seedDemoVenue(pool, seeded, {}, -1002);
    await seedDemoVenue(pool, 900002);
    const copy = await seedDemoCopy(pool, 900002, 7);
    expect((await venues.findSeededDemo(pool, seeded))?.id).toBe(seeded);
    expect((await venues.findSeededDemo(pool, 900002))?.id).toBe(900002);
    expect(await venues.findSeededDemo(pool, regular!.id)).toBeNull();
    expect(await venues.findSeededDemo(pool, copy.id)).toBeNull();
    expect(await venues.findSeededDemo(pool, 404)).toBeNull();
  });
});
