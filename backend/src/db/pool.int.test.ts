import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, TEST_DATABASE_URL, testPool } from '../../test/database.ts';
import { createPool, jsonb, maybeOne, one, withTransaction } from './pool.ts';

const pool = testPool();

beforeEach(async () => {
  await resetDatabase(pool);
});

afterAll(async () => {
  await closeTestPool();
});

describe('database helpers', () => {
  it('parses bigint columns as numbers', async () => {
    const row = await one<{ value: number }>(pool, 'select 9007199254740991::bigint as value');
    expect(row.value).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects bigint values outside the safe range', async () => {
    await expect(pool.query('select 9007199254740993::bigint as value')).rejects.toThrow(RangeError);
  });

  it('parses bigint arrays and numeric aggregates as numbers', async () => {
    const row = await one<{ ids: number[]; total: number; average: number }>(
      pool,
      `select array[1, 2, 3]::bigint[] as ids, sum(x)::numeric as total, avg(x) as average
         from unnest(array[1, 2]::bigint[]) as x`,
    );
    expect(row).toEqual({ ids: [1, 2, 3], total: 3, average: 1.5 });
  });

  it('round trips jsonb values written with the helper', async () => {
    const value = [{ name: 'Эклер', tags: ['sweet'] }];
    const row = await one<{ value: unknown }>(pool, 'select $1::jsonb as value', [jsonb(value)]);
    expect(row.value).toEqual(value);
  });

  it('survives an idle connection being terminated', async () => {
    const errors: Error[] = [];
    const fragile = createPool(TEST_DATABASE_URL, { max: 1, onError: (error) => errors.push(error) });
    try {
      const { pid } = await one<{ pid: number }>(fragile, 'select pg_backend_pid() as pid');
      await pool.query('select pg_terminate_backend($1)', [pid]);
      await expect.poll(() => errors.length, { timeout: 5_000 }).toBe(1);
      expect(await one(fragile, 'select 1 as ok')).toEqual({ ok: 1 });
    } finally {
      await fragile.end();
    }
  });

  it('commits a successful transaction', async () => {
    await withTransaction(pool, async (client) => {
      await client.query('insert into users (id) values (1)');
    });
    expect(await maybeOne(pool, 'select id from users where id = 1')).toEqual({ id: 1 });
  });

  it('rolls back a failed transaction', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        await client.query('insert into users (id) values (2)');
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await maybeOne(pool, 'select id from users where id = 2')).toBeNull();
  });

  it('fails loudly when a single row is expected but missing', async () => {
    await expect(one(pool, 'select id from users where id = -1')).rejects.toThrow(/exactly one row/);
  });
});
