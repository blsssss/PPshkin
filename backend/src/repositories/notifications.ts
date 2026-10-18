import { jsonb, type Queryable } from '../db/pool.ts';
import type { NotificationKind, NotificationStatus, NotificationSubject } from '../domain/notifications.ts';

interface NotificationRow {
  id: number;
  user_id: number;
  kind: string;
  subject: NotificationSubject;
  status: NotificationStatus;
  silent: boolean;
  attempts: number;
  send_after: Date;
  expires_at: Date;
  created_at: Date;
}

export interface QueuedNotification {
  id: number;
  userId: number;
  kind: string;
  subject: NotificationSubject;
  status: NotificationStatus;
  silent: boolean;
  attempts: number;
  sendAfter: Date;
  expiresAt: Date;
  createdAt: Date;
}

export interface NewNotification {
  userId: number;
  kind: NotificationKind;
  dedupKey: string;
  subject: NotificationSubject;
  sendAfter: Date;
  expiresAt: Date;
  createdAt: Date;
}

interface FinishedNotification {
  id: number;
  kind: string;
}

const NOTIFICATION_COLUMNS =
  'n.id, n.user_id, n.kind, n.subject, n.status, n.silent, n.attempts, n.send_after, n.expires_at, n.created_at';

const ERROR_LIMIT = 500;

function mapNotification(row: NotificationRow): QueuedNotification {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    subject: row.subject,
    status: row.status,
    silent: row.silent,
    attempts: row.attempts,
    sendAfter: row.send_after,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function errorText(error: string): string {
  return error.slice(0, ERROR_LIMIT);
}

export async function insert(db: Queryable, notification: NewNotification): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into notifications (user_id, kind, dedup_key, subject, send_after, expires_at, created_at)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7)
     on conflict (dedup_key) do nothing`,
    [
      notification.userId,
      notification.kind,
      notification.dedupKey,
      jsonb(notification.subject),
      notification.sendAfter,
      notification.expiresAt,
      notification.createdAt,
    ],
  );
  return rowCount === 1;
}

export async function releaseStuck(db: Queryable, claimedBefore: Date): Promise<number> {
  const { rowCount } = await db.query(
    `update notifications set status = 'pending', claimed_at = null
      where status = 'sending' and claimed_at < $1`,
    [claimedBefore],
  );
  return rowCount ?? 0;
}

export async function expireOverdue(db: Queryable, now: Date): Promise<FinishedNotification[]> {
  const { rows } = await db.query<FinishedNotification>(
    `update notifications set status = 'expired', claimed_at = null
      where status = 'pending' and expires_at <= $1
      returning id, kind`,
    [now],
  );
  return rows;
}

export async function claimDue(db: Queryable, now: Date, limit: number): Promise<QueuedNotification[]> {
  const { rows } = await db.query<NotificationRow>(
    `update notifications as n set status = 'sending', claimed_at = $1, attempts = n.attempts + 1
      where n.id in (
        select id from notifications
         where status = 'pending' and send_after <= $1
         order by created_at, id
         limit $2
         for update skip locked
      )
      returning ${NOTIFICATION_COLUMNS}`,
    [now, limit],
  );
  return rows
    .map(mapNotification)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
}

export async function markSent(db: Queryable, id: number, messageId: string, now: Date): Promise<void> {
  await db.query(
    `update notifications set status = 'sent', sent_at = $3, message_id = $2, last_error = null
      where id = $1 and status = 'sending'`,
    [id, messageId, now],
  );
}

export async function finish(
  db: Queryable,
  id: number,
  status: Extract<NotificationStatus, 'skipped' | 'unreachable' | 'failed' | 'expired'>,
  error: string | null,
): Promise<void> {
  await db.query(
    `update notifications set status = $2, last_error = $3
      where id = $1 and status = 'sending'`,
    [id, status, error === null ? null : errorText(error)],
  );
}

export async function reschedule(db: Queryable, id: number, sendAfter: Date, error: string): Promise<void> {
  await db.query(
    `update notifications set status = 'pending', send_after = $2, claimed_at = null, last_error = $3
      where id = $1 and status = 'sending'`,
    [id, sendAfter, errorText(error)],
  );
}

export async function purgeCreatedBefore(db: Queryable, before: Date): Promise<number> {
  const { rowCount } = await db.query('delete from notifications where created_at < $1', [before]);
  return rowCount ?? 0;
}
