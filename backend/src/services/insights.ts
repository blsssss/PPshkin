import type { Pool } from '../db/pool.ts';
import type { User } from '../domain/models.ts';
import {
  buildBehaviorProfile,
  PROFILE_WINDOW_DAYS,
  type BehaviorProfile,
} from '../domain/nutrition/profile.ts';
import { mealSlotAt } from '../domain/nutrition/slots.ts';
import {
  estimateTarget as estimateBodyTarget,
  type BodyParameters,
  type TargetEstimate,
} from '../domain/nutrition/targets.ts';
import { dayTotals, remainingKcal, type DayTotals } from '../domain/nutrition/totals.ts';
import type { MealSlot } from '../domain/vocabulary.ts';
import * as meals from '../repositories/meals.ts';
import * as users from '../repositories/users.ts';
import type { Clock } from '../shared/clock.ts';
import { badRequest, notFound } from '../shared/errors.ts';
import { dayRange, localDate } from '../shared/time.ts';
import type { ConsentsService } from './consents.ts';

export interface EatingState {
  user: User;
  profile: BehaviorProfile;
  date: string;
  dayStart: Date;
  today: DayTotals;
}

export interface TodaySummary {
  date: string;
  slot: MealSlot;
  targetKcal: number;
  totals: DayTotals;
  remainingKcal: number;
}

export interface Insights {
  profile: BehaviorProfile;
  today: TodaySummary;
}

export interface InsightsService {
  get(userId: number): Promise<Insights>;
  estimateTarget(params: BodyParameters): TargetEstimate;
}

interface InsightsDependencies {
  pool: Pool;
  clock: Clock;
  consents: Pick<ConsentsService, 'requirePersonalData'>;
}

const DAY_MS = 86_400_000;

export async function loadEatingState(pool: Pool, userId: number, now: Date): Promise<EatingState> {
  const [user, recent] = await Promise.all([
    users.findById(pool, userId),
    meals.listSince(pool, userId, new Date(now.getTime() - PROFILE_WINDOW_DAYS * DAY_MS)),
  ]);
  if (!user) throw notFound('user_not_found', 'User not found');
  const date = localDate(now, user.timezone);
  const { from, to } = dayRange(date, user.timezone);
  return {
    user,
    profile: buildBehaviorProfile(recent, { now, timeZone: user.timezone }),
    date,
    dayStart: from,
    today: dayTotals(recent.filter(({ eatenAt }) => eatenAt >= from && eatenAt < to)),
  };
}

export function createInsightsService({ pool, clock, consents }: InsightsDependencies): InsightsService {
  return {
    async get(userId) {
      await consents.requirePersonalData(userId);
      const now = clock.now();
      const { user, profile, date, today } = await loadEatingState(pool, userId, now);
      return {
        profile,
        today: {
          date,
          slot: mealSlotAt(now, user.timezone),
          targetKcal: user.kcalTarget,
          totals: today,
          remainingKcal: remainingKcal(user.kcalTarget, today),
        },
      };
    },

    estimateTarget(params) {
      try {
        return estimateBodyTarget(params);
      } catch (error) {
        if (error instanceof RangeError) {
          throw badRequest('validation_failed', 'Request validation failed', [
            { path: '', message: error.message },
          ]);
        }
        throw error;
      }
    },
  };
}
