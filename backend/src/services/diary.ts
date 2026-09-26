import { withTransaction, type Pool } from '../db/pool.ts';
import { kcalProblems, kcalRange, MEAL_LIMITS, type KcalFields } from '../domain/meals.ts';
import type { Meal, User } from '../domain/models.ts';
import { mealSlotAt } from '../domain/nutrition/slots.ts';
import { dayTotals, remainingKcal, type DayTotals } from '../domain/nutrition/totals.ts';
import { onlyKnownTags, type MealSlot, type Tag } from '../domain/vocabulary.ts';
import type {
  DishEstimate,
  DishRecognition,
  DishRecognizer,
  UnavailableReason,
} from '../ports/recognition.ts';
import * as meals from '../repositories/meals.ts';
import * as users from '../repositories/users.ts';
import type { Clock } from '../shared/clock.ts';
import { badRequest, notFound, unprocessable, type ErrorDetail } from '../shared/errors.ts';
import { addDays, dayRange, isLocalDate, localDate } from '../shared/time.ts';
import type { ConsentsService } from './consents.ts';

export const MIN_CONFIDENCE = 0.35;
export const SUMMARY_MAX_DAYS = 31;
export const DESCRIPTION_MAX_LENGTH = 500;

const MINUTE_MS = 60_000;
const EATEN_AT_PAST_MS = 7 * 24 * 60 * MINUTE_MS;
const EATEN_AT_FUTURE_MS = 5 * MINUTE_MS;
const STORED_KCAL_MAX = 10_000;
const UNTITLED_DISH = 'Блюдо';

export type DiaryMeal = Meal & { slot: MealSlot };

export interface DiaryDay {
  date: string;
  timezone: string;
  targetKcal: number;
  totals: DayTotals;
  remainingKcal: number;
  meals: DiaryMeal[];
}

export interface DiarySummaryDay extends DayTotals {
  date: string;
}

export interface ManualMealInput extends KcalFields {
  title: string;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  tags?: Tag[];
  eatenAt?: Date;
}

export interface MealPatch extends KcalFields {
  title?: string;
  proteinG?: number | null;
  fatG?: number | null;
  carbsG?: number | null;
  tags?: Tag[];
  eatenAt?: Date;
}

export type MealLogResult =
  | { status: 'logged'; meals: DiaryMeal[]; basis: string; day: DiaryDay }
  | { status: 'uncertain'; candidates: DishEstimate[]; basis: string }
  | { status: 'not_food'; basis: string }
  | { status: 'unavailable'; reason: UnavailableReason };

export interface DiaryService {
  day(userId: number, date?: string): Promise<DiaryDay>;
  summary(userId: number, days: number): Promise<DiarySummaryDay[]>;
  addManual(userId: number, input: ManualMealInput): Promise<DiaryMeal>;
  logFromPhoto(userId: number, image: Buffer): Promise<MealLogResult>;
  logFromText(userId: number, description: string): Promise<MealLogResult>;
  update(userId: number, mealId: number, patch: MealPatch): Promise<DiaryMeal>;
  remove(userId: number, mealId: number): Promise<void>;
}

export interface DiaryDependencies {
  pool: Pool;
  dishes: DishRecognizer;
  clock: Clock;
  consents: ConsentsService;
}

const within = (value: number, min: number, max: number) => value >= min && value <= max;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const nonNegative = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

const positiveOrNull = (value: number | null) =>
  value !== null && Number.isFinite(value) && value > 0 ? value : null;

const invalid = (problems: ErrorDetail[]) =>
  badRequest('validation_failed', 'Request validation failed', problems);

function mealProblems(fields: MealPatch, required: boolean): ErrorDetail[] {
  const problems: ErrorDetail[] = [];
  if (required || fields.title !== undefined) {
    const length = fields.title?.trim().length ?? 0;
    if (!within(length, 1, MEAL_LIMITS.titleLength)) {
      problems.push({ path: 'title', message: `must be 1-${MEAL_LIMITS.titleLength} characters` });
    }
  }
  for (const field of ['kcal', 'kcalMin', 'kcalMax'] as const) {
    const value = fields[field];
    if (value !== undefined && !(Number.isInteger(value) && within(value, 0, MEAL_LIMITS.kcal))) {
      problems.push({ path: field, message: `must be an integer from 0 to ${MEAL_LIMITS.kcal}` });
    }
  }
  for (const field of ['proteinG', 'fatG', 'carbsG'] as const) {
    const value = fields[field];
    if (value !== undefined && value !== null && !within(value, 0, MEAL_LIMITS.grams)) {
      problems.push({ path: field, message: `must be from 0 to ${MEAL_LIMITS.grams}` });
    }
  }
  if (fields.tags && onlyKnownTags(fields.tags).length > MEAL_LIMITS.tags) {
    problems.push({ path: 'tags', message: `must have at most ${MEAL_LIMITS.tags} tags` });
  }
  if (fields.eatenAt && Number.isNaN(fields.eatenAt.getTime())) {
    problems.push({ path: 'eatenAt', message: 'must be a valid date and time' });
  }
  return [...problems, ...kcalProblems(fields, required)];
}

function requireRecent(eatenAt: Date, now: Date): void {
  const offset = eatenAt.getTime() - now.getTime();
  if (offset < -EATEN_AT_PAST_MS || offset > EATEN_AT_FUTURE_MS) {
    throw unprocessable(
      'eaten_at_out_of_range',
      'eatenAt must be within the last 7 days and at most 5 minutes ahead',
    );
  }
}

function storable(estimate: DishEstimate): DishEstimate {
  const kcalMin = clamp(Math.round(estimate.kcalMin), 0, STORED_KCAL_MAX);
  return {
    title: estimate.title.trim().slice(0, MEAL_LIMITS.titleLength).trim() || UNTITLED_DISH,
    portionG: positiveOrNull(estimate.portionG),
    kcalMin,
    kcalMax: clamp(Math.round(estimate.kcalMax), kcalMin, STORED_KCAL_MAX),
    proteinG: nonNegative(estimate.proteinG),
    fatG: nonNegative(estimate.fatG),
    carbsG: nonNegative(estimate.carbsG),
    tags: onlyKnownTags(estimate.tags),
    confidence: clamp(estimate.confidence, 0, 1),
  };
}

export function createDiaryService({ pool, dishes, clock, consents }: DiaryDependencies): DiaryService {
  const withSlot = (meal: Meal, timeZone: string): DiaryMeal => ({
    ...meal,
    slot: mealSlotAt(meal.eatenAt, timeZone),
  });

  async function existingUser(userId: number): Promise<User> {
    const user = await users.findById(pool, userId);
    if (!user) throw notFound('user_not_found', 'User not found');
    return user;
  }

  async function writableUser(userId: number): Promise<User> {
    const user = await existingUser(userId);
    await consents.requirePersonalData(userId);
    return user;
  }

  async function dayOf(user: User, date: string): Promise<DiaryDay> {
    const { from, to } = dayRange(date, user.timezone);
    const eaten = await meals.listBetween(pool, user.id, from, to);
    const totals = dayTotals(eaten);
    return {
      date,
      timezone: user.timezone,
      targetKcal: user.kcalTarget,
      totals,
      remainingKcal: remainingKcal(user.kcalTarget, totals),
      meals: eaten.map((meal) => withSlot(meal, user.timezone)),
    };
  }

  async function logRecognized(
    user: User,
    source: 'photo' | 'text',
    recognition: DishRecognition,
  ): Promise<MealLogResult> {
    if (recognition.status === 'unavailable') return { status: 'unavailable', reason: recognition.reason };
    if (recognition.status === 'not_food') return { status: 'not_food', basis: recognition.basis };
    const estimates = recognition.items.map(storable);
    const confident = estimates.filter((estimate) => estimate.confidence >= MIN_CONFIDENCE);
    if (confident.length === 0) {
      return { status: 'uncertain', candidates: estimates, basis: recognition.basis };
    }
    const eatenAt = clock.now();
    const saved = await withTransaction(pool, async (client) => {
      const inserted: Meal[] = [];
      for (const estimate of confident) {
        inserted.push(
          await meals.insert(client, {
            userId: user.id,
            title: estimate.title,
            kcalMin: estimate.kcalMin,
            kcalMax: estimate.kcalMax,
            proteinG: estimate.proteinG,
            fatG: estimate.fatG,
            carbsG: estimate.carbsG,
            tags: estimate.tags,
            source,
            confidence: estimate.confidence,
            eatenAt,
          }),
        );
      }
      return inserted;
    });
    return {
      status: 'logged',
      meals: saved.map((meal) => withSlot(meal, user.timezone)),
      basis: recognition.basis,
      day: await dayOf(user, localDate(eatenAt, user.timezone)),
    };
  }

  return {
    async day(userId, date) {
      if (date !== undefined && !isLocalDate(date)) {
        throw invalid([{ path: 'date', message: 'must be a calendar date in YYYY-MM-DD format' }]);
      }
      const user = await existingUser(userId);
      return dayOf(user, date ?? localDate(clock.now(), user.timezone));
    },

    async summary(userId, days) {
      if (!(Number.isInteger(days) && within(days, 1, SUMMARY_MAX_DAYS))) {
        throw invalid([{ path: 'days', message: `must be an integer from 1 to ${SUMMARY_MAX_DAYS}` }]);
      }
      const user = await existingUser(userId);
      const first = addDays(localDate(clock.now(), user.timezone), 1 - days);
      const eaten = await meals.listSince(pool, userId, dayRange(first, user.timezone).from);
      const byDate = Map.groupBy(eaten, (meal) => localDate(meal.eatenAt, user.timezone));
      return Array.from({ length: days }, (_, index) => {
        const date = addDays(first, index);
        return { date, ...dayTotals(byDate.get(date) ?? []) };
      });
    },

    async addManual(userId, input) {
      const user = await writableUser(userId);
      const problems = mealProblems(input, true);
      const range = kcalRange(input);
      if (problems.length > 0 || !range) throw invalid(problems);
      const now = clock.now();
      const eatenAt = input.eatenAt ?? now;
      requireRecent(eatenAt, now);
      const meal = await meals.insert(pool, {
        userId,
        title: input.title.trim(),
        ...range,
        proteinG: input.proteinG ?? null,
        fatG: input.fatG ?? null,
        carbsG: input.carbsG ?? null,
        tags: onlyKnownTags(input.tags ?? []),
        source: 'manual',
        confidence: null,
        eatenAt,
      });
      return withSlot(meal, user.timezone);
    },

    async logFromPhoto(userId, image) {
      const user = await writableUser(userId);
      return logRecognized(user, 'photo', await dishes.fromPhoto(image));
    },

    async logFromText(userId, description) {
      const user = await writableUser(userId);
      const text = description.trim();
      if (!within(text.length, 1, DESCRIPTION_MAX_LENGTH)) {
        throw invalid([{ path: 'description', message: `must be 1-${DESCRIPTION_MAX_LENGTH} characters` }]);
      }
      return logRecognized(user, 'text', await dishes.fromText(text));
    },

    async update(userId, mealId, patch) {
      const user = await writableUser(userId);
      const problems = mealProblems(patch, false);
      if (Object.values(patch).every((value: unknown) => value === undefined)) {
        problems.unshift({ path: '', message: 'send at least one field' });
      }
      if (problems.length > 0) throw invalid(problems);
      if (patch.eatenAt) requireRecent(patch.eatenAt, clock.now());
      const meal = await meals.update(pool, userId, mealId, {
        title: patch.title?.trim(),
        ...kcalRange(patch),
        proteinG: patch.proteinG,
        fatG: patch.fatG,
        carbsG: patch.carbsG,
        tags: patch.tags && onlyKnownTags(patch.tags),
        eatenAt: patch.eatenAt,
      });
      if (!meal) throw notFound('meal_not_found', 'Meal not found');
      return withSlot(meal, user.timezone);
    },

    async remove(userId, mealId) {
      if (!(await meals.remove(pool, userId, mealId))) {
        throw notFound('meal_not_found', 'Meal not found');
      }
    },
  };
}
