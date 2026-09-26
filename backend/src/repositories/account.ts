import type { Queryable } from '../db/pool.ts';

export async function cancelActiveBookings(db: Queryable, userId: number, at: Date): Promise<void> {
  await db.query(
    `with cancelled as (
       update bookings set status = 'cancelled', resolved_at = $2
        where user_id = $1 and status = 'active'
       returning deal_id
     )
     update deals d
        set quantity_left = least(d.quantity_total, d.quantity_left + c.units)
       from (select deal_id, count(*)::int as units from cancelled where deal_id is not null group by deal_id) c
      where d.id = c.deal_id and d.cancelled_at is null and d.ends_at > $2`,
    [userId, at],
  );
}

export async function eraseOfferExplanations(db: Queryable, userId: number): Promise<void> {
  await db.query(`update offers set explanation = '{}'::jsonb where user_id = $1`, [userId]);
}
