import { jsonb, type Queryable } from '../db/pool.ts';
import type { AuditAction, AuditChannel, AuditTarget } from '../domain/audit.ts';

export interface AuditEntry {
  venueId: number | null;
  actorUserId: number;
  action: AuditAction;
  target: { type: AuditTarget; id: number | null };
  channel: AuditChannel;
  details: Record<string, unknown>;
}

export interface AuditRow {
  id: number;
  actorUserId: number | null;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: number | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditPage {
  from: Date;
  to: Date;
  beforeId: number | null;
  limit: number;
}

export async function record(db: Queryable, entry: AuditEntry, now: Date): Promise<void> {
  await db.query(
    `insert into audit_events (venue_id, actor_user_id, action, target_type, target_id, details, created_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      entry.venueId,
      entry.actorUserId,
      entry.action,
      entry.target.type,
      entry.target.id,
      jsonb({ ...entry.details, channel: entry.channel }),
      now,
    ],
  );
}

export async function listInVenue(db: Queryable, venueId: number, page: AuditPage): Promise<AuditRow[]> {
  const { rows } = await db.query<AuditRow>(
    `select a.id, a.actor_user_id as "actorUserId", u.first_name as "actorName",
            a.action, a.target_type as "targetType", a.target_id as "targetId", a.details,
            a.created_at as "createdAt"
       from audit_events a
       left join users u on u.id = a.actor_user_id
      where a.venue_id = $1 and a.action not like 'admin.%' and a.created_at >= $2 and a.created_at < $3
        and ($4::bigint is null or a.id < $4)
      order by a.id desc
      limit $5`,
    [venueId, page.from, page.to, page.beforeId, page.limit],
  );
  return rows;
}

export async function purgeCreatedBefore(db: Queryable, before: Date): Promise<number> {
  const { rowCount } = await db.query('delete from audit_events where created_at < $1', [before]);
  return rowCount ?? 0;
}
