import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
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
});
