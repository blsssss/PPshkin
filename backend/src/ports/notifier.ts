import type { Queryable } from '../db/pool.ts';
import type { NotificationEvent } from '../domain/notifications.ts';

export interface Notifications {
  enqueue(db: Queryable, event: NotificationEvent, now: Date): Promise<void>;
  flush(): void;
}
