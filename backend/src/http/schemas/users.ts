import { z } from 'zod';
import type { User } from '../../domain/models.ts';
import { PROFILE_LIMITS } from '../../domain/profile.ts';
import { GOALS, TAGS } from '../../domain/vocabulary.ts';
import type { ConsentStatus } from '../../services/consents.ts';
import type { UserLocation } from '../../services/profile.ts';
import { GeoPointSchema, IsoDateTime, iso, isoOrNull } from './common.ts';
import { ConsentStatusSchema, toConsentStatus } from './consents.ts';

const KcalTargetSchema = z
  .number()
  .int()
  .min(PROFILE_LIMITS.kcalTargetMin)
  .max(PROFILE_LIMITS.kcalTargetMax)
  .describe('Ориентир калорийности на день, ккал');

const GoalSchema = z
  .enum(GOALS)
  .nullable()
  .describe('Цель: lose - снизить вес, maintain - удерживать, gain - набрать, null - не выбрана');

const DislikedTagsSchema = z
  .array(z.enum(TAGS))
  .max(PROFILE_LIMITS.dislikedTags)
  .describe('Теги блюд, которые гостю не предлагаются');

export const UserProfileSchema = z
  .object({
    id: z.number().int().describe('Идентификатор пользователя в MAX'),
    firstName: z.string().nullable(),
    username: z.string().nullable(),
    timezone: z.string().describe('Часовой пояс IANA, по нему считаются дни дневника'),
    kcalTarget: z.number().int().describe('Ориентир калорийности на день, ккал'),
    goal: GoalSchema,
    dislikedTags: z.array(z.enum(TAGS)).describe('Теги блюд, которые гостю не предлагаются'),
    location: GeoPointSchema.nullable().describe(
      'Последнее переданное местоположение с точностью около 1 км',
    ),
    locationUpdatedAt: IsoDateTime.nullable().describe('Когда передано местоположение'),
    consents: ConsentStatusSchema,
  })
  .meta({ id: 'UserProfile', description: 'Профиль пользователя и состояние его согласий' });

export const ProfilePatchSchema = z
  .object({
    kcalTarget: KcalTargetSchema.optional(),
    goal: GoalSchema.optional(),
    dislikedTags: DislikedTagsSchema.optional(),
    timezone: z
      .string()
      .min(1)
      .max(PROFILE_LIMITS.timezoneLength)
      .optional()
      .describe('Часовой пояс IANA, например Europe/Moscow'),
  })
  .refine((patch) => Object.values(patch).some((value: unknown) => value !== undefined), {
    message: 'send at least one field',
  })
  .meta({
    id: 'ProfilePatch',
    description: 'Изменение профиля: передаются только меняющиеся поля, хотя бы одно',
  });

export const UserLocationSchema = z
  .object({
    location: GeoPointSchema,
    updatedAt: IsoDateTime,
  })
  .meta({
    id: 'UserLocation',
    description: 'Сохранённое местоположение: координаты округлены до 2 знаков, это около 1 км',
  });

export type UserProfile = z.infer<typeof UserProfileSchema>;

export function toUserProfile(user: User, consents: ConsentStatus): UserProfile {
  return {
    id: user.id,
    firstName: user.firstName,
    username: user.username,
    timezone: user.timezone,
    kcalTarget: user.kcalTarget,
    goal: user.goal,
    dislikedTags: user.dislikedTags,
    location: user.location,
    locationUpdatedAt: isoOrNull(user.locationUpdatedAt),
    consents: toConsentStatus(consents),
  };
}

export function toUserLocation(saved: UserLocation): z.infer<typeof UserLocationSchema> {
  return { location: saved.location, updatedAt: iso(saved.updatedAt) };
}
