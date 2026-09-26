import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { createChatStateStore } from '../bot/state.ts';
import * as chatStates from './chat-states.ts';
import * as users from './users.ts';

const pool = testPool();

beforeEach(async () => {
  await resetDatabase(pool);
  await users.upsert(pool, { id: 101, firstName: 'Анна', username: null });
});

afterAll(async () => {
  await closeTestPool();
});

const fixFlow = { name: 'meal_fix', mealId: 5, expiresAt: '2026-09-26T09:30:00.000Z' };

describe('chat states repository', () => {
  it('returns null for a guest without a stored dialog', async () => {
    expect(await chatStates.load(pool, 101)).toBeNull();
  });

  it('saves and overwrites the state of a guest', async () => {
    await chatStates.save(pool, 101, { flow: fixFlow, pendingStart: null });
    expect(await chatStates.load(pool, 101)).toEqual({ flow: fixFlow, pendingStart: null });

    const { rows: before } = await pool.query<{ updated_at: Date }>(
      'select updated_at from chat_states where user_id = 101',
    );
    await chatStates.save(pool, 101, { flow: null, pendingStart: 'v_7' });
    expect(await chatStates.load(pool, 101)).toEqual({ flow: null, pendingStart: 'v_7' });
    const { rows: after } = await pool.query<{ updated_at: Date; count: number }>(
      'select updated_at, count(*) over () as count from chat_states where user_id = 101',
    );
    expect(after[0]?.count).toBe(1);
    expect(after[0]?.updated_at.getTime()).toBeGreaterThanOrEqual(before[0]?.updated_at.getTime() ?? 0);
  });

  it('clears the state and tolerates clearing twice', async () => {
    await chatStates.save(pool, 101, { flow: fixFlow, pendingStart: null });
    await chatStates.clear(pool, 101);
    await chatStates.clear(pool, 101);
    expect(await chatStates.load(pool, 101)).toBeNull();
  });

  it('is removed together with the user', async () => {
    await chatStates.save(pool, 101, { flow: fixFlow, pendingStart: null });
    await users.remove(pool, 101);
    const { rowCount } = await pool.query('select 1 from chat_states where user_id = 101');
    expect(rowCount).toBe(0);
  });

  it('keeps states of different guests apart', async () => {
    await users.upsert(pool, { id: 102, firstName: null, username: null });
    await chatStates.save(pool, 101, { flow: fixFlow, pendingStart: null });
    await chatStates.save(pool, 102, { flow: null, pendingStart: 'd_3' });
    expect(await chatStates.load(pool, 101)).toMatchObject({ flow: fixFlow });
    expect(await chatStates.load(pool, 102)).toMatchObject({ pendingStart: 'd_3' });
  });
});

describe('chat state store', () => {
  it('round trips a state through jsonb', async () => {
    const store = createChatStateStore(pool);
    await store.save(101, {
      flow: { name: 'kcal_input', from: 'ob', expiresAt: fixFlow.expiresAt },
      pendingStart: null,
    });
    expect(await store.load(101)).toEqual({
      flow: { name: 'kcal_input', from: 'ob', expiresAt: fixFlow.expiresAt },
      pendingStart: null,
    });
    await store.clear(101);
    expect(await store.load(101)).toEqual({ flow: null, pendingStart: null });
  });

  it('reads a broken record as an empty state', async () => {
    await pool.query(`insert into chat_states (user_id, state) values (101, '{"flow":{"name":"lost"}}')`);
    expect(await createChatStateStore(pool).load(101)).toEqual({ flow: null, pendingStart: null });
  });
});
