import { localParts } from '../../shared/time.ts';
import { SWEET_TAGS } from '../intent/dish.ts';
import type { Meal } from '../models.ts';
import { MEAL_SLOTS, TAGS } from '../vocabulary.ts';
import type { MealSlot, Tag } from '../vocabulary.ts';
import { slotForHour } from './slots.ts';
import { mealKcal } from './totals.ts';

export const PROFILE_WINDOW_DAYS = 14;
export const READY_MIN_MEALS = 5;
export const READY_MIN_DAYS = 2;

export type ProfileReadiness = 'empty' | 'collecting' | 'ready';

export interface SlotHabit {
  share: number;
  averageKcal: number | null;
  typicalHour: number | null;
}

export interface BehaviorProfile {
  mealsCount: number;
  daysTracked: number;
  readiness: ProfileReadiness;
  mealsUntilReady: number;
  averageDailyKcal: number | null;
  tagAffinity: Partial<Record<Tag, number>>;
  topTags: Tag[];
  slots: Record<MealSlot, SlotHabit>;
  sweetTooth: { share: number; typicalHour: number | null };
  proteinShare: number | null;
}

interface LoggedMeal {
  date: string;
  hour: number;
  slot: MealSlot;
  kcal: number;
  proteinKcal: number | null;
  tags: ReadonlySet<Tag>;
  weight: number;
}

const DAY_MS = 86_400_000;
const AFFINITY_HALF_LIFE_DAYS = 7;
const TOP_TAGS_LIMIT = 5;
const TOP_TAG_MIN_AFFINITY = 0.2;
const DAILY_AVERAGE_MIN_MEALS = 2;
const PROTEIN_KCAL_PER_G = 4;

const round2 = (value: number) => Math.round(value * 100) / 100;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

function roundedAverage(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.round(sum(values) / values.length);
}

function median(values: readonly number[]): number | null {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}

function shareOfDays(meals: readonly LoggedMeal[], daysTracked: number): number {
  return daysTracked === 0 ? 0 : round2(new Set(meals.map((meal) => meal.date)).size / daysTracked);
}

function mealsInWindow(
  meals: readonly Meal[],
  now: Date,
  timeZone: string,
  windowDays: number,
): LoggedMeal[] {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - windowDays * DAY_MS;
  return meals
    .filter((meal) => meal.eatenAt.getTime() > windowStartMs && meal.eatenAt.getTime() <= nowMs)
    .map((meal) => {
      const { date, hour } = localParts(meal.eatenAt, timeZone);
      const ageDays = (nowMs - meal.eatenAt.getTime()) / DAY_MS;
      return {
        date,
        hour,
        slot: slotForHour(hour),
        kcal: mealKcal(meal),
        proteinKcal: meal.proteinG === null ? null : meal.proteinG * PROTEIN_KCAL_PER_G,
        tags: new Set(meal.tags),
        weight: 0.5 ** (ageDays / AFFINITY_HALF_LIFE_DAYS),
      };
    });
}

function readinessOf(mealsCount: number, daysTracked: number): ProfileReadiness {
  if (mealsCount === 0) return 'empty';
  return mealsCount >= READY_MIN_MEALS && daysTracked >= READY_MIN_DAYS ? 'ready' : 'collecting';
}

function averageDailyKcal(days: ReadonlyMap<string, readonly LoggedMeal[]>): number | null {
  const fullDayTotals = [...days.values()]
    .filter((dayMeals) => dayMeals.length >= DAILY_AVERAGE_MIN_MEALS)
    .map((dayMeals) => sum(dayMeals.map((meal) => meal.kcal)));
  return roundedAverage(fullDayTotals);
}

function tagAffinities(meals: readonly LoggedMeal[]): { tag: Tag; affinity: number }[] {
  const totalWeight = sum(meals.map((meal) => meal.weight));
  const weightByTag = new Map<Tag, number>();
  for (const meal of meals) {
    for (const tag of meal.tags) {
      weightByTag.set(tag, (weightByTag.get(tag) ?? 0) + meal.weight);
    }
  }
  return TAGS.flatMap((tag) => {
    const weight = weightByTag.get(tag);
    return weight === undefined ? [] : [{ tag, affinity: round2(weight / totalWeight) }];
  });
}

function slotHabit(meals: readonly LoggedMeal[], daysTracked: number): SlotHabit {
  return {
    share: shareOfDays(meals, daysTracked),
    averageKcal: roundedAverage(meals.map((meal) => meal.kcal)),
    typicalHour: median(meals.map((meal) => meal.hour)),
  };
}

function proteinShare(meals: readonly LoggedMeal[]): number | null {
  let proteinKcal = 0;
  let kcal = 0;
  for (const meal of meals) {
    if (meal.proteinKcal !== null) {
      proteinKcal += meal.proteinKcal;
      kcal += meal.kcal;
    }
  }
  return kcal > 0 ? Math.min(1, round2(proteinKcal / kcal)) : null;
}

export function buildBehaviorProfile(
  meals: readonly Meal[],
  options: { now: Date; timeZone: string; windowDays?: number },
): BehaviorProfile {
  const { now, timeZone, windowDays = PROFILE_WINDOW_DAYS } = options;
  if (!(windowDays > 0)) {
    throw new RangeError('windowDays must be positive');
  }
  const logged = mealsInWindow(meals, now, timeZone, windowDays);
  const days = Map.groupBy(logged, (meal) => meal.date);
  const slotMeals = Map.groupBy(logged, (meal) => meal.slot);
  const daysTracked = days.size;
  const affinities = tagAffinities(logged);
  const sweetMeals = logged.filter((meal) => SWEET_TAGS.some((tag) => meal.tags.has(tag)));
  return {
    mealsCount: logged.length,
    daysTracked,
    readiness: readinessOf(logged.length, daysTracked),
    mealsUntilReady: Math.max(0, READY_MIN_MEALS - logged.length),
    averageDailyKcal: averageDailyKcal(days),
    tagAffinity: Object.fromEntries(affinities.map(({ tag, affinity }) => [tag, affinity])),
    topTags: affinities
      .filter(({ affinity }) => affinity >= TOP_TAG_MIN_AFFINITY)
      .sort((left, right) => right.affinity - left.affinity)
      .slice(0, TOP_TAGS_LIMIT)
      .map(({ tag }) => tag),
    slots: Object.fromEntries(
      MEAL_SLOTS.map((slot) => [slot, slotHabit(slotMeals.get(slot) ?? [], daysTracked)]),
    ) as Record<MealSlot, SlotHabit>,
    sweetTooth: {
      share: shareOfDays(sweetMeals, daysTracked),
      typicalHour: median(sweetMeals.map((meal) => meal.hour)),
    },
    proteinShare: proteinShare(logged),
  };
}
