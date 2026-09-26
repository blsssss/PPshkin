import { plural } from '../../shared/plural.ts';
import { formatLocalTime } from '../../shared/time.ts';
import type { Deal, FactorScore, IntentFactor, MenuItem, OfferExplanation, Venue } from '../models.ts';
import type { BehaviorProfile } from '../nutrition/profile.ts';
import type { DayTotals } from '../nutrition/totals.ts';
import { TAG_LABELS } from '../vocabulary.ts';
import type { MealSlot, Tag } from '../vocabulary.ts';
import type { Candidate, IntentContext } from './types.ts';

export interface ExplanationInput {
  context: IntentContext;
  candidate: Candidate;
  slot: MealSlot;
  remainingKcal: number;
  slotBudgetKcal: number;
  distanceM: number | null;
  factors: FactorScore[];
}

const DESSERT_TAGS: readonly Tag[] = ['sweet', 'dessert'];
const DESSERT_SLOTS: readonly MealSlot[] = ['snack', 'lunch'];
const SLOT_HEADLINES: Record<Exclude<MealSlot, 'dinner'>, string> = {
  breakfast: 'Хороший вариант на завтрак',
  lunch: 'Подходит на обед',
  snack: 'Лёгкий перекус',
};
const MEAL_FORMS = ['приём', 'приёма', 'приёмов'] as const;
const FAVOURITE_TASTE_MIN = 0.6;
const FAVOURITE_LABELS_LIMIT = 3;
const WALKING_LIMIT_M = 1000;
const WALKING_STEP_M = 50;
const DISCLAIMER = 'Калорийность приблизительная, это не медицинская рекомендация';

function isDessert(item: MenuItem): boolean {
  return item.category === 'dessert' || item.tags.some((tag) => DESSERT_TAGS.includes(tag));
}

function factorValue(factors: readonly FactorScore[], factor: IntentFactor): number {
  return factors.find((score) => score.factor === factor)?.value ?? 0;
}

function headline({ candidate, slot, slotBudgetKcal, factors }: ExplanationInput): string {
  if (isDessert(candidate.item) && DESSERT_SLOTS.includes(slot)) return 'Можно позволить десерт';
  if (factorValue(factors, 'macros') === 1) return 'Поможет добрать белок';
  if (slot === 'dinner') return candidate.item.kcal <= slotBudgetKcal ? 'Лёгкий ужин' : 'Подходит на ужин';
  return SLOT_HEADLINES[slot];
}

function diaryFact(today: DayTotals): string {
  if (today.meals === 0) return 'Сегодня в дневнике ещё нет записей';
  return `Сегодня записано ${today.meals} ${plural(today.meals, MEAL_FORMS)} пищи, примерно ${today.kcal} ккал`;
}

function tasteFacts(item: MenuItem, profile: BehaviorProfile, taste: number): string[] {
  if (profile.readiness !== 'ready' || taste < FAVOURITE_TASTE_MIN) return [];
  const labels = profile.topTags
    .filter((tag) => item.tags.includes(tag))
    .slice(0, FAVOURITE_LABELS_LIMIT)
    .map((tag) => TAG_LABELS[tag]);
  return labels.length === 0 ? [] : [`Вы часто выбираете: ${labels.join(', ')}`];
}

function dishFact(item: MenuItem, venue: Venue): string {
  const dish = `«${item.name}» в «${venue.name}»`;
  return item.nutritionSource === 'venue'
    ? `${dish}: ${item.kcal} ккал по данным заведения`
    : `${dish}: около ${item.kcal} ккал, оценка по описанию блюда`;
}

function distanceLine(distanceM: number): string {
  if (distanceM < WALKING_LIMIT_M) {
    return `Идти около ${Math.max(WALKING_STEP_M, Math.round(distanceM / WALKING_STEP_M) * WALKING_STEP_M)} м`;
  }
  return `Около ${(Math.round(distanceM / 100) / 10).toFixed(1).replace('.', ',')} км`;
}

function dealLines(item: MenuItem, deal: Deal, venue: Venue): string[] {
  const discount = item.priceRub > 0 ? Math.max(0, 1 - deal.priceRub / item.priceRub) : 0;
  const endsAt = formatLocalTime(deal.endsAt, venue.timezone);
  return [
    `Скидка ${Math.round(discount * 100)}%: ${deal.priceRub} ₽ вместо ${item.priceRub} ₽, до ${endsAt}`,
    `Осталось ${deal.quantityLeft} шт.`,
  ];
}

function assumptions(profile: BehaviorProfile, venue: Venue): string[] {
  return [
    DISCLAIMER,
    ...(profile.readiness === 'ready' ? [] : ['Профиль вкусов ещё собирается']),
    ...(venue.isDemo ? ['Заведение и меню тестовые'] : []),
  ];
}

export function explainRecommendation(input: ExplanationInput): OfferExplanation {
  const { context, candidate, remainingKcal, distanceM, factors } = input;
  const { item, venue, deal } = candidate;
  return {
    headline: headline(input),
    facts: [
      diaryFact(context.today),
      ...tasteFacts(item, context.profile, factorValue(factors, 'taste')),
      dishFact(item, venue),
    ],
    calculations: [
      `До ориентира ${context.user.kcalTarget} ккал остаётся около ${remainingKcal} ккал`,
      ...(distanceM === null ? [] : [distanceLine(distanceM)]),
      ...(deal === null ? [] : dealLines(item, deal, venue)),
    ],
    assumptions: assumptions(context.profile, venue),
    factors: [...factors],
  };
}
