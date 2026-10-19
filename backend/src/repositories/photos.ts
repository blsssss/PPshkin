import type { Queryable } from '../db/pool.ts';

const PHOTO_LOCK = 727_274_018;

export async function lockPhotos(db: Queryable): Promise<void> {
  await db.query('select pg_advisory_xact_lock($1)', [PHOTO_LOCK]);
}

export async function isReferenced(db: Queryable, key: string): Promise<boolean> {
  const { rows } = await db.query<{ used: boolean }>(
    `select exists (select 1 from venues where photo_key = $1)
         or exists (select 1 from menu_items where photo_key = $1) as used`,
    [key],
  );
  return rows[0]?.used ?? false;
}
