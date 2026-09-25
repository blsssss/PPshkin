import { z } from 'zod';
import type { User } from '../../domain/models.ts';
import { GOALS, TAGS } from '../../domain/vocabulary.ts';
import { GeoPointSchema } from './common.ts';

export const UserProfileSchema = z
  .object({
    id: z.number().int().describe('MAX user id'),
    firstName: z.string().nullable(),
    username: z.string().nullable(),
    timezone: z.string(),
    kcalTarget: z.number().int().describe('Daily calorie guideline'),
    goal: z.enum(GOALS).nullable(),
    dislikedTags: z.array(z.enum(TAGS)),
    location: GeoPointSchema.nullable().describe('Last shared location, rounded to about 1 km'),
  })
  .meta({ id: 'UserProfile' });

export type UserProfile = z.infer<typeof UserProfileSchema>;

export function toUserProfile(user: User): UserProfile {
  return {
    id: user.id,
    firstName: user.firstName,
    username: user.username,
    timezone: user.timezone,
    kcalTarget: user.kcalTarget,
    goal: user.goal,
    dislikedTags: user.dislikedTags,
    location: user.location,
  };
}
