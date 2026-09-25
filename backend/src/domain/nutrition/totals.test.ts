import { describe, expect, it } from 'vitest';
import type { Meal } from '../models.ts';
import { dayTotals, EMPTY_TOTALS, mealKcal, remainingKcal } from './totals.ts';

function meal(kcalMin: number, kcalMax: number, macros: Partial<Meal> = {}): Meal {
  return {
    id: 1,
    userId: 1,
    title: 'Блюдо',
    kcalMin,
    kcalMax,
    proteinG: null,
    fatG: null,
    carbsG: null,
    tags: [],
    source: 'manual',
    confidence: null,
    eatenAt: new Date('2026-09-25T09:00:00Z'),
    createdAt: new Date('2026-09-25T09:00:00Z'),
    ...macros,
  };
}

describe('daily totals', () => {
  it('uses the middle of each estimate range', () => {
    expect(mealKcal(meal(280, 420))).toBe(350);
    expect(mealKcal(meal(301, 302))).toBe(302);
  });

  it('sums meals and treats unknown macros as zero', () => {
    const totals = dayTotals([
      meal(280, 420, { proteinG: 10.2, fatG: 14, carbsG: 28.1 }),
      meal(400, 550, { proteinG: 20.1 }),
    ]);
    expect(totals).toEqual({
      meals: 2,
      kcalMin: 680,
      kcalMax: 970,
      kcal: 825,
      proteinG: 30.3,
      fatG: 14,
      carbsG: 28.1,
    });
  });

  it('returns empty totals for a day without meals', () => {
    expect(dayTotals([])).toEqual(EMPTY_TOTALS);
  });

  it('never reports a negative remaining budget', () => {
    expect(remainingKcal(2000, { ...EMPTY_TOTALS, kcal: 1350 })).toBe(650);
    expect(remainingKcal(1800, { ...EMPTY_TOTALS, kcal: 2100 })).toBe(0);
  });
});
