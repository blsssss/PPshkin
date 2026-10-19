import { withTransaction, type Pool, type Queryable } from '../db/pool.ts';
import {
  isKindEnabled,
  NOTIFICATION_KIND_DESCRIPTIONS,
  settingsKinds,
  type NotificationAudienceKind,
  type SettingsKind,
  type NotificationPreferences,
  type QuietHours,
} from '../domain/notifications.ts';
import type { User } from '../domain/models.ts';
import * as settings from '../repositories/notification-settings.ts';
import * as users from '../repositories/users.ts';
import type { Clock } from '../shared/clock.ts';
import { notFound, unprocessable } from '../shared/errors.ts';
import { listWorkplaces } from './access.ts';

export interface NotificationKindSetting {
  kind: SettingsKind;
  audience: NotificationAudienceKind;
  enabled: boolean;
  editable: boolean;
}

export interface NotificationSettings {
  timezone: string;
  quietHours: QuietHours | null;
  kinds: NotificationKindSetting[];
}

export interface NotificationSettingsPatch {
  quietHours?: QuietHours | null;
  kinds?: { kind: SettingsKind; enabled: boolean }[];
}

export interface NotificationSettingsService {
  get(userId: number): Promise<NotificationSettings>;
  update(userId: number, patch: NotificationSettingsPatch): Promise<NotificationSettings>;
}

export interface NotificationSettingsDependencies {
  pool: Pool;
  clock: Clock;
}

const userNotFound = () => notFound('user_not_found', 'User not found');

function present(user: User, preferences: NotificationPreferences, hasVenue: boolean): NotificationSettings {
  return {
    timezone: user.timezone,
    quietHours: preferences.quietHours,
    kinds: settingsKinds(hasVenue).map((kind) => {
      const { audience, editable } = NOTIFICATION_KIND_DESCRIPTIONS[kind];
      return { kind, audience, editable, enabled: isKindEnabled(kind, preferences) };
    }),
  };
}

async function hasVenue(db: Queryable, userId: number): Promise<boolean> {
  return (await listWorkplaces(db, userId)).length > 0;
}

function editableFor(kind: SettingsKind, withVenue: boolean): boolean {
  const { audience, editable } = NOTIFICATION_KIND_DESCRIPTIONS[kind];
  return editable && (audience === 'guest' || withVenue);
}

export function createNotificationSettingsService({
  pool,
  clock,
}: NotificationSettingsDependencies): NotificationSettingsService {
  return {
    async get(userId) {
      const user = await users.findById(pool, userId);
      if (!user) throw userNotFound();
      const [preferences, withVenue] = await Promise.all([
        settings.find(pool, userId),
        hasVenue(pool, userId),
      ]);
      return present(user, preferences, withVenue);
    },

    update(userId, patch) {
      return withTransaction(pool, async (client) => {
        if (!(await users.lock(client, userId))) throw userNotFound();
        const user = await users.findById(client, userId);
        if (!user) throw userNotFound();
        const withVenue = await hasVenue(client, userId);
        const refused = (patch.kinds ?? []).find(({ kind }) => !editableFor(kind, withVenue));
        if (refused) {
          throw unprocessable(
            'notification_not_editable',
            `Notifications of kind ${refused.kind} cannot be changed`,
          );
        }
        const current = await settings.find(client, userId);
        const disabled = new Set(current.disabledKinds);
        for (const { kind, enabled } of patch.kinds ?? []) {
          if (enabled) disabled.delete(kind);
          else disabled.add(kind);
        }
        const saved = await settings.save(
          client,
          userId,
          {
            disabledKinds: [...disabled],
            quietHours: patch.quietHours === undefined ? current.quietHours : patch.quietHours,
          },
          clock.now(),
        );
        return present(user, saved, withVenue);
      });
    },
  };
}
