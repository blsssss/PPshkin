import type { Schemas } from '../../api/client.ts';
import type { Tag } from '../../shared/vocabulary.ts';
import { fromZonedInput, toZonedInput } from '../../shared/zonedTime.ts';
import type { Meal, MealCandidate } from './queries.ts';

type ManualMealInput = Schemas['ManualMealInput'];
type MealPatchInput = Schemas['MealPatchInput'];

export const MAX_PAST_DAYS = 7;
export const MAX_MEAL_TAGS = 10;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface MealFormState {
  title: string;
  range: boolean;
  kcal: string;
  kcalMin: string;
  kcalMax: string;
  proteinG: string;
  fatG: string;
  carbsG: string;
  tags: Tag[];
  eatenAt: string;
}

export type MealField = keyof MealFormState;

function macro(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

export function defaultEatenAt(date: string | null, now: Date, timeZone: string): string {
  const current = toZonedInput(now, timeZone);
  if (date === null) return current;
  const candidate = fromZonedInput(`${date}T${current.slice(11)}`, timeZone);
  if (candidate === null) return current;
  const earliest = new Date(now.getTime() - MAX_PAST_DAYS * DAY_MS + 60_000);
  if (candidate < earliest) return toZonedInput(earliest, timeZone);
  if (candidate > now) return current;
  return toZonedInput(candidate, timeZone);
}

export function emptyForm(date: string | null, now: Date, timeZone: string): MealFormState {
  return {
    title: '',
    range: false,
    kcal: '',
    kcalMin: '',
    kcalMax: '',
    proteinG: '',
    fatG: '',
    carbsG: '',
    tags: [],
    eatenAt: defaultEatenAt(date, now, timeZone),
  };
}

export function formFromMeal(meal: Meal, timeZone: string): MealFormState {
  const range = meal.kcalMin !== meal.kcalMax;
  return {
    title: meal.title,
    range,
    kcal: range ? '' : String(meal.kcalMin),
    kcalMin: range ? String(meal.kcalMin) : '',
    kcalMax: range ? String(meal.kcalMax) : '',
    proteinG: macro(meal.proteinG),
    fatG: macro(meal.fatG),
    carbsG: macro(meal.carbsG),
    tags: [...meal.tags],
    eatenAt: toZonedInput(new Date(meal.eatenAt), timeZone),
  };
}

export function formFromCandidate(
  candidate: MealCandidate,
  date: string | null,
  now: Date,
  timeZone: string,
): MealFormState {
  const range = candidate.kcalMin !== candidate.kcalMax;
  return {
    ...emptyForm(date, now, timeZone),
    title: candidate.title,
    range,
    kcal: range ? '' : String(candidate.kcalMin),
    kcalMin: range ? String(candidate.kcalMin) : '',
    kcalMax: range ? String(candidate.kcalMax) : '',
    proteinG: macro(candidate.proteinG),
    fatG: macro(candidate.fatG),
    carbsG: macro(candidate.carbsG),
    tags: [...candidate.tags],
  };
}

function kcalValue(text: string): number | string {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return 'Введите целое число ккал';
  const value = Number(trimmed);
  if (value > 5000) return 'Не больше 5000 ккал';
  return value;
}

function macroValue(text: string): number | null | string {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed.length === 0) return null;
  if (!/^\d+(\.\d)?$/.test(trimmed)) return 'Число не меньше 0, один знак после запятой';
  const value = Number(trimmed);
  if (value > 500) return 'Не больше 500 г';
  return value;
}

interface ValidMeal {
  title: string;
  kcalMin: number;
  kcalMax: number;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  tags: Tag[];
  eatenAt: string;
}

export function validateMeal(
  form: MealFormState,
  now: Date,
  timeZone: string,
  originalEatenAt?: string,
): { meal: ValidMeal | null; errors: Partial<Record<MealField, string>> } {
  const errors: Partial<Record<MealField, string>> = {};
  const title = form.title.trim();
  if (form.tags.length > MAX_MEAL_TAGS) errors.tags = `Не больше ${String(MAX_MEAL_TAGS)} тегов`;
  if (title.length === 0) errors.title = 'Введите название';
  else if (title.length > 200) errors.title = 'Не больше 200 символов';

  let kcalMin = 0;
  let kcalMax = 0;
  if (form.range) {
    const min = kcalValue(form.kcalMin);
    const max = kcalValue(form.kcalMax);
    if (typeof min === 'string') errors.kcalMin = min;
    if (typeof max === 'string') errors.kcalMax = max;
    if (typeof min === 'number' && typeof max === 'number') {
      if (min > max) errors.kcalMax = 'Верхняя граница не может быть меньше нижней';
      kcalMin = min;
      kcalMax = max;
    }
  } else {
    const single = kcalValue(form.kcal);
    if (typeof single === 'string') errors.kcal = single;
    else {
      kcalMin = single;
      kcalMax = single;
    }
  }

  const macros = {
    proteinG: macroValue(form.proteinG),
    fatG: macroValue(form.fatG),
    carbsG: macroValue(form.carbsG),
  };
  for (const key of ['proteinG', 'fatG', 'carbsG'] as const) {
    const value = macros[key];
    if (typeof value === 'string') errors[key] = value;
  }

  const eatenAt = fromZonedInput(form.eatenAt, timeZone);
  const untouched =
    eatenAt !== null &&
    originalEatenAt !== undefined &&
    Math.abs(eatenAt.getTime() - new Date(originalEatenAt).getTime()) < 60_000;
  if (eatenAt === null) errors.eatenAt = 'Укажите дату и время';
  else if (!untouched && eatenAt.getTime() < now.getTime() - MAX_PAST_DAYS * DAY_MS)
    errors.eatenAt = 'Можно указать время за последние 7 дней';
  else if (!untouched && eatenAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS)
    errors.eatenAt = 'Время не может быть в будущем';

  if (Object.keys(errors).length > 0 || eatenAt === null) return { meal: null, errors };
  const numbers = macros as { proteinG: number | null; fatG: number | null; carbsG: number | null };
  return {
    meal: {
      title,
      kcalMin,
      kcalMax,
      proteinG: numbers.proteinG,
      fatG: numbers.fatG,
      carbsG: numbers.carbsG,
      tags: form.tags,
      eatenAt: eatenAt.toISOString(),
    },
    errors,
  };
}

function kcalPart(meal: ValidMeal): Pick<ManualMealInput, 'kcal' | 'kcalMin' | 'kcalMax'> {
  return meal.kcalMin === meal.kcalMax
    ? { kcal: meal.kcalMin }
    : { kcalMin: meal.kcalMin, kcalMax: meal.kcalMax };
}

export function toCreateInput(meal: ValidMeal): ManualMealInput {
  return {
    title: meal.title,
    ...kcalPart(meal),
    ...(meal.proteinG === null ? {} : { proteinG: meal.proteinG }),
    ...(meal.fatG === null ? {} : { fatG: meal.fatG }),
    ...(meal.carbsG === null ? {} : { carbsG: meal.carbsG }),
    ...(meal.tags.length > 0 ? { tags: meal.tags } : {}),
    eatenAt: meal.eatenAt,
  };
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().join() === [...right].sort().join();
}

export function toPatchInput(meal: ValidMeal, original: Meal): MealPatchInput {
  const patch: MealPatchInput = {};
  if (meal.title !== original.title) patch.title = meal.title;
  if (meal.kcalMin !== original.kcalMin || meal.kcalMax !== original.kcalMax)
    Object.assign(patch, kcalPart(meal));
  if (meal.proteinG !== original.proteinG) patch.proteinG = meal.proteinG;
  if (meal.fatG !== original.fatG) patch.fatG = meal.fatG;
  if (meal.carbsG !== original.carbsG) patch.carbsG = meal.carbsG;
  if (!sameTags(meal.tags, original.tags)) patch.tags = meal.tags;
  if (Math.abs(new Date(meal.eatenAt).getTime() - new Date(original.eatenAt).getTime()) >= 60_000) {
    patch.eatenAt = meal.eatenAt;
  }
  return patch;
}

const FIELD_ALIASES: Record<string, MealField> = { kcal: 'kcal', kcalMin: 'kcalMin', kcalMax: 'kcalMax' };

export function mapFieldErrors(
  fieldErrors: Record<string, string>,
  range: boolean,
): Partial<Record<MealField, string>> {
  const result: Partial<Record<MealField, string>> = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    const alias = FIELD_ALIASES[path];
    if (alias !== undefined) {
      result[range ? (alias === 'kcal' ? 'kcalMin' : alias) : 'kcal'] ??= message;
      continue;
    }
    if (['title', 'proteinG', 'fatG', 'carbsG', 'tags', 'eatenAt'].includes(path)) {
      result[path as MealField] ??= message;
    }
  }
  return result;
}
