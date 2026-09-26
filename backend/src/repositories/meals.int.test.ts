import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import * as meals from './meals.ts';
import * as users from './users.ts';

const pool = testPool();

const meal = (userId: number, eatenAt: string, overrides: Partial<meals.NewMeal> = {}): meals.NewMeal => ({
  userId,
  title: 'Сырники',
  kcalMin: 320,
  kcalMax: 380,
  proteinG: 18,
  fatG: 14,
  carbsG: 30,
  tags: ['dairy', 'breakfast'],
  source: 'manual',
  confidence: null,
  eatenAt: new Date(eatenAt),
  ...overrides,
});

beforeEach(async () => {
  await resetDatabase(pool);
  await users.upsert(pool, { id: 1, firstName: 'Ира', username: null });
  await users.upsert(pool, { id: 2, firstName: 'Олег', username: null });
});

afterAll(async () => {
  await closeTestPool();
});

describe('meals repository', () => {
  it('inserts a meal and reads it back for its owner only', async () => {
    const created = await meals.insert(
      pool,
      meal(1, '2026-09-25T06:30:00Z', { source: 'photo', confidence: 0.8, proteinG: null }),
    );
    expect(created).toMatchObject({
      userId: 1,
      title: 'Сырники',
      kcalMin: 320,
      kcalMax: 380,
      proteinG: null,
      tags: ['dairy', 'breakfast'],
      source: 'photo',
      confidence: 0.8,
      eatenAt: new Date('2026-09-25T06:30:00Z'),
    });
    expect(await meals.findById(pool, 1, created.id)).toEqual(created);
    expect(await meals.findById(pool, 2, created.id)).toBeNull();
  });

  it('accepts every meal source', async () => {
    for (const source of ['photo', 'text', 'manual', 'booking', 'demo'] as const) {
      await expect(meals.insert(pool, meal(1, '2026-09-25T06:30:00Z', { source }))).resolves.toMatchObject({
        source,
      });
    }
  });

  it('updates only the passed fields of an own meal', async () => {
    const created = await meals.insert(pool, meal(1, '2026-09-25T06:30:00Z'));
    const updated = await meals.update(pool, 1, created.id, {
      title: 'Овсянка',
      kcalMin: 250,
      kcalMax: 250,
      proteinG: null,
      tags: ['grain'],
      eatenAt: new Date('2026-09-25T07:00:00Z'),
    });
    expect(updated).toMatchObject({
      title: 'Овсянка',
      kcalMin: 250,
      kcalMax: 250,
      proteinG: null,
      fatG: 14,
      carbsG: 30,
      tags: ['grain'],
      eatenAt: new Date('2026-09-25T07:00:00Z'),
    });
    expect(await meals.update(pool, 1, created.id, {})).toEqual(updated);
  });

  it('does not update or remove a meal of another user', async () => {
    const created = await meals.insert(pool, meal(1, '2026-09-25T06:30:00Z'));
    expect(await meals.update(pool, 2, created.id, { title: 'Чужое' })).toBeNull();
    expect(await meals.update(pool, 2, created.id, {})).toBeNull();
    expect(await meals.remove(pool, 2, created.id)).toBe(false);
    expect(await meals.findById(pool, 1, created.id)).toMatchObject({ title: 'Сырники' });
  });

  it('removes an own meal once', async () => {
    const created = await meals.insert(pool, meal(1, '2026-09-25T06:30:00Z'));
    expect(await meals.remove(pool, 1, created.id)).toBe(true);
    expect(await meals.remove(pool, 1, created.id)).toBe(false);
  });

  it('lists meals in a half-open interval in eating order', async () => {
    const late = await meals.insert(pool, meal(1, '2026-09-25T18:00:00Z', { title: 'Ужин' }));
    const early = await meals.insert(pool, meal(1, '2026-09-25T06:00:00Z', { title: 'Завтрак' }));
    await meals.insert(pool, meal(1, '2026-09-26T00:00:00Z', { title: 'Следующий день' }));
    await meals.insert(pool, meal(2, '2026-09-25T12:00:00Z', { title: 'Чужой обед' }));
    const listed = await meals.listBetween(
      pool,
      1,
      new Date('2026-09-25T06:00:00Z'),
      new Date('2026-09-26T00:00:00Z'),
    );
    expect(listed.map((item) => item.id)).toEqual([early.id, late.id]);
  });

  it('lists meals since a moment in eating order', async () => {
    await meals.insert(pool, meal(1, '2026-09-20T12:00:00Z', { title: 'Давно' }));
    const second = await meals.insert(pool, meal(1, '2026-09-25T12:00:00Z', { title: 'Обед' }));
    const first = await meals.insert(pool, meal(1, '2026-09-24T08:00:00Z', { title: 'Завтрак' }));
    await meals.insert(pool, meal(2, '2026-09-25T12:00:00Z', { title: 'Чужой обед' }));
    const listed = await meals.listSince(pool, 1, new Date('2026-09-24T08:00:00Z'));
    expect(listed.map((item) => item.id)).toEqual([first.id, second.id]);
  });

  it('drops unknown tags stored earlier', async () => {
    const created = await meals.insert(pool, meal(1, '2026-09-25T06:30:00Z'));
    await pool.query(`update meals set tags = '{dairy,unknown}' where id = $1`, [created.id]);
    expect((await meals.findById(pool, 1, created.id))?.tags).toEqual(['dairy']);
  });
});
