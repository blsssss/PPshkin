import { z } from 'zod';
import { kcalProblems, MEAL_LIMITS, type KcalFields } from '../../domain/meals.ts';
import { mealKcal } from '../../domain/nutrition/totals.ts';
import { MEAL_SLOTS, MEAL_SOURCES, TAGS } from '../../domain/vocabulary.ts';
import { UNAVAILABLE_REASONS, type DishEstimate } from '../../ports/recognition.ts';
import {
  DESCRIPTION_MAX_LENGTH,
  SUMMARY_MAX_DAYS,
  type DiaryDay,
  type DiaryMeal,
  type DiarySummaryDay,
  type MealLogResult,
} from '../../services/diary.ts';
import { isLocalDate } from '../../shared/time.ts';
import { IsoDateTime, iso } from './common.ts';

const LocalDateSchema = z.iso.date().describe('Календарная дата YYYY-MM-DD в часовом поясе пользователя');

export const DiaryDateParams = z.object({
  date: z
    .string()
    .refine(isLocalDate, 'expected a calendar date in YYYY-MM-DD format')
    .meta({
      format: 'date',
      examples: ['2026-09-25'],
      description: 'Дата YYYY-MM-DD в часовом поясе пользователя',
    }),
});

export const DiarySummaryQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(SUMMARY_MAX_DAYS)
    .default(7)
    .describe('Сколько последних дней включая сегодня'),
});

const KcalValue = z.number().int().min(0).max(MEAL_LIMITS.kcal);
const Grams = z.number().min(0).max(MEAL_LIMITS.grams);

const mealFields = {
  title: z.string().trim().min(1).max(MEAL_LIMITS.titleLength).describe('Название блюда'),
  kcal: KcalValue.describe('Калорийность одним числом, вместо пары kcalMin и kcalMax'),
  kcalMin: KcalValue.describe('Нижняя граница калорийности, передаётся вместе с kcalMax'),
  kcalMax: KcalValue.describe('Верхняя граница калорийности, не меньше kcalMin'),
  tags: z.array(z.enum(TAGS)).max(MEAL_LIMITS.tags),
  eatenAt: z.iso
    .datetime({ offset: true })
    .describe(
      'Когда съедено, ISO 8601: не раньше чем 7 дней назад и не позже чем через 5 минут от текущего времени',
    )
    .transform((value) => new Date(value)),
};

function refineKcal(required: boolean) {
  return (fields: KcalFields, context: z.RefinementCtx) => {
    for (const problem of kcalProblems(fields, required)) {
      context.addIssue({ code: 'custom', path: [problem.path], message: problem.message });
    }
  };
}

export const ManualMealSchema = z
  .object({
    title: mealFields.title,
    kcal: mealFields.kcal.optional(),
    kcalMin: mealFields.kcalMin.optional(),
    kcalMax: mealFields.kcalMax.optional(),
    proteinG: Grams.optional().describe('Белки, г'),
    fatG: Grams.optional().describe('Жиры, г'),
    carbsG: Grams.optional().describe('Углеводы, г'),
    tags: mealFields.tags.optional(),
    eatenAt: mealFields.eatenAt.optional(),
  })
  .superRefine(refineKcal(true))
  .meta({
    id: 'ManualMeal',
    description:
      'Приём пищи, введённый вручную. Калорийность: либо kcal, либо пара kcalMin и kcalMax. Без eatenAt запись получает текущее время',
  });

export const MealPatchSchema = z
  .object({
    title: mealFields.title.optional(),
    kcal: mealFields.kcal.optional(),
    kcalMin: mealFields.kcalMin.optional(),
    kcalMax: mealFields.kcalMax.optional(),
    proteinG: Grams.nullable().optional().describe('Белки, г, null сбрасывает значение'),
    fatG: Grams.nullable().optional().describe('Жиры, г, null сбрасывает значение'),
    carbsG: Grams.nullable().optional().describe('Углеводы, г, null сбрасывает значение'),
    tags: mealFields.tags.optional(),
    eatenAt: mealFields.eatenAt.optional(),
  })
  .refine((patch) => Object.values(patch).some((value: unknown) => value !== undefined), {
    message: 'send at least one field',
  })
  .superRefine(refineKcal(false))
  .meta({
    id: 'MealPatch',
    description:
      'Изменение приёма пищи: только меняющиеся поля, хотя бы одно. Калорийность: либо kcal, либо пара kcalMin и kcalMax',
  });

export const MealTextBody = z.object({
  description: z
    .string()
    .trim()
    .min(1)
    .max(DESCRIPTION_MAX_LENGTH)
    .describe('Что съедено, своими словами, например «овсянка с бананом и кофе с молоком»'),
});

export const MealSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    kcalMin: z.number().int(),
    kcalMax: z.number().int(),
    kcal: z.number().int().describe('Середина диапазона, по ней считаются итоги дня'),
    proteinG: z.number().nullable().describe('Белки, г'),
    fatG: z.number().nullable().describe('Жиры, г'),
    carbsG: z.number().nullable().describe('Углеводы, г'),
    tags: z.array(z.enum(TAGS)),
    source: z
      .enum(MEAL_SOURCES)
      .describe(
        'photo и text - распознано, manual - введено вручную, booking - погашенная бронь, demo - демо-данные',
      ),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .nullable()
      .describe('Уверенность распознавания от 0 до 1, null для остальных записей'),
    eatenAt: IsoDateTime,
    slot: z.enum(MEAL_SLOTS).describe('Приём пищи по местному времени пользователя'),
  })
  .meta({ id: 'Meal', description: 'Запись дневника питания. Калорийность приблизительная' });

export const DayTotalsSchema = z
  .object({
    meals: z.number().int().describe('Количество записей'),
    kcalMin: z.number().int(),
    kcalMax: z.number().int(),
    kcal: z.number().int().describe('Сумма середин диапазонов'),
    proteinG: z.number(),
    fatG: z.number(),
    carbsG: z.number(),
  })
  .meta({ id: 'DayTotals', description: 'Итоги дня' });

export const DiaryDaySchema = z
  .object({
    date: LocalDateSchema,
    timezone: z.string().describe('Часовой пояс, в котором считаются границы дня'),
    targetKcal: z.number().int().describe('Ориентир калорийности пользователя'),
    totals: DayTotalsSchema,
    remainingKcal: z.number().int().min(0).describe('Сколько осталось до ориентира, не меньше 0'),
    meals: z.array(MealSchema).describe('Записи дня по возрастанию eatenAt'),
  })
  .meta({ id: 'DiaryDay', description: 'Дневник за один день' });

export const DiarySummaryDaySchema = z
  .object({
    date: LocalDateSchema,
    meals: z.number().int(),
    kcal: z.number().int(),
    kcalMin: z.number().int(),
    kcalMax: z.number().int(),
    proteinG: z.number(),
    fatG: z.number(),
    carbsG: z.number(),
  })
  .meta({ id: 'DiarySummaryDay', description: 'Итоги одного дня, дни без записей с нулями' });

export const DiarySummarySchema = z
  .object({ days: z.array(DiarySummaryDaySchema).describe('Дни от старых к новым, последний - сегодня') })
  .meta({ id: 'DiarySummary', description: 'Итоги по дням' });

export const MealCandidateSchema = z
  .object({
    title: z.string().min(1).max(MEAL_LIMITS.titleLength),
    portionG: z.number().nullable().describe('Оценка порции, г'),
    kcalMin: KcalValue,
    kcalMax: KcalValue,
    proteinG: Grams,
    fatG: Grams,
    carbsG: Grams,
    tags: mealFields.tags,
    confidence: z.number().min(0).max(1),
  })
  .meta({
    id: 'MealCandidate',
    description:
      'Вариант распознавания, который гость может подтвердить. Значения укладываются в ограничения ManualMeal, поэтому title, kcalMin, kcalMax, proteinG, fatG, carbsG и tags можно отправить в POST /api/v1/diary/meals без изменений',
  });

const BasisSchema = z.string().describe('Короткое пояснение распознавания для гостя');

export const MealLogResultSchema = z
  .discriminatedUnion('status', [
    z.object({
      status: z.literal('logged'),
      meals: z.array(MealSchema).describe('Сохранённые записи'),
      basis: BasisSchema,
      day: DiaryDaySchema,
    }),
    z.object({
      status: z.literal('uncertain'),
      candidates: z.array(MealCandidateSchema),
      basis: BasisSchema,
    }),
    z.object({ status: z.literal('not_food'), basis: BasisSchema }),
    z.object({
      status: z.literal('unavailable'),
      reason: z.enum(UNAVAILABLE_REASONS),
    }),
  ])
  .meta({
    id: 'MealLogResult',
    description: [
      'Результат распознавания по полю status.',
      'logged: уверенно распознанные блюда сохранены, day - обновлённый дневник за сегодня.',
      'uncertain: ничего не сохранено, гость выбирает вариант или вводит блюдо, запись создаётся через POST /api/v1/diary/meals.',
      'not_food: на фото или в тексте нет еды, ничего не сохранено.',
      'unavailable: распознавание недоступно, предложите ручной ввод; reason unsupported_image - фото не удалось прочитать, попросите JPEG или PNG.',
    ].join(' '),
  });

export function toMeal(meal: DiaryMeal): z.infer<typeof MealSchema> {
  return {
    id: meal.id,
    title: meal.title,
    kcalMin: meal.kcalMin,
    kcalMax: meal.kcalMax,
    kcal: mealKcal(meal),
    proteinG: meal.proteinG,
    fatG: meal.fatG,
    carbsG: meal.carbsG,
    tags: meal.tags,
    source: meal.source,
    confidence: meal.confidence,
    eatenAt: iso(meal.eatenAt),
    slot: meal.slot,
  };
}

export function toDiaryDay(day: DiaryDay): z.infer<typeof DiaryDaySchema> {
  return {
    date: day.date,
    timezone: day.timezone,
    targetKcal: day.targetKcal,
    totals: { ...day.totals },
    remainingKcal: day.remainingKcal,
    meals: day.meals.map(toMeal),
  };
}

export function toDiarySummary(days: DiarySummaryDay[]): z.infer<typeof DiarySummarySchema> {
  return {
    days: days.map((day) => ({
      date: day.date,
      meals: day.meals,
      kcal: day.kcal,
      kcalMin: day.kcalMin,
      kcalMax: day.kcalMax,
      proteinG: day.proteinG,
      fatG: day.fatG,
      carbsG: day.carbsG,
    })),
  };
}

function toMealCandidate(estimate: DishEstimate): z.infer<typeof MealCandidateSchema> {
  return {
    title: estimate.title,
    portionG: estimate.portionG,
    kcalMin: estimate.kcalMin,
    kcalMax: estimate.kcalMax,
    proteinG: estimate.proteinG,
    fatG: estimate.fatG,
    carbsG: estimate.carbsG,
    tags: estimate.tags,
    confidence: estimate.confidence,
  };
}

export function toMealLogResult(result: MealLogResult): z.infer<typeof MealLogResultSchema> {
  switch (result.status) {
    case 'logged':
      return {
        status: 'logged',
        meals: result.meals.map(toMeal),
        basis: result.basis,
        day: toDiaryDay(result.day),
      };
    case 'uncertain':
      return { status: 'uncertain', candidates: result.candidates.map(toMealCandidate), basis: result.basis };
    case 'not_food':
      return { status: 'not_food', basis: result.basis };
    case 'unavailable':
      return { status: 'unavailable', reason: result.reason };
  }
}
