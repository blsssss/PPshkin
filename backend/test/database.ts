import { createPool, type Pool } from '../src/db/pool.ts';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://ppshkin:ppshkin@127.0.0.1:55432/ppshkin_test';

let shared: Pool | undefined;

export function testPool(): Pool {
  shared ??= createPool(TEST_DATABASE_URL, 4);
  return shared;
}

export async function closeTestPool(): Promise<void> {
  await shared?.end();
  shared = undefined;
}

export async function resetDatabase(pool: Pool = testPool()): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables
      where schemaname = 'public' and tablename <> 'schema_migrations'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"${row.tablename}"`).join(', ');
  await pool.query(`truncate ${tables} restart identity cascade`);
}
