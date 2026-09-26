import { z } from 'zod';
import type { ProfileReadiness } from '../../domain/nutrition/profile.ts';
import { ACTIVITY_LEVELS, type Sex, type TargetEstimate } from '../../domain/nutrition/targets.ts';
import { GOALS, MEAL_SLOT_LABELS, MEAL_SLOTS, TAG_LABELS, TAGS } from '../../domain/vocabulary.ts';
import type { Insights } from '../../services/insights.ts';

const READINESS = ['empty', 'collecting', 'ready'] as const satisfies readonly ProfileReadiness[];
const SEXES = ['female', 'male'] as const satisfies readonly Sex[];

const Share = z.number().min(0).max(1);
const LocalHour = z.number().int().min(0).max(23).nullable();

export const InsightsSchema = z
  .object({
    readiness: z
      .enum(READINESS)
      .describe(
        'empty - за 14 дней нет записей, подбор блюд вернёт profile_empty; collecting - профиль собирается, вкусы учитываются слабо; ready - не меньше 5 записей и 2 дней с записями',
      ),
    mealsCount: z.number().int().describe('Записей в дневнике за последние 14 дней'),
    mealsUntilReady: z.number().int().describe('Сколько записей осталось до готового профиля'),
    daysTracked: z.number().int().describe('Дней с записями за последние 14 дней'),
    averageDailyKcal: z
      .number()
      .int()
      .nullable()
      .describe('Средняя калорийность дня по дням хотя бы с 2 записями; null, если таких дней нет'),
    topTags: z
      .array(z.object({ tag: z.enum(TAGS), label: z.string().describe('Подпись тега по-русски') }))
      .describe('Любимые теги блюд, от самого частого'),
    slots: z
      .array(
        z.object({
          slot: z.enum(MEAL_SLOTS),
          label: z.string().describe('Название приёма пищи по-русски'),
          share: Share.describe('Доля дней с этим приёмом пищи'),
          averageKcal: z.number().int().nullable().describe('Средняя калорийность приёма пищи'),
          typicalHour: LocalHour.describe('Обычный час по местному времени'),
        }),
      )
      .describe('Привычки по приёмам пищи: завтрак, обед, перекус, ужин'),
    sweetTooth: z
      .object({
        share: Share.describe('Доля дней со сладким'),
        typicalHour: LocalHour.describe('Обычный час сладкого по местному времени'),
      })
      .describe('Тяга к сладкому'),
    proteinShare: Share.nullable().describe(
      'Доля калорий из белка по записям, где белок известен; null, если таких записей нет',
    ),
    today: z
      .object({
        date: z.iso.date().describe('Сегодняшняя дата в часовом поясе пользователя'),
        slot: z.enum(MEAL_SLOTS).describe('Приём пищи сейчас'),
        targetKcal: z.number().int().describe('Ориентир калорийности на день'),
        meals: z.number().int().describe('Записей за сегодня'),
        kcal: z.number().int().describe('Съедено за сегодня, ккал'),
        remainingKcal: z.number().int().describe('Сколько осталось до ориентира, не меньше 0'),
        proteinG: z.number().describe('Белки за сегодня, г'),
        fatG: z.number().describe('Жиры за сегодня, г'),
        carbsG: z.number().describe('Углеводы за сегодня, г'),
      })
      .describe('Сводка текущих суток'),
  })
  .meta({
    id: 'Insights',
    description:
      'Профиль пищевого поведения за последние 14 дней и сводка дня. Калорийность приблизительная, это не медицинская рекомендация',
  });

export const BodyParametersSchema = z
  .object({
    sex: z.enum(SEXES).describe('female - женский, male - мужской'),
    ageYears: z.number().int().min(14).max(100).describe('Возраст, полных лет'),
    heightCm: z.number().int().min(120).max(230).describe('Рост, см'),
    weightKg: z
      .number()
      .min(35)
      .max(250)
      .multipleOf(0.1)
      .describe('Вес, кг, не больше одного знака после запятой'),
    activity: z
      .enum(ACTIVITY_LEVELS)
      .describe(
        'sedentary - сидячий образ жизни; light - тренировки 1-3 раза в неделю; moderate - 3-5 раз; active - 6-7 раз',
      ),
    goal: z.enum(GOALS).describe('lose - снизить вес, maintain - удерживать, gain - набрать'),
  })
  .meta({ id: 'BodyParameters', description: 'Параметры тела и цель для расчёта ориентира калорийности' });

export const TargetEstimateSchema = z
  .object({
    kcalTarget: z.number().int().describe('Ориентир на день с учётом цели, кратен 50 ккал, от 1000 до 5000'),
    bmrKcal: z.number().int().describe('Основной обмен по формуле Миффлина - Сан Жеора'),
    maintenanceKcal: z.number().int().describe('Расход с учётом активности, при котором вес сохраняется'),
  })
  .meta({
    id: 'TargetEstimate',
    description: 'Оценка ориентира калорийности на день. Это не медицинская рекомендация',
  });

export function toInsights({ profile, today }: Insights): z.infer<typeof InsightsSchema> {
  return {
    readiness: profile.readiness,
    mealsCount: profile.mealsCount,
    mealsUntilReady: profile.mealsUntilReady,
    daysTracked: profile.daysTracked,
    averageDailyKcal: profile.averageDailyKcal,
    topTags: profile.topTags.map((tag) => ({ tag, label: TAG_LABELS[tag] })),
    slots: MEAL_SLOTS.map((slot) => {
      const { share, averageKcal, typicalHour } = profile.slots[slot];
      return { slot, label: MEAL_SLOT_LABELS[slot], share, averageKcal, typicalHour };
    }),
    sweetTooth: { share: profile.sweetTooth.share, typicalHour: profile.sweetTooth.typicalHour },
    proteinShare: profile.proteinShare,
    today: {
      date: today.date,
      slot: today.slot,
      targetKcal: today.targetKcal,
      meals: today.totals.meals,
      kcal: today.totals.kcal,
      remainingKcal: today.remainingKcal,
      proteinG: today.totals.proteinG,
      fatG: today.totals.fatG,
      carbsG: today.totals.carbsG,
    },
  };
}

export function toTargetEstimate(estimate: TargetEstimate): z.infer<typeof TargetEstimateSchema> {
  return {
    kcalTarget: estimate.kcalTarget,
    bmrKcal: estimate.bmrKcal,
    maintenanceKcal: estimate.maintenanceKcal,
  };
}
