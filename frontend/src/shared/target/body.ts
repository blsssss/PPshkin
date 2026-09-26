import type { Schemas } from '../../api/client.ts';
import type { Activity, Goal, Sex } from '../vocabulary.ts';

type BodyParameters = Schemas['BodyParametersInput'];

export interface BodyForm {
  sex: Sex | null;
  ageYears: string;
  heightCm: string;
  weightKg: string;
  activity: Activity | null;
}

export type BodyField = keyof BodyForm | 'goal';

export const EMPTY_BODY_FORM: BodyForm = {
  sex: null,
  ageYears: '',
  heightCm: '',
  weightKg: '',
  activity: null,
};

export const BODY_LIMITS = {
  ageYears: { min: 14, max: 100, hint: 'От 14 до 100 лет' },
  heightCm: { min: 120, max: 230, hint: 'От 120 до 230 см' },
  weightKg: { min: 35, max: 250, hint: 'От 35 до 250 кг' },
} as const;

export const KCAL_TARGET_MIN = 1000;
export const KCAL_TARGET_MAX = 5000;
export const KCAL_PRESETS = [1600, 1800, 2000, 2200, 2500] as const;

function parseNumber(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

function integerField(text: string, limits: { min: number; max: number; hint: string }): number | string {
  const value = parseNumber(text);
  if (value === null || !Number.isInteger(value)) return `Введите целое число. ${limits.hint}`;
  if (value < limits.min || value > limits.max) return limits.hint;
  return value;
}

function weightField(text: string): number | string {
  const value = parseNumber(text);
  const limits = BODY_LIMITS.weightKg;
  if (value === null) return `Введите число. ${limits.hint}`;
  if (!/^\d+([.,]\d)?$/.test(text.trim())) return 'Не больше одного знака после запятой';
  if (value < limits.min || value > limits.max) return limits.hint;
  return value;
}

export function validateBody(
  form: BodyForm,
  goal: Goal | null,
): { values: BodyParameters | null; errors: Partial<Record<BodyField, string>> } {
  const errors: Partial<Record<BodyField, string>> = {};
  if (form.sex === null) errors.sex = 'Выберите пол';
  if (form.activity === null) errors.activity = 'Выберите уровень активности';
  if (goal === null) errors.goal = 'Сначала выберите цель';
  const age = integerField(form.ageYears, BODY_LIMITS.ageYears);
  const height = integerField(form.heightCm, BODY_LIMITS.heightCm);
  const weight = weightField(form.weightKg);
  if (typeof age === 'string') errors.ageYears = age;
  if (typeof height === 'string') errors.heightCm = height;
  if (typeof weight === 'string') errors.weightKg = weight;
  if (
    form.sex === null ||
    form.activity === null ||
    goal === null ||
    typeof age === 'string' ||
    typeof height === 'string' ||
    typeof weight === 'string'
  ) {
    return { values: null, errors };
  }
  return {
    values: {
      sex: form.sex,
      ageYears: age,
      heightCm: height,
      weightKg: weight,
      activity: form.activity,
      goal,
    },
    errors,
  };
}

export function validateKcalTarget(text: string): number | string {
  const value = parseNumber(text);
  if (value === null || !Number.isInteger(value)) return 'Введите целое число ккал';
  if (value < KCAL_TARGET_MIN || value > KCAL_TARGET_MAX)
    return `От ${KCAL_TARGET_MIN} до ${KCAL_TARGET_MAX} ккал`;
  return value;
}
