import type { Queryable } from '../db/pool.ts';

export type ImpressionSource = 'catalog' | 'venue_card' | 'deal_card';

export interface Impression {
  dealId: number;
  day: string;
}

export async function record(
  db: Queryable,
  userId: number,
  impressions: readonly Impression[],
  source: ImpressionSource,
  now: Date,
): Promise<void> {
  if (impressions.length === 0) return;
  await db.query(
    `insert into deal_impressions (deal_id, user_id, day, source, created_at)
     select shown.deal_id, $1, shown.day, $2, $3
       from unnest($4::bigint[], $5::date[]) as shown (deal_id, day)
     on conflict (deal_id, user_id, day) do nothing`,
    [userId, source, now, impressions.map(({ dealId }) => dealId), impressions.map(({ day }) => day)],
  );
}

export async function purgeCreatedBefore(db: Queryable, before: Date): Promise<number> {
  const { rowCount } = await db.query('delete from deal_impressions where created_at < $1', [before]);
  return rowCount ?? 0;
}
