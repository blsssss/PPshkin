import type { Queryable } from '../db/pool.ts';
import type { ConsentKind } from '../domain/vocabulary.ts';

export interface ProactiveCandidate {
  userId: number;
  timezone: string;
}

interface CandidateQuery {
  now: Date;
  consentVersions: Readonly<Record<ConsentKind, string>>;
  limit: number;
  afterUserId?: number;
}

export async function findProactiveCandidates(
  db: Queryable,
  { now, consentVersions, limit, afterUserId = 0 }: CandidateQuery,
): Promise<ProactiveCandidate[]> {
  const { rows } = await db.query<{ id: number; timezone: string }>(
    `select u.id, u.timezone
       from users u
      where u.id > 0
        and u.id > $4
        and u.location_lat is not null
        and u.location_updated_at >= $1::timestamptz - interval '12 hours'
        and exists (
              select 1 from consents c
               where c.user_id = u.id and c.kind = 'personal_data' and c.version = $2 and c.revoked_at is null)
        and exists (
              select 1 from consents c
               where c.user_id = u.id and c.kind = 'personalized_offers' and c.version = $3
                 and c.revoked_at is null)
        and not exists (
              select 1 from offers o
               where o.user_id = u.id and o.channel = 'push'
                 and o.created_at > $1::timestamptz - interval '24 hours')
      order by u.id
      limit $5`,
    [now, consentVersions.personal_data, consentVersions.personalized_offers, afterUserId, limit],
  );
  return rows.map((row) => ({ userId: row.id, timezone: row.timezone }));
}

export async function discardUnsentOffer(db: Queryable, offerId: number): Promise<void> {
  await db.query(`delete from offers where id = $1 and channel = 'push' and status = 'shown'`, [offerId]);
}
