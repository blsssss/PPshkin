import { maybeOne, one, type Queryable } from '../db/pool.ts';
import {
  DEFAULT_PREFERENCES,
  isNotificationKind,
  type NotificationPreferences,
  type QuietHours,
} from '../domain/notifications.ts';

interface SettingsRow {
  disabled_kinds: string[];
  quiet_from: string | null;
  quiet_until: string | null;
}

function clock(time: string): string {
  return time.slice(0, 5);
}

function mapSettings(row: SettingsRow): NotificationPreferences {
  return {
    disabledKinds: row.disabled_kinds.filter(isNotificationKind),
    quietHours:
      row.quiet_from === null || row.quiet_until === null
        ? null
        : { from: clock(row.quiet_from), until: clock(row.quiet_until) },
  };
}

export async function find(db: Queryable, userId: number): Promise<NotificationPreferences> {
  const row = await maybeOne<SettingsRow>(
    db,
    'select disabled_kinds, quiet_from, quiet_until from notification_settings where user_id = $1',
    [userId],
  );
  return row ? mapSettings(row) : DEFAULT_PREFERENCES;
}

export async function save(
  db: Queryable,
  userId: number,
  preferences: { disabledKinds: readonly string[]; quietHours: QuietHours | null },
  now: Date,
): Promise<NotificationPreferences> {
  const row = await one<SettingsRow>(
    db,
    `insert into notification_settings (user_id, disabled_kinds, quiet_from, quiet_until, updated_at)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id) do update
       set disabled_kinds = excluded.disabled_kinds, quiet_from = excluded.quiet_from,
           quiet_until = excluded.quiet_until, updated_at = excluded.updated_at
     returning disabled_kinds, quiet_from, quiet_until`,
    [
      userId,
      [...preferences.disabledKinds],
      preferences.quietHours?.from ?? null,
      preferences.quietHours?.until ?? null,
      now,
    ],
  );
  return mapSettings(row);
}

export interface Recipient {
  timezone: string;
  preferences: NotificationPreferences;
}

export async function findRecipient(db: Queryable, userId: number): Promise<Recipient | null> {
  const row = await maybeOne<SettingsRow & { timezone: string; has_settings: boolean }>(
    db,
    `select u.timezone, s.user_id is not null as has_settings,
            coalesce(s.disabled_kinds, '{}') as disabled_kinds, s.quiet_from, s.quiet_until
       from users u left join notification_settings s on s.user_id = u.id
      where u.id = $1`,
    [userId],
  );
  if (!row) return null;
  return { timezone: row.timezone, preferences: row.has_settings ? mapSettings(row) : DEFAULT_PREFERENCES };
}
