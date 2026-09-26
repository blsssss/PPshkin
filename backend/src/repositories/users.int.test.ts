import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { withTransaction } from '../db/pool.ts';
import * as users from './users.ts';

const pool = testPool();

beforeEach(async () => {
  await resetDatabase(pool);
});

afterAll(async () => {
  await closeTestPool();
});

describe('users repository', () => {
  it('creates a user with product defaults', async () => {
    const user = await users.upsert(pool, { id: 396272693, firstName: 'Ира', username: null });
    expect(user).toMatchObject({
      id: 396272693,
      firstName: 'Ира',
      username: null,
      timezone: 'Europe/Moscow',
      kcalTarget: 2000,
      goal: null,
      dislikedTags: [],
      location: null,
    });
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('keeps known names when the identity arrives without them', async () => {
    await users.upsert(pool, { id: 7, firstName: 'Олег', username: 'oleg' });
    const again = await users.upsert(pool, { id: 7, firstName: null, username: null });
    expect(again).toMatchObject({ firstName: 'Олег', username: 'oleg' });
  });

  it('updates names that changed', async () => {
    const created = await users.upsert(pool, { id: 8, firstName: 'Аня', username: null });
    const renamed = await users.upsert(pool, { id: 8, firstName: 'Анна', username: 'anna' });
    expect(renamed).toMatchObject({ firstName: 'Анна', username: 'anna' });
    expect(renamed.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it('returns the existing row unchanged for an identical identity', async () => {
    const created = await users.upsert(pool, { id: 9, firstName: 'Лев', username: null });
    const same = await users.upsert(pool, { id: 9, firstName: 'Лев', username: null });
    expect(same).toEqual(created);
  });

  it('maps location and ignores unknown disliked tags', async () => {
    await users.upsert(pool, { id: 10, firstName: null, username: null });
    await pool.query(
      `update users set location_lat = 55.79, location_lon = 49.12, disliked_tags = '{fish,unknown}' where id = 10`,
    );
    const user = await users.findById(pool, 10);
    expect(user?.location).toEqual({ lat: 55.79, lon: 49.12 });
    expect(user?.dislikedTags).toEqual(['fish']);
  });

  it('handles concurrent first contacts of the same user', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => users.upsert(pool, { id: 11, firstName: 'Ян', username: null })),
    );
    expect(new Set(results.map((user) => user.id))).toEqual(new Set([11]));
  });

  it('returns null for an unknown user', async () => {
    expect(await users.findById(pool, 404)).toBeNull();
  });

  it('updates only the profile fields that are passed', async () => {
    const created = await users.upsert(pool, { id: 12, firstName: 'Нина', username: null });
    const first = await users.updateProfile(pool, 12, { kcalTarget: 1700, goal: 'lose' });
    expect(first).toMatchObject({
      kcalTarget: 1700,
      goal: 'lose',
      timezone: 'Europe/Moscow',
      dislikedTags: [],
    });
    expect(first?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

    const second = await users.updateProfile(pool, 12, {
      goal: null,
      dislikedTags: ['fish', 'spicy'],
      timezone: 'Asia/Yekaterinburg',
    });
    expect(second).toMatchObject({
      kcalTarget: 1700,
      goal: null,
      dislikedTags: ['fish', 'spicy'],
      timezone: 'Asia/Yekaterinburg',
    });
  });

  it('returns null when updating a missing user', async () => {
    expect(await users.updateProfile(pool, 404, { kcalTarget: 1800 })).toBeNull();
    expect(await users.setLocation(pool, 404, { lat: 1, lon: 1 }, new Date())).toBeNull();
  });

  it('stores the location rounded to about a kilometre with the given time', async () => {
    await users.upsert(pool, { id: 13, firstName: null, username: null });
    const at = new Date('2026-09-25T10:00:00Z');
    const user = await users.setLocation(pool, 13, { lat: 55.796389, lon: 49.108891 }, at);
    expect(user?.location).toEqual({ lat: 55.8, lon: 49.11 });
    expect(user?.locationUpdatedAt).toEqual(at);
  });

  it('clears the location and keeps doing so on repeat', async () => {
    await users.upsert(pool, { id: 14, firstName: null, username: null });
    await users.setLocation(pool, 14, { lat: 55.79, lon: 49.12 }, new Date('2026-09-25T10:00:00Z'));
    await users.clearLocation(pool, 14);
    await users.clearLocation(pool, 14);
    expect(await users.findById(pool, 14)).toMatchObject({ location: null, locationUpdatedAt: null });
  });

  it('locks an existing user against changes but not against new references', async () => {
    await users.upsert(pool, { id: 16, firstName: null, username: null });
    await withTransaction(pool, async (client) => {
      expect(await users.lock(client, 16)).toBe(true);
      expect(await users.lock(client, 404)).toBe(false);
      await expect(
        pool.query('select id from users where id = 16 for no key update nowait'),
      ).rejects.toMatchObject({ code: '55P03' });
      await expect(
        pool.query('select id from users where id = 16 for key share nowait'),
      ).resolves.toMatchObject({ rowCount: 1 });
    });
  });

  it('removes a user', async () => {
    await users.upsert(pool, { id: 15, firstName: null, username: null });
    await users.remove(pool, 15);
    expect(await users.findById(pool, 15)).toBeNull();
    await expect(users.remove(pool, 15)).resolves.toBeUndefined();
  });
});
