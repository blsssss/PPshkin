import { z } from 'zod';
import { DECLINE_REASONS, MEAL_SLOTS } from '../../domain/vocabulary.ts';
import {
  MAX_RECOMMENDATIONS,
  RECOMMENDATION_STATUSES,
  type RecommendationsResult,
  type RecommendedOffer,
} from '../../services/recommendations.ts';
import { blankAsMissing, PointQueryFields, pointTogether } from './common.ts';
import { DealSchema, toDeal } from './deals.ts';
import { MenuItemSchema, toMenuItem } from './menu.ts';
import { toVenue, VenueSchema } from './venues.ts';

const DEFAULT_RECOMMENDATIONS = 5;

export const RecommendationsQuery = z
  .object({
    ...PointQueryFields,
    limit: z
      .preprocess(
        blankAsMissing,
        z.coerce.number().int().min(1).max(MAX_RECOMMENDATIONS).default(DEFAULT_RECOMMENDATIONS),
      )
      .describe('Сколько блюд подобрать'),
  })
  .check(pointTogether);

export const DeclineOfferBody = z.object({
  reason: z
    .enum(DECLINE_REASONS)
    .describe('not_today - не сегодня, блюдо скрывается на 3 дня; dislike - не нравится, на 30 дней'),
});

const Lines = z.array(z.string());

const RecommendationItemSchema = z
  .object({
    offerId: z
      .number()
      .int()
      .describe('Идентификатор показа, по нему гость отказывается через POST /api/v1/offers/{id}/decline'),
    headline: z.string().describe('Заголовок карточки, например «Можно позволить десерт»'),
    facts: Lines.describe('Факты из дневника и о блюде'),
    calculations: Lines.describe('Расчёты: остаток до ориентира, путь до заведения, скидка'),
    assumptions: Lines.describe('Допущения и оговорки, в том числе о приблизительной калорийности'),
    score: z.number().describe('Оценка соответствия, по ней отсортированы предложения'),
    item: MenuItemSchema,
    venue: VenueSchema,
    deal: DealSchema.nullable().describe('Горящее предложение на эту позицию или null'),
    distanceM: z
      .number()
      .int()
      .nullable()
      .describe('Расстояние до заведения в метрах; null, если точка неизвестна'),
    priceRub: z.number().int().describe('Цена с учётом горящего предложения'),
    kcal: z.number().int().describe('Калорийность позиции'),
  })
  .meta({
    id: 'RecommendationItem',
    description: 'Конкретное блюдо в конкретном заведении и объяснение, почему оно подходит',
  });

export const RecommendationsSchema = z
  .object({
    status: z
      .enum(RECOMMENDATION_STATUSES)
      .describe(
        'ok - есть предложения; profile_empty - за 14 дней нет записей в дневнике; budget_exhausted - ориентир на сегодня набран; nothing_fits - рядом нет подходящих открытых позиций',
      ),
    slot: z.enum(MEAL_SLOTS).describe('Приём пищи сейчас по местному времени пользователя'),
    remainingKcal: z.number().int().describe('Сколько осталось до ориентира на сегодня, не меньше 0'),
    slotBudgetKcal: z.number().int().describe('Разумная калорийность для этого приёма пищи'),
    items: z
      .array(RecommendationItemSchema)
      .describe('Предложения от лучшего к худшему, разные заведения идут первыми; пусто, если status не ok'),
  })
  .meta({ id: 'Recommendations', description: 'Подбор блюд рядом под остаток калорий и вкусы гостя' });

function toRecommendationItem(offer: RecommendedOffer): z.infer<typeof RecommendationItemSchema> {
  const { headline, facts, calculations, assumptions } = offer.explanation;
  return {
    offerId: offer.offerId,
    headline,
    facts,
    calculations,
    assumptions,
    score: offer.score,
    item: toMenuItem(offer.item),
    venue: toVenue(offer.venue),
    deal: offer.deal ? toDeal(offer.deal) : null,
    distanceM: offer.distanceM,
    priceRub: offer.priceRub,
    kcal: offer.kcal,
  };
}

export function toRecommendations(result: RecommendationsResult): z.infer<typeof RecommendationsSchema> {
  return {
    status: result.status,
    slot: result.slot,
    remainingKcal: result.remainingKcal,
    slotBudgetKcal: result.slotBudgetKcal,
    items: result.items.map(toRecommendationItem),
  };
}
