import { describe, expect, it } from 'vitest';
import type { BodyParameters, TargetEstimate } from './targets.ts';
import {
  ACTIVITY_FACTORS,
  ACTIVITY_LEVELS,
  basalMetabolicRate,
  estimateTarget,
  MAX_TARGET_KCAL,
  MIN_TARGET_KCAL,
} from './targets.ts';

type BoundedField = 'ageYears' | 'heightCm' | 'weightKg';

const person = (overrides: Partial<BodyParameters> = {}): BodyParameters => ({
  sex: 'female',
  ageYears: 30,
  heightCm: 165,
  weightKg: 60,
  activity: 'light',
  goal: 'maintain',
  ...overrides,
});

describe('basalMetabolicRate', () => {
  it('applies the Mifflin-St Jeor formula without rounding', () => {
    expect(basalMetabolicRate(person())).toBe(1320.25);
    expect(basalMetabolicRate(person({ sex: 'male', ageYears: 25, heightCm: 175, weightKg: 70 }))).toBe(
      1673.75,
    );
  });
});

describe('estimateTarget', () => {
  it.each<[string, BodyParameters, TargetEstimate]>([
    [
      'female 30 y, 165 cm, 60 kg, light, maintain',
      person(),
      { kcalTarget: 1800, bmrKcal: 1320, maintenanceKcal: 1815 },
    ],
    [
      'male 40 y, 180 cm, 85 kg, moderate, lose',
      person({ sex: 'male', ageYears: 40, heightCm: 180, weightKg: 85, activity: 'moderate', goal: 'lose' }),
      { kcalTarget: 2350, bmrKcal: 1780, maintenanceKcal: 2759 },
    ],
    [
      'female 70 y, 150 cm, 45 kg, sedentary, lose (1200 kcal floor)',
      person({ ageYears: 70, heightCm: 150, weightKg: 45, activity: 'sedentary', goal: 'lose' }),
      { kcalTarget: 1200, bmrKcal: 877, maintenanceKcal: 1052 },
    ],
    [
      'male 25 y, 175 cm, 70 kg, active, gain',
      person({ sex: 'male', ageYears: 25, heightCm: 175, weightKg: 70, activity: 'active', goal: 'gain' }),
      { kcalTarget: 3200, bmrKcal: 1674, maintenanceKcal: 2887 },
    ],
    [
      'male 20 y, 230 cm, 250 kg, active, gain (upper bound)',
      person({ sex: 'male', ageYears: 20, heightCm: 230, weightKg: 250, activity: 'active', goal: 'gain' }),
      { kcalTarget: MAX_TARGET_KCAL, bmrKcal: 3843, maintenanceKcal: 6628 },
    ],
  ])('estimates %s', (_label, params, expected) => {
    expect(estimateTarget(params)).toEqual(expected);
  });

  it('never goes below the lower bound of the calorie target', () => {
    expect(
      estimateTarget(person({ ageYears: 100, heightCm: 120, weightKg: 35, activity: 'sedentary' })),
    ).toEqual({ kcalTarget: MIN_TARGET_KCAL, bmrKcal: 439, maintenanceKcal: 527 });
  });

  it('orders goals from losing to gaining weight', () => {
    const [lose, maintain, gain] = (['lose', 'maintain', 'gain'] as const).map(
      (goal) => estimateTarget(person({ sex: 'male', weightKg: 80, activity: 'moderate', goal })).kcalTarget,
    );
    expect([lose, maintain, gain]).toEqual([2200, 2600, 2900]);
  });

  it('defines an increasing factor for every activity level', () => {
    const factors = ACTIVITY_LEVELS.map((level) => ACTIVITY_FACTORS[level]);
    expect(factors).toEqual([1.2, 1.375, 1.55, 1.725]);
  });

  it.each<[BoundedField, number]>([
    ['ageYears', 13],
    ['ageYears', 101],
    ['heightCm', 119],
    ['heightCm', 231],
    ['weightKg', 34],
    ['weightKg', 251],
    ['weightKg', Number.NaN],
  ])('rejects %s = %d', (field, value) => {
    const params = person({ [field]: value });
    expect(() => estimateTarget(params)).toThrow(RangeError);
    expect(() => basalMetabolicRate(params)).toThrow(new RegExp(`^${field} must be between`));
  });

  it.each<[BoundedField, number]>([
    ['ageYears', 14],
    ['ageYears', 100],
    ['heightCm', 120],
    ['heightCm', 230],
    ['weightKg', 35],
    ['weightKg', 250],
  ])('accepts the boundary %s = %d', (field, value) => {
    expect(() => estimateTarget(person({ [field]: value }))).not.toThrow();
  });
});
