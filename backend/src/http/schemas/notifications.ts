import { z } from 'zod';
import {
  isQuietClock,
  NOTIFICATION_KINDS,
  QUIET_STEP_MINUTES,
  SETTINGS_KINDS_LIMIT,
} from '../../domain/notifications.ts';
import type { NotificationSettings } from '../../services/notification-settings.ts';

const KindSchema = z.enum(NOTIFICATION_KINDS).describe('Тип уведомления');

const ClockSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .refine(isQuietClock, { message: `must be a multiple of ${String(QUIET_STEP_MINUTES)} minutes` })
  .describe(`Время ЧЧ:ММ с шагом ${String(QUIET_STEP_MINUTES)} минут`);

const QuietHoursSchema = z
  .object({
    from: ClockSchema.describe('Начало тихих часов, ЧЧ:ММ'),
    until: ClockSchema.describe('Конец тихих часов, ЧЧ:ММ'),
  })
  .refine((hours) => hours.from !== hours.until, { message: 'from and until must differ', path: ['until'] })
  .meta({
    id: 'QuietHours',
    description:
      'Тихие часы в часовом поясе пользователя: сообщения о бронях, акциях и разборе меню приходят без звука, итоги дня переносятся на конец тихих часов',
  });

export const NotificationSettingsSchema = z
  .object({
    timezone: z.string().describe('Часовой пояс IANA, в котором считаются тихие часы'),
    quietHours: QuietHoursSchema.nullable().describe('null: тихие часы выключены'),
    kinds: z.array(
      z.object({
        kind: KindSchema,
        audience: z.enum(['guest', 'venue']).describe('guest: сообщения гостю, venue: сообщения заведению'),
        enabled: z.boolean(),
        editable: z.boolean().describe('false: тип нельзя выключить, переключатель неактивен'),
      }),
    ),
  })
  .meta({
    id: 'NotificationSettings',
    description:
      'Настройки уведомлений: какие сообщения бот присылает и тихие часы. Типы заведения возвращаются только пользователю с заведением',
  });

export const NotificationSettingsPatchSchema = z
  .object({
    quietHours: QuietHoursSchema.nullable().optional().describe('null выключает тихие часы'),
    kinds: z
      .array(z.object({ kind: KindSchema, enabled: z.boolean() }))
      .min(1)
      .max(SETTINGS_KINDS_LIMIT)
      .refine((kinds) => new Set(kinds.map(({ kind }) => kind)).size === kinds.length, {
        message: 'kinds must not repeat',
      })
      .optional(),
  })
  .refine((patch) => patch.quietHours !== undefined || patch.kinds !== undefined, {
    message: 'send quietHours or kinds',
  })
  .meta({
    id: 'NotificationSettingsPatch',
    description: 'Изменение настроек уведомлений: передаются только меняющиеся типы и тихие часы',
  });

export function toNotificationSettings(
  settings: NotificationSettings,
): z.infer<typeof NotificationSettingsSchema> {
  return {
    timezone: settings.timezone,
    quietHours: settings.quietHours,
    kinds: settings.kinds.map(({ kind, audience, enabled, editable }) => ({
      kind,
      audience,
      enabled,
      editable,
    })),
  };
}
