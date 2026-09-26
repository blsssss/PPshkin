import type { Pool } from '../db/pool.ts';
import type { GeoPoint, User } from '../domain/models.ts';
import { PROFILE_LIMITS } from '../domain/profile.ts';
import { onlyKnownTags, type Goal, type Tag } from '../domain/vocabulary.ts';
import * as users from '../repositories/users.ts';
import type { Clock } from '../shared/clock.ts';
import { badRequest, notFound, unprocessable, type ErrorDetail } from '../shared/errors.ts';
import { isValidTimeZone } from '../shared/time.ts';
import type { ConsentStatus, ConsentsService } from './consents.ts';

export interface ProfilePatch {
  kcalTarget?: number;
  goal?: Goal | null;
  dislikedTags?: Tag[];
  timezone?: string;
}

export interface Profile {
  user: User;
  consents: ConsentStatus;
}

export interface UserLocation {
  location: GeoPoint;
  updatedAt: Date;
}

export interface ProfileService {
  get(userId: number): Promise<Profile>;
  update(userId: number, patch: ProfilePatch): Promise<Profile>;
  setLocation(userId: number, point: GeoPoint): Promise<UserLocation>;
  clearLocation(userId: number): Promise<void>;
}

export interface ProfileDependencies {
  pool: Pool;
  clock: Clock;
  consents: ConsentsService;
}

const userNotFound = () => notFound('user_not_found', 'User not found');

const within = (value: number, min: number, max: number) => value >= min && value <= max;

function patchProblems(patch: ProfilePatch, dislikedTags: Tag[] | undefined): ErrorDetail[] {
  const { kcalTarget, timezone } = patch;
  const problems: ErrorDetail[] = [];
  if (Object.values(patch).every((value: unknown) => value === undefined)) {
    problems.push({ path: '', message: 'send at least one field' });
  }
  if (
    kcalTarget !== undefined &&
    !(
      Number.isInteger(kcalTarget) &&
      within(kcalTarget, PROFILE_LIMITS.kcalTargetMin, PROFILE_LIMITS.kcalTargetMax)
    )
  ) {
    problems.push({
      path: 'kcalTarget',
      message: `must be an integer from ${PROFILE_LIMITS.kcalTargetMin} to ${PROFILE_LIMITS.kcalTargetMax}`,
    });
  }
  if (dislikedTags && dislikedTags.length > PROFILE_LIMITS.dislikedTags) {
    problems.push({ path: 'dislikedTags', message: `must have at most ${PROFILE_LIMITS.dislikedTags} tags` });
  }
  if (timezone !== undefined && !within(timezone.length, 1, PROFILE_LIMITS.timezoneLength)) {
    problems.push({ path: 'timezone', message: `must be 1-${PROFILE_LIMITS.timezoneLength} characters` });
  }
  return problems;
}

function pointProblems({ lat, lon }: GeoPoint): ErrorDetail[] {
  const problems: ErrorDetail[] = [];
  if (!within(lat, -90, 90)) problems.push({ path: 'lat', message: 'must be from -90 to 90' });
  if (!within(lon, -180, 180)) problems.push({ path: 'lon', message: 'must be from -180 to 180' });
  return problems;
}

export function createProfileService({ pool, clock, consents }: ProfileDependencies): ProfileService {
  async function existingUser(userId: number): Promise<User> {
    const user = await users.findById(pool, userId);
    if (!user) throw userNotFound();
    return user;
  }

  async function requireWritable(userId: number): Promise<void> {
    await existingUser(userId);
    await consents.requirePersonalData(userId);
  }

  return {
    async get(userId) {
      const [user, status] = await Promise.all([existingUser(userId), consents.status(userId)]);
      return { user, consents: status };
    },

    async update(userId, patch) {
      await requireWritable(userId);
      const dislikedTags = patch.dislikedTags && onlyKnownTags(patch.dislikedTags);
      const problems = patchProblems(patch, dislikedTags);
      if (problems.length > 0) throw badRequest('validation_failed', 'Profile validation failed', problems);
      if (patch.timezone !== undefined && !isValidTimeZone(patch.timezone)) {
        throw unprocessable('invalid_timezone', 'Time zone must be an IANA name such as Europe/Moscow');
      }
      const user = await users.updateProfile(pool, userId, { ...patch, dislikedTags });
      if (!user) throw userNotFound();
      return { user, consents: await consents.status(userId) };
    },

    async setLocation(userId, point) {
      await requireWritable(userId);
      const problems = pointProblems(point);
      if (problems.length > 0) throw badRequest('validation_failed', 'Location validation failed', problems);
      const user = await users.setLocation(pool, userId, point, clock.now());
      if (!user?.location || !user.locationUpdatedAt) throw userNotFound();
      return { location: user.location, updatedAt: user.locationUpdatedAt };
    },

    async clearLocation(userId) {
      await users.clearLocation(pool, userId);
    },
  };
}
