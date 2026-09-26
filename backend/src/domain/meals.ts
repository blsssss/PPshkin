import type { ErrorDetail } from '../shared/errors.ts';

export const MEAL_LIMITS = {
  titleLength: 200,
  kcal: 5000,
  grams: 500,
  tags: 10,
} as const;

export interface KcalFields {
  kcal?: number | undefined;
  kcalMin?: number | undefined;
  kcalMax?: number | undefined;
}

export interface KcalRange {
  kcalMin: number;
  kcalMax: number;
}

export function kcalProblems({ kcal, kcalMin, kcalMax }: KcalFields, required: boolean): ErrorDetail[] {
  if (kcal !== undefined) {
    return kcalMin === undefined && kcalMax === undefined
      ? []
      : [{ path: 'kcal', message: 'send either kcal or the pair kcalMin and kcalMax' }];
  }
  if (kcalMin === undefined && kcalMax === undefined) {
    return required ? [{ path: 'kcal', message: 'send kcal or the pair kcalMin and kcalMax' }] : [];
  }
  if (kcalMin === undefined) return [{ path: 'kcalMin', message: 'kcalMin is required with kcalMax' }];
  if (kcalMax === undefined) return [{ path: 'kcalMax', message: 'kcalMax is required with kcalMin' }];
  return kcalMax < kcalMin ? [{ path: 'kcalMax', message: 'kcalMax must not be less than kcalMin' }] : [];
}

export function kcalRange({ kcal, kcalMin, kcalMax }: KcalFields): KcalRange | null {
  if (kcal !== undefined) return { kcalMin: kcal, kcalMax: kcal };
  if (kcalMin !== undefined && kcalMax !== undefined) return { kcalMin, kcalMax };
  return null;
}
