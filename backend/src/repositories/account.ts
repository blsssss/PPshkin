import type { Queryable } from '../db/pool.ts';

export async function eraseOfferExplanations(db: Queryable, userId: number): Promise<void> {
  await db.query(`update offers set explanation = '{}'::jsonb where user_id = $1`, [userId]);
}

export async function removeDemoVenueCopies(db: Queryable, userId: number): Promise<void> {
  await db.query('delete from venues where owner_id = $1 and demo_source_id is not null', [userId]);
}

export async function eraseOfferExplanationsBefore(db: Queryable, before: Date): Promise<number> {
  const { rowCount } = await db.query(
    `update offers o set explanation = '{}'::jsonb
       from venues v
      where v.id = o.venue_id and not v.is_demo and (o.user_id is null or o.user_id > 0)
        and o.created_at < $1 and o.explanation <> '{}'::jsonb`,
    [before],
  );
  return rowCount ?? 0;
}
