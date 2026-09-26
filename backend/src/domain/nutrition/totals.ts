import type { Meal } from '../models.ts';

export interface DayTotals {
  meals: number;
  kcalMin: number;
  kcalMax: number;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export const EMPTY_TOTALS: Readonly<DayTotals> = Object.freeze({
  meals: 0,
  kcalMin: 0,
  kcalMax: 0,
  kcal: 0,
  proteinG: 0,
  fatG: 0,
  carbsG: 0,
});

const round1 = (value: number) => Math.round(value * 10) / 10;

export function mealKcal(meal: Pick<Meal, 'kcalMin' | 'kcalMax'>): number {
  return Math.round((meal.kcalMin + meal.kcalMax) / 2);
}

export function dayTotals(meals: readonly Meal[]): DayTotals {
  return meals.reduce<DayTotals>(
    (sum, meal) => ({
      meals: sum.meals + 1,
      kcalMin: sum.kcalMin + meal.kcalMin,
      kcalMax: sum.kcalMax + meal.kcalMax,
      kcal: sum.kcal + mealKcal(meal),
      proteinG: round1(sum.proteinG + (meal.proteinG ?? 0)),
      fatG: round1(sum.fatG + (meal.fatG ?? 0)),
      carbsG: round1(sum.carbsG + (meal.carbsG ?? 0)),
    }),
    { ...EMPTY_TOTALS },
  );
}

export function remainingKcal(target: number, totals: DayTotals): number {
  return Math.max(0, target - totals.kcal);
}
