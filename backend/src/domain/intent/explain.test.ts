import { describe, expect, it } from 'vitest';
import {
  buildCandidate,
  buildContext,
  buildDeal,
  buildMenuItem,
  buildProfile,
  buildVenue,
} from '../../../test/fixtures/domain.ts';
import { INTENT_FACTORS } from '../models.ts';
import type { FactorScore, IntentFactor, MenuItem } from '../models.ts';
import { EMPTY_TOTALS } from '../nutrition/totals.ts';
import type { MealSlot } from '../vocabulary.ts';
import type { ExplanationInput } from './explain.ts';
import { explainRecommendation } from './explain.ts';
import { INTENT_WEIGHTS } from './rank.ts';

const DISCLAIMER = 'Калорийность приблизительная, это не медицинская рекомендация';
const readyProfile = buildProfile({ readiness: 'ready', mealsCount: 9, daysTracked: 3, mealsUntilReady: 0 });

function factorScores(values: Partial<Record<IntentFactor, number>> = {}): FactorScore[] {
  return INTENT_FACTORS.map((factor) => ({
    factor,
    value: values[factor] ?? 0,
    weight: INTENT_WEIGHTS[factor],
  }));
}

function input(overrides: Partial<ExplanationInput> = {}): ExplanationInput {
  return {
    context: buildContext({ profile: readyProfile }),
    candidate: buildCandidate(),
    slot: 'snack',
    remainingKcal: 2000,
    slotBudgetKcal: 200,
    distanceM: null,
    factors: factorScores(),
    ...overrides,
  };
}

const withItem = (overrides: Partial<MenuItem>) => buildCandidate({ item: buildMenuItem(overrides) });

describe('explainRecommendation', () => {
  it('explains the reference cheesecake offer', () => {
    const factors = factorScores({ fit: 0.4, taste: 0.89, habit: 1, proximity: 0.91, deal: 0.58 });
    const explanation = explainRecommendation({
      context: buildContext({
        today: { ...EMPTY_TOTALS, meals: 3, kcal: 1350 },
        profile: buildProfile({ ...readyProfile, topTags: ['sweet', 'dessert', 'coffee'] }),
      }),
      candidate: {
        item: buildMenuItem({
          id: 21,
          name: 'Чизкейк',
          category: 'dessert',
          kcal: 320,
          priceRub: 290,
          tags: ['sweet', 'dessert', 'dairy'],
          nutritionSource: 'estimate',
        }),
        venue: buildVenue({ name: 'Зерно', isDemo: false, timezone: 'Europe/Moscow' }),
        deal: buildDeal({
          menuItemId: 21,
          priceRub: 170,
          quantityLeft: 3,
          endsAt: new Date('2026-09-26T15:30:00Z'),
        }),
      },
      slot: 'snack',
      remainingKcal: 650,
      slotBudgetKcal: 200,
      distanceM: 430,
      factors,
    });
    expect(explanation).toEqual({
      headline: 'Можно позволить десерт',
      facts: [
        'Сегодня записано 3 приёма пищи, примерно 1350 ккал',
        'Вы часто выбираете: сладкое, десерт',
        '«Чизкейк» в «Зерно»: около 320 ккал, оценка по описанию блюда',
      ],
      calculations: [
        'До ориентира 2000 ккал остаётся около 650 ккал',
        'Идти около 450 м',
        'Скидка 41%: 170 ₽ вместо 290 ₽, до 18:30',
        'Осталось 3 шт.',
      ],
      assumptions: [DISCLAIMER],
      factors,
    });
  });

  it.each<[string, Partial<MenuItem>, MealSlot, number, string]>([
    ['a sweet item as a snack', { tags: ['sweet'] }, 'snack', 0, 'Можно позволить десерт'],
    ['a dessert category item at lunch', { category: 'dessert' }, 'lunch', 1, 'Можно позволить десерт'],
    ['a protein boost at dinner', { tags: ['dessert'] }, 'dinner', 1, 'Поможет добрать белок'],
    ['a protein boost at lunch', { tags: ['high_protein'] }, 'lunch', 1, 'Поможет добрать белок'],
    ['a dessert at breakfast', { tags: ['dessert'] }, 'breakfast', 0, 'Хороший вариант на завтрак'],
    ['a regular lunch', {}, 'lunch', 0, 'Подходит на обед'],
    ['a dinner within the slot budget', { kcal: 600 }, 'dinner', 0, 'Лёгкий ужин'],
    ['a dinner above the slot budget', { kcal: 601 }, 'dinner', 0, 'Подходит на ужин'],
    ['a regular snack', {}, 'snack', 0, 'Лёгкий перекус'],
  ])('headlines %s', (_label, item, slot, macros, headline) => {
    const explanation = explainRecommendation(
      input({ candidate: withItem(item), slot, slotBudgetKcal: 600, factors: factorScores({ macros }) }),
    );
    expect(explanation.headline).toBe(headline);
  });

  it.each([
    [0, 0, 'Сегодня в дневнике ещё нет записей'],
    [1, 450, 'Сегодня записано 1 приём пищи, примерно 450 ккал'],
    [2, 900, 'Сегодня записано 2 приёма пищи, примерно 900 ккал'],
    [5, 2100, 'Сегодня записано 5 приёмов пищи, примерно 2100 ккал'],
  ])('summarises a diary with %i meals', (meals, kcal, fact) => {
    const context = buildContext({ today: { ...EMPTY_TOTALS, meals, kcal } });
    expect(explainRecommendation(input({ context })).facts[0]).toBe(fact);
  });

  it('names up to three favourite tags of the dish in the order of the profile', () => {
    const context = buildContext({
      profile: buildProfile({
        ...readyProfile,
        topTags: ['coffee', 'sweet', 'dessert', 'dairy', 'chocolate'],
      }),
    });
    const candidate = withItem({ tags: ['chocolate', 'dairy', 'dessert', 'sweet'] });
    const explanation = explainRecommendation(
      input({ context, candidate, factors: factorScores({ taste: 0.6 }) }),
    );
    expect(explanation.facts).toContain('Вы часто выбираете: сладкое, десерт, молочное');
  });

  it.each<[string, Partial<ExplanationInput>]>([
    [
      'the profile is still collecting',
      { context: buildContext({ profile: buildProfile({ topTags: ['soup'] }) }) },
    ],
    ['the taste match is weak', { factors: factorScores({ taste: 0.59 }) }],
    ['the dish has none of the favourite tags', { candidate: withItem({ tags: ['fish'] }) }],
  ])('skips favourite tags when %s', (_label, overrides) => {
    const explanation = explainRecommendation(
      input({
        context: buildContext({ profile: buildProfile({ ...readyProfile, topTags: ['soup'] }) }),
        candidate: withItem({ tags: ['soup'] }),
        factors: factorScores({ taste: 0.9 }),
        ...overrides,
      }),
    );
    expect(explanation.facts).toHaveLength(2);
  });

  it('cites nutrition data provided by the venue', () => {
    const candidate = buildCandidate({
      item: buildMenuItem({ name: 'Борщ', kcal: 280, nutritionSource: 'venue' }),
      venue: buildVenue({ name: 'Столовая № 1' }),
    });
    expect(explainRecommendation(input({ candidate })).facts.at(-1)).toBe(
      '«Борщ» в «Столовая № 1»: 280 ккал по данным заведения',
    );
  });

  it.each([
    [0, 'Идти около 50 м'],
    [30, 'Идти около 50 м'],
    [430, 'Идти около 450 м'],
    [999, 'Идти около 1000 м'],
    [1000, 'Около 1,0 км'],
    [2345, 'Около 2,3 км'],
  ])('describes a distance of %i m', (distanceM, text) => {
    expect(explainRecommendation(input({ distanceM })).calculations).toEqual([
      'До ориентира 2000 ккал остаётся около 2000 ккал',
      text,
    ]);
  });

  it('leaves out the distance when it is unknown', () => {
    expect(explainRecommendation(input({ remainingKcal: 740 })).calculations).toEqual([
      'До ориентира 2000 ккал остаётся около 740 ккал',
    ]);
  });

  it('shows the deal end in the time zone of the venue', () => {
    const candidate = buildCandidate({
      venue: buildVenue({ timezone: 'Asia/Yekaterinburg' }),
      deal: buildDeal({ priceRub: 150, quantityLeft: 1, endsAt: new Date('2026-09-26T15:30:00Z') }),
    });
    expect(explainRecommendation(input({ candidate })).calculations.slice(1)).toEqual([
      'Скидка 50%: 150 ₽ вместо 300 ₽, до 20:30',
      'Осталось 1 шт.',
    ]);
  });

  it.each([
    [0, 0, 'Скидка 0%: 0 ₽ вместо 0 ₽, до 19:00'],
    [300, 350, 'Скидка 0%: 350 ₽ вместо 300 ₽, до 19:00'],
  ])('never reports a negative discount for a %i ₽ dish', (itemPrice, dealPrice, text) => {
    const candidate = buildCandidate({
      item: buildMenuItem({ priceRub: itemPrice }),
      deal: buildDeal({ priceRub: dealPrice }),
    });
    expect(explainRecommendation(input({ candidate })).calculations[1]).toBe(text);
  });

  it('adds assumptions for a profile in progress and a demo venue', () => {
    const explanation = explainRecommendation(
      input({
        context: buildContext({ profile: buildProfile({ readiness: 'collecting', mealsCount: 2 }) }),
        candidate: buildCandidate({ venue: buildVenue({ isDemo: true }) }),
      }),
    );
    expect(explanation.assumptions).toEqual([
      DISCLAIMER,
      'Профиль вкусов ещё собирается',
      'Заведение и меню тестовые',
    ]);
  });

  it('treats missing factors as zero', () => {
    const explanation = explainRecommendation(
      input({
        context: buildContext({ profile: buildProfile({ ...readyProfile, topTags: ['soup'] }) }),
        candidate: withItem({ tags: ['soup', 'high_protein'] }),
        slot: 'lunch',
        factors: [],
      }),
    );
    expect(explanation.headline).toBe('Подходит на обед');
    expect(explanation.facts).toHaveLength(2);
    expect(explanation.factors).toEqual([]);
  });

  it('returns its own copy of the factor list', () => {
    const factors = factorScores({ fit: 1 });
    const explanation = explainRecommendation(input({ factors }));
    expect(explanation.factors).toEqual(factors);
    expect(explanation.factors).not.toBe(factors);
  });
});
