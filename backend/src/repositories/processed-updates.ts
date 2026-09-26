import type { Queryable } from '../db/pool.ts';

export async function markProcessed(db: Queryable, key: string): Promise<boolean> {
  const result = await db.query(
    'insert into processed_updates (key) values ($1) on conflict (key) do nothing',
    [key],
  );
  return result.rowCount === 1;
}

export async function purgeProcessedBefore(db: Queryable, before: Date): Promise<number> {
  const result = await db.query('delete from processed_updates where processed_at < $1', [before]);
  return result.rowCount ?? 0;
}
