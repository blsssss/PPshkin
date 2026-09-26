import type { Goal } from '../vocabulary.ts';

export type Sex = 'female' | 'male';

export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active'] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
};

export const MIN_TARGET_KCAL = 1000;
export const MAX_TARGET_KCAL = 5000;

export interface BodyParameters {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goal: Goal;
}

export interface TargetEstimate {
  kcalTarget: number;
  bmrKcal: number;
  maintenanceKcal: number;
}

const SEX_OFFSETS: Record<Sex, number> = { female: -161, male: 5 };

const BODY_BOUNDS: readonly { field: 'ageYears' | 'heightCm' | 'weightKg'; min: number; max: number }[] = [
  { field: 'ageYears', min: 14, max: 100 },
  { field: 'heightCm', min: 120, max: 230 },
  { field: 'weightKg', min: 35, max: 250 },
];

const LOSE_SHARE = 0.85;
const LOSE_FLOOR_KCAL = 1200;
const GAIN_SHARE = 1.1;
const TARGET_STEP_KCAL = 50;

const GOAL_ADJUSTMENTS: Record<Goal, (maintenance: number, bmr: number) => number> = {
  lose: (maintenance, bmr) => Math.max(maintenance * LOSE_SHARE, LOSE_FLOOR_KCAL, bmr),
  maintain: (maintenance) => maintenance,
  gain: (maintenance) => maintenance * GAIN_SHARE,
};

function assertBodyInRange(params: BodyParameters): void {
  for (const { field, min, max } of BODY_BOUNDS) {
    const value = params[field];
    if (!(value >= min && value <= max)) {
      throw new RangeError(`${field} must be between ${min} and ${max}`);
    }
  }
}

export function basalMetabolicRate(params: BodyParameters): number {
  assertBodyInRange(params);
  return 10 * params.weightKg + 6.25 * params.heightCm - 5 * params.ageYears + SEX_OFFSETS[params.sex];
}

export function estimateTarget(params: BodyParameters): TargetEstimate {
  const bmr = basalMetabolicRate(params);
  const maintenance = bmr * ACTIVITY_FACTORS[params.activity];
  const goalKcal = GOAL_ADJUSTMENTS[params.goal](maintenance, bmr);
  const stepped = Math.round(goalKcal / TARGET_STEP_KCAL) * TARGET_STEP_KCAL;
  return {
    kcalTarget: Math.min(MAX_TARGET_KCAL, Math.max(MIN_TARGET_KCAL, stepped)),
    bmrKcal: Math.round(bmr),
    maintenanceKcal: Math.round(maintenance),
  };
}
