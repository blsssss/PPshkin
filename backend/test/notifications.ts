import { vi } from 'vitest';
import type { Queryable } from '../src/db/pool.ts';
import type { NotificationEvent } from '../src/domain/notifications.ts';
import type { Notifications } from '../src/ports/notifier.ts';

export function recordingNotifications() {
  const events: NotificationEvent[] = [];
  const notifications = {
    enqueue: vi.fn<Notifications['enqueue']>((_db, event) => {
      events.push(event);
      return Promise.resolve();
    }),
    flush: vi.fn<Notifications['flush']>(),
  } satisfies Notifications;
  return {
    notifications,
    events,
    kinds: () => events.map((event) => event.kind),
    clear: () => {
      events.length = 0;
      notifications.enqueue.mockClear();
      notifications.flush.mockClear();
    },
  };
}

interface QueuedRow {
  userId: number;
  kind: string;
  status: string;
  subject: Record<string, unknown>;
  attempts: number;
  silent: boolean;
  lastError: string | null;
  sendAfter: Date;
  expiresAt: Date;
  messageId: string | null;
}

export async function queuedNotifications(db: Queryable): Promise<QueuedRow[]> {
  const { rows } = await db.query<{
    user_id: number;
    kind: string;
    status: string;
    subject: Record<string, unknown>;
    attempts: number;
    silent: boolean;
    last_error: string | null;
    send_after: Date;
    expires_at: Date;
    message_id: string | null;
  }>(
    `select user_id, kind, status, subject, attempts, silent, last_error, send_after, expires_at, message_id
       from notifications order by id`,
  );
  return rows.map((row) => ({
    userId: row.user_id,
    kind: row.kind,
    status: row.status,
    subject: row.subject,
    attempts: row.attempts,
    silent: row.silent,
    lastError: row.last_error,
    sendAfter: row.send_after,
    expiresAt: row.expires_at,
    messageId: row.message_id,
  }));
}
