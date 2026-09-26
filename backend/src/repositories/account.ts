import type { Queryable } from '../db/pool.ts';

export async function eraseOfferExplanations(db: Queryable, userId: number): Promise<void> {
  await db.query(`update offers set explanation = '{}'::jsonb where user_id = $1`, [userId]);
}
