import type { Queryable } from '../db/pool.ts';

export async function eraseOfferExplanations(db: Queryable, userId: number): Promise<void> {
  await db.query(`update offers set explanation = '{}'::jsonb where user_id = $1`, [userId]);
}

export async function removeDemoVenueCopies(db: Queryable, userId: number): Promise<void> {
  await db.query('delete from venues where owner_id = $1 and demo_source_id is not null', [userId]);
}
