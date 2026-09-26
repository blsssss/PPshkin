import { describe, expect, it } from 'vitest';
import {
  buildCandidate,
  buildContext,
  buildDeal,
  buildMeal,
  buildMenuItem,
  buildProfile,
  buildVenue,
  KAZAN_CENTER,
  minutesFromNow,
  NOW,
} from '../../../test/fixtures/domain.ts';
import { INTENT_FACTORS } from '../models.ts';
import type { Deal, FactorScore, GeoPoint, IntentFactor, MenuItem, Venue } from '../models.ts';
import { buildBehaviorProfile } from '../nutrition/profile.ts';
import type { BehaviorProfile } from '../nutrition/profile.ts';
import { dayTotals, EMPTY_TOTALS } from '../nutrition/totals.ts';
import type { DayTotals } from '../nutrition/totals.ts';
import { MENU_CATEGORIES } from '../vocabulary.ts';
import type { MealSlot, MenuCategory, Tag } from '../vocabulary.ts';
import { explainRecommendation } from './explain.ts';
import { DEFAULT_MAX_DISTANCE_M, INTENT_WEIGHTS, rankCandidates } from './rank.ts';
import type { Candidate, IntentContext, RankOptions, RankResult, Recommendation } from './types.ts';

const EARTH_RADIUS_M = 6_371_000;

const metersNorth = (meters: number): GeoPoint => ({
  lat: KAZAN_CENTER.lat + (meters / EARTH_RADIUS_M) * (180 / Math.PI),
  lon: KAZAN_CENTER.lon,
});

const locatedUser = { location: KAZAN_CENTER };
const collecting = (overrides: Partial<BehaviorProfile> = {}) =>
  buildProfile({ readiness: 'collecting', mealsCount: 3, daysTracked: 1, mealsUntilReady: 2, ...overrides });

function slotsWithShare(slot: MealSlot, share: number): BehaviorProfile['slots'] {
  return { ...buildProfile().slots, [slot]: { share, averageKcal: 300, typicalHour: 12 } };
}

function okItems(result: RankResult): Recommendation[] {
  expect(result.status).toBe('ok');
  return result.status === 'ok' ? result.items : [];
}

function rankOne(
  candidate: Candidate,
  context: IntentContext = buildContext(),
  options: Partial<RankOptions> = {},
): Recommendation {
  const [recommendation] = okItems(rankCandidates(context, [candidate], { limit: 1, ...options }));
  return recommendation!;
}

function factorOf(recommendation: Recommendation, factor: IntentFactor): number {
  return recommendation.factors.find((score) => score.factor === factor)!.value;
}

const withItem = (overrides: Partial<MenuItem>) => buildCandidate({ item: buildMenuItem(overrides) });
const withDeal = (overrides: Partial<Deal>) => buildCandidate({ deal: buildDeal(overrides) });
const atDistance = (meters: number) => buildVenue({ location: metersNorth(meters) });
const itemIds = (items: readonly Recommendation[]) => items.map(({ candidate }) => candidate.item.id);

describe('INTENT_WEIGHTS', () => {
  it('weights every factor in the documented order', () => {
    expect(Object.keys(INTENT_WEIGHTS)).toEqual([...INTENT_FACTORS]);
  });

  it('splits one point between positive factors and uses novelty as a penalty', () => {
    const positive = INTENT_FACTORS.filter((factor) => factor !== 'novelty');
    expect(positive.reduce((total, factor) => total + INTENT_WEIGHTS[factor], 0)).toBeCloseTo(1, 10);
    expect(INTENT_WEIGHTS.novelty).toBe(0.2);
  });
});

describe('rankCandidates', () => {
  it('recommends an eligible dish with its factors, price and explanation', () => {
    const context = buildContext({ user: locatedUser });
    const candidate = buildCandidate({
      venue: atDistance(1000),
      deal: buildDeal({ priceRub: 150, endsAt: minutesFromNow(60) }),
    });
    const factors: FactorScore[] = [
      { factor: 'fit', value: 1, weight: 0.3 },
      { factor: 'taste', value: 0.5, weight: 0.25 },
      { factor: 'habit', value: 0, weight: 0.1 },
      { factor: 'macros', value: 0, weight: 0.05 },
      { factor: 'proximity', value: 0.8, weight: 0.15 },
      { factor: 'deal', value: 0.85, weight: 0.15 },
      { factor: 'novelty', value: 0, weight: 0.2 },
    ];
    expect(rankCandidates(context, [candidate], { limit: 3 })).toEqual({
      status: 'ok',
      slot: 'snack',
      remainingKcal: 2000,
      slotBudgetKcal: 200,
      items: [
        {
          candidate,
          score: 0.6725,
          distanceM: 1000,
          kcal: 200,
          priceRub: 150,
          factors,
          explanation: explainRecommendation({
            context,
            candidate,
            slot: 'snack',
            remainingKcal: 2000,
            slotBudgetKcal: 200,
            distanceM: 1000,
            factors,
          }),
        },
      ],
    });
  });

  it('charges the menu price when there is no deal', () => {
    const recommendation = rankOne(buildCandidate());
    expect(recommendation.priceRub).toBe(300);
    expect(recommendation.distanceM).toBeNull();
    expect(recommendation.score).toBe(0.5);
  });

  it('scores with unrounded factor values', () => {
    const lunch = buildContext({ now: new Date('2026-09-26T10:00:00Z') });
    const recommendation = rankOne(withItem({ kcal: 500 }), lunch);
    expect(factorOf(recommendation, 'fit')).toBe(0.71);
    expect(recommendation.score).toBe(0.4143);
  });

  describe('budget', () => {
    it.each([
      [1901, 99],
      [2000, 0],
      [2600, 0],
    ])('is exhausted after %i kcal eaten', (eaten, remaining) => {
      const context = buildContext({ today: { ...EMPTY_TOTALS, meals: 3, kcal: eaten } });
      expect(rankCandidates(context, [withItem({ kcal: 50 })], { limit: 3 })).toEqual({
        status: 'budget_exhausted',
        slot: 'snack',
        remainingKcal: remaining,
        slotBudgetKcal: remaining,
        items: [],
      });
    });

    it('still recommends with exactly 100 kcal left', () => {
      const context = buildContext({ today: { ...EMPTY_TOTALS, meals: 3, kcal: 1900 } });
      const result = rankCandidates(context, [withItem({ kcal: 100 })], { limit: 3 });
      expect(result).toMatchObject({ status: 'ok', remainingKcal: 100, slotBudgetKcal: 100 });
    });

    it('gives a slot at least 120 kcal', () => {
      const context = buildContext({ user: { kcalTarget: 1000 } });
      expect(rankCandidates(context, [], { limit: 1 }).slotBudgetKcal).toBe(120);
    });

    it('never plans a slot above the remaining budget', () => {
      const context = buildContext({ today: { ...EMPTY_TOTALS, meals: 2, kcal: 1850 } });
      expect(rankCandidates(context, [], { limit: 1 }).slotBudgetKcal).toBe(150);
    });

    it('uses the meal slot of the user time zone', () => {
      const moscow = rankCandidates(buildContext(), [], { limit: 1 });
      const yekaterinburg = rankCandidates(buildContext({ user: { timezone: 'Asia/Yekaterinburg' } }), [], {
        limit: 1,
      });
      expect([moscow.slot, moscow.slotBudgetKcal]).toEqual(['snack', 200]);
      expect([yekaterinburg.slot, yekaterinburg.slotBudgetKcal]).toEqual(['dinner', 600]);
    });
  });

  describe('filters', () => {
    it('reports that nothing fits when no candidates are left', () => {
      expect(rankCandidates(buildContext(), [], { limit: 3 })).toEqual({
        status: 'nothing_fits',
        slot: 'snack',
        remainingKcal: 2000,
        slotBudgetKcal: 200,
        items: [],
      });
    });

    it.each<[string, Candidate, IntentContext?]>([
      ['an archived dish', withItem({ archivedAt: minutesFromNow(-10) })],
      ['a dish marked unavailable', withItem({ isAvailable: false })],
      ['a dish of another venue', withItem({ venueId: 2 })],
      ['a deal of another venue', withDeal({ venueId: 2 })],
      ['a deal for another dish', withDeal({ menuItemId: 11 })],
      ['a closed venue', buildCandidate({ venue: buildVenue({ opensAt: '17:00:00' }) })],
      ['a cancelled deal', withDeal({ cancelledAt: minutesFromNow(-5) })],
      ['a sold out deal', withDeal({ quantityLeft: 0 })],
      ['a deal that has not started', withDeal({ startsAt: minutesFromNow(1) })],
      ['a deal that has ended', withDeal({ endsAt: NOW })],
      [
        'a dish with a disliked tag',
        withItem({ tags: ['meat', 'spicy'] }),
        buildContext({ user: { dislikedTags: ['spicy'] } }),
      ],
      ['a recently declined dish', buildCandidate(), buildContext({ declinedItemIds: new Set([10]) })],
      [
        'a dish above the remaining budget and tolerance',
        withItem({ kcal: 401 }),
        buildContext({ today: { ...EMPTY_TOTALS, meals: 3, kcal: 1700 } }),
      ],
      [
        'a dish above the minimal tolerance',
        withItem({ kcal: 851 }),
        buildContext({ user: { kcalTarget: 800 } }),
      ],
      [
        'a venue beyond the distance limit',
        buildCandidate({ venue: atDistance(5001) }),
        buildContext({ user: locatedUser }),
      ],
    ])('drops %s', (_label, candidate, context = buildContext()) => {
      expect(rankCandidates(context, [candidate], { limit: 3 }).status).toBe('nothing_fits');
    });

    it.each<[string, Candidate, IntentContext?]>([
      ['a deal that starts now and ends in a minute', withDeal({ startsAt: NOW, endsAt: minutesFromNow(1) })],
      [
        'a dish within the tolerance of 5% of the target',
        withItem({ kcal: 400 }),
        buildContext({ today: { ...EMPTY_TOTALS, meals: 3, kcal: 1700 } }),
      ],
      [
        'a dish within the minimal tolerance',
        withItem({ kcal: 850 }),
        buildContext({ user: { kcalTarget: 800 } }),
      ],
      [
        'a venue exactly at the distance limit',
        buildCandidate({ venue: atDistance(5000) }),
        buildContext({ user: locatedUser }),
      ],
      [
        'a dish with tags the user does not mind',
        withItem({ tags: ['meat'] }),
        buildContext({ user: { dislikedTags: ['spicy'] } }),
      ],
    ])('keeps %s', (_label, candidate, context = buildContext()) => {
      expect(okItems(rankCandidates(context, [candidate], { limit: 3 }))).toHaveLength(1);
    });

    it('applies a custom distance limit', () => {
      const context = buildContext({ user: locatedUser });
      const far = buildCandidate({ venue: atDistance(1001) });
      expect(rankCandidates(context, [far], { limit: 1, maxDistanceM: 1000 }).status).toBe('nothing_fits');
      expect(DEFAULT_MAX_DISTANCE_M).toBe(5000);
    });

    it.each([
      ['2026-09-26T13:00:00Z', 'nothing_fits'],
      ['2026-09-26T22:30:00Z', 'ok'],
      ['2026-09-26T23:00:00Z', 'nothing_fits'],
    ])('checks overnight opening hours at %s', (now, status) => {
      const candidate = buildCandidate({ venue: buildVenue({ opensAt: '20:00:00', closesAt: '02:00:00' }) });
      expect(rankCandidates(buildContext({ now: new Date(now) }), [candidate], { limit: 1 }).status).toBe(
        status,
      );
    });
  });

  describe('factors', () => {
    it.each([
      [200, 1],
      [300, 0.5],
      [100, 0.5],
      [450, 0],
    ])('fits %i kcal into a 200 kcal slot as %d', (kcal, fit) => {
      expect(factorOf(rankOne(withItem({ kcal })), 'fit')).toBe(fit);
    });

    it.each<[string, BehaviorProfile, Tag[], number]>([
      ['an empty profile', buildProfile({ tagAffinity: { soup: 1 } }), ['soup'], 0.5],
      ['a dish without tags', collecting({ tagAffinity: { sweet: 0.8, soup: 0.4 } }), [], 0.3],
      ['a profile without tags', collecting(), ['soup'], 0.3],
      ['a profile with zero affinity', collecting({ tagAffinity: { soup: 0 } }), ['soup'], 0.3],
      ['the favourite tag', collecting({ tagAffinity: { sweet: 0.8, soup: 0.4 } }), ['sweet'], 1],
      [
        'a mix of known and unknown tags',
        collecting({ tagAffinity: { sweet: 0.8, soup: 0.4 } }),
        ['soup', 'fish'],
        0.25,
      ],
    ])('rates taste for %s', (_label, profile, tags, taste) => {
      expect(factorOf(rankOne(withItem({ tags }), buildContext({ profile })), 'taste')).toBe(taste);
    });

    it.each<[string, Partial<MenuItem>, Partial<BehaviorProfile>, number]>([
      [
        'a sweet tooth two hours later',
        { tags: ['sweet'] },
        { sweetTooth: { share: 0.4, typicalHour: 18 } },
        1,
      ],
      [
        'a sweet tooth three hours later',
        { tags: ['sweet'] },
        { sweetTooth: { share: 0.4, typicalHour: 19 } },
        0,
      ],
      [
        'a sweet tooth on too few days',
        { tags: ['dessert'] },
        { sweetTooth: { share: 0.39, typicalHour: 16 } },
        0,
      ],
      [
        'a sweet tooth without an hour',
        { tags: ['dessert'] },
        { sweetTooth: { share: 0.5, typicalHour: null } },
        0,
      ],
      [
        'a dessert without sweet tags',
        { category: 'dessert' },
        { sweetTooth: { share: 0.5, typicalHour: 15 } },
        1,
      ],
      [
        'a sweet tooth and a savoury dish',
        { tags: ['meat'] },
        { sweetTooth: { share: 0.9, typicalHour: 16 } },
        0,
      ],
      ['a regular snack of bakery', { category: 'bakery' }, { slots: slotsWithShare('snack', 0.5) }, 1],
      ['an occasional snack of bakery', { category: 'bakery' }, { slots: slotsWithShare('snack', 0.49) }, 0],
      ['a regular snack of a main course', { category: 'main' }, { slots: slotsWithShare('snack', 1) }, 0],
    ])('rates habit for %s', (_label, item, profile, habit) => {
      expect(factorOf(rankOne(withItem(item), buildContext({ profile: collecting(profile) })), 'habit')).toBe(
        habit,
      );
    });

    it.each<[MealSlot, string, MenuCategory[]]>([
      ['breakfast', '2026-09-26T06:00:00Z', ['breakfast', 'bakery', 'drink']],
      ['lunch', '2026-09-26T10:00:00Z', ['main', 'soup', 'salad', 'side']],
      ['snack', '2026-09-26T13:00:00Z', ['bakery', 'dessert', 'snack', 'drink']],
      ['dinner', '2026-09-26T16:00:00Z', ['main', 'salad', 'soup', 'side']],
    ])('rates habit for a regular %s by the categories of the slot', (slot, now, matching) => {
      const context = buildContext({
        now: new Date(now),
        profile: collecting({ slots: slotsWithShare(slot, 0.5) }),
      });
      const habitByCategory = (rate: (category: MenuCategory) => number) =>
        Object.fromEntries(MENU_CATEGORIES.map((category) => [category, rate(category)]));
      expect(rankCandidates(context, [], { limit: 1 }).slot).toBe(slot);
      expect(
        habitByCategory((category) => factorOf(rankOne(withItem({ category }), context), 'habit')),
      ).toEqual(habitByCategory((category) => (matching.includes(category) ? 1 : 0)));
    });

    it('measures the sweet tooth hour around midnight', () => {
      const candidate = buildCandidate({
        item: buildMenuItem({ tags: ['sweet'] }),
        venue: buildVenue({ opensAt: '00:00:00', closesAt: '00:00:00' }),
      });
      const context = (typicalHour: number) =>
        buildContext({
          now: new Date('2026-09-26T22:00:00Z'),
          profile: collecting({ sweetTooth: { share: 1, typicalHour } }),
        });
      expect(factorOf(rankOne(candidate, context(23)), 'habit')).toBe(1);
      expect(factorOf(rankOne(candidate, context(22)), 'habit')).toBe(0);
    });

    const lowProteinDay: DayTotals = { ...EMPTY_TOTALS, meals: 2, kcal: 1000, proteinG: 30 };

    it.each<[string, DayTotals, Partial<MenuItem>, number]>([
      ['a high protein tag', lowProteinDay, { tags: ['high_protein'] }, 1],
      ['protein rich macros', lowProteinDay, { kcal: 300, proteinG: 20 }, 1],
      ['modest protein', lowProteinDay, { kcal: 300, proteinG: 10 }, 0],
      ['unknown protein', lowProteinDay, { kcal: 300, proteinG: null }, 0],
      ['a dish without calories', lowProteinDay, { kcal: 0, proteinG: 5 }, 0],
      ['a single meal today', { ...lowProteinDay, meals: 1 }, { tags: ['high_protein'] }, 0],
      ['a day without calories', { ...lowProteinDay, kcal: 0, proteinG: 0 }, { tags: ['high_protein'] }, 0],
      ['enough protein today', { ...lowProteinDay, proteinG: 37.5 }, { tags: ['high_protein'] }, 0],
    ])('rates macros for %s', (_label, today, item, macros) => {
      expect(factorOf(rankOne(withItem(item), buildContext({ today })), 'macros')).toBe(macros);
    });

    it.each<[string, number | null, number | undefined, number]>([
      ['an unknown distance', null, undefined, 0.5],
      ['the same spot', 0, undefined, 1],
      ['1 km', 1000, undefined, 0.8],
      ['the default limit', 5000, undefined, 0],
      ['half of a custom limit', 1000, 2000, 0.5],
    ])('rates proximity for %s', (_label, meters, maxDistanceM, proximity) => {
      const candidate = buildCandidate({ venue: atDistance(meters ?? 0) });
      const context = buildContext({ user: meters === null ? {} : locatedUser });
      const options = maxDistanceM === undefined ? {} : { maxDistanceM };
      expect(factorOf(rankOne(candidate, context, options), 'proximity')).toBe(proximity);
    });

    it.each<[string, Partial<MenuItem>, Partial<Deal> | null, number]>([
      ['no deal', {}, null, 0],
      [
        'a 41% discount far from the end',
        { priceRub: 290 },
        { priceRub: 170, endsAt: minutesFromNow(180) },
        0.58,
      ],
      ['a deep discount ending in an hour', {}, { priceRub: 100, endsAt: minutesFromNow(60) }, 0.85],
      ['a half price deal ending in 96 minutes', {}, { priceRub: 150, endsAt: minutesFromNow(96) }, 0.76],
      ['a half price deal ending in two hours', {}, { priceRub: 150, endsAt: minutesFromNow(120) }, 0.7],
      ['a half price deal ending later', {}, { priceRub: 150, endsAt: minutesFromNow(121) }, 0.7],
      ['a free dish ending in an hour', { priceRub: 0 }, { priceRub: 0, endsAt: minutesFromNow(60) }, 0.15],
      ['a deal above the menu price', {}, { priceRub: 350 }, 0],
    ])('rates %s', (_label, item, deal, value) => {
      const candidate = buildCandidate({
        item: buildMenuItem(item),
        deal: deal === null ? null : buildDeal(deal),
      });
      expect(factorOf(rankOne(candidate), 'deal')).toBe(value);
    });

    it('treats a dessert category as a dessert for the habit and the headline', () => {
      const recommendation = rankOne(
        withItem({ category: 'dessert', tags: [] }),
        buildContext({ profile: collecting({ sweetTooth: { share: 0.5, typicalHour: 16 } }) }),
      );
      expect(factorOf(recommendation, 'habit')).toBe(1);
      expect(recommendation.explanation.headline).toBe('Можно позволить десерт');
    });

    it('rates the deal and states the discount from the same prices', () => {
      const recommendation = rankOne(
        buildCandidate({
          item: buildMenuItem({ priceRub: 290 }),
          deal: buildDeal({ priceRub: 170, endsAt: minutesFromNow(180) }),
        }),
      );
      expect(factorOf(recommendation, 'deal')).toBe(0.58);
      expect(recommendation.explanation.calculations).toContain('Скидка 41%: 170 ₽ вместо 290 ₽, до 19:00');
    });

    it('penalises a dish already offered today', () => {
      const fresh = rankOne(buildCandidate());
      const repeated = rankOne(buildCandidate(), buildContext({ offeredTodayItemIds: new Set([10]) }));
      expect(factorOf(fresh, 'novelty')).toBe(0);
      expect(factorOf(repeated, 'novelty')).toBe(-1);
      expect(repeated.score).toBeCloseTo(fresh.score - 0.2, 10);
    });

    it('lists factors in the documented order with their weights', () => {
      const { factors } = rankOne(buildCandidate());
      expect(factors.map(({ factor }) => factor)).toEqual([...INTENT_FACTORS]);
      expect(factors.every(({ factor, weight }) => weight === INTENT_WEIGHTS[factor])).toBe(true);
    });
  });

  describe('order', () => {
    const inVenue = (venueId: number, item: Partial<MenuItem>, venue: Partial<Venue> = {}) =>
      buildCandidate({
        item: buildMenuItem({ venueId, ...item }),
        venue: buildVenue({ id: venueId, ...venue }),
      });

    it('ranks by score first', () => {
      const result = rankCandidates(
        buildContext(),
        [inVenue(1, { id: 1, kcal: 300 }), inVenue(2, { id: 2 })],
        {
          limit: 2,
        },
      );
      expect(itemIds(okItems(result))).toEqual([2, 1]);
    });

    it('puts deals first on equal score', () => {
      const plain = inVenue(1, { id: 1 });
      const deal = buildCandidate({
        item: buildMenuItem({ id: 2, venueId: 2 }),
        venue: buildVenue({ id: 2 }),
        deal: buildDeal({ venueId: 2, menuItemId: 2, priceRub: 300 }),
      });
      const items = okItems(rankCandidates(buildContext(), [plain, deal], { limit: 2 }));
      expect(items.map(({ score }) => score)).toEqual([0.5, 0.5]);
      expect(itemIds(items)).toEqual([2, 1]);
    });

    it('puts the closer venue first on equal score', () => {
      const far = inVenue(1, { id: 1, kcal: 200 }, { location: metersNorth(2000) });
      const near = inVenue(2, { id: 2, kcal: 220 }, { location: metersNorth(1000) });
      const items = okItems(rankCandidates(buildContext({ user: locatedUser }), [far, near], { limit: 2 }));
      expect(items.map(({ score }) => score)).toEqual([0.515, 0.515]);
      expect(itemIds(items)).toEqual([2, 1]);
    });

    it('falls back to the dish id', () => {
      const items = okItems(
        rankCandidates(buildContext(), [inVenue(1, { id: 7 }), inVenue(2, { id: 3 })], { limit: 2 }),
      );
      expect(itemIds(items)).toEqual([3, 7]);
    });

    describe('diversity', () => {
      const candidates = [
        inVenue(1, { id: 1, kcal: 200 }),
        inVenue(1, { id: 2, kcal: 210 }),
        inVenue(1, { id: 3, kcal: 220 }),
        inVenue(2, { id: 4, kcal: 240 }),
      ];

      it.each([
        [1, [1]],
        [2, [1, 4]],
        [3, [1, 4, 2]],
        [10, [1, 4, 2, 3]],
      ])('takes the best dish of each venue first with limit %i', (limit, expected) => {
        expect(itemIds(okItems(rankCandidates(buildContext(), candidates, { limit })))).toEqual(expected);
      });
    });
  });

  describe('options', () => {
    it.each([0, -1, 1.5, Number.NaN])('rejects limit %d', (limit) => {
      expect(() => rankCandidates(buildContext(), [], { limit })).toThrow(RangeError);
    });

    it.each([0, -5, Number.POSITIVE_INFINITY, Number.NaN])('rejects maxDistanceM %d', (maxDistanceM) => {
      expect(() => rankCandidates(buildContext(), [], { limit: 1, maxDistanceM })).toThrow(RangeError);
    });

    it('validates options before checking the budget', () => {
      const full = buildContext({ today: { ...EMPTY_TOTALS, meals: 4, kcal: 2500 } });
      expect(() => rankCandidates(full, [], { limit: 0 })).toThrow('limit must be an integer of at least 1');
    });
  });
});

describe('from diary to recommendation', () => {
  it('offers the afternoon dessert to a guest with a sweet tooth', () => {
    const today = [
      buildMeal('2026-09-26T09:00:00+03:00', { kcalMin: 300, kcalMax: 400, tags: ['coffee', 'pastry'] }),
      buildMeal('2026-09-26T13:00:00+03:00', { kcalMin: 600, kcalMax: 600, tags: ['soup', 'meat'] }),
      buildMeal('2026-09-26T15:00:00+03:00', { kcalMin: 400, kcalMax: 400, tags: ['coffee'] }),
    ];
    const diary = [
      buildMeal('2026-09-24T13:00:00+03:00', { kcalMin: 500, kcalMax: 500, tags: ['soup'] }),
      buildMeal('2026-09-24T16:00:00+03:00', { tags: ['sweet', 'dessert'] }),
      buildMeal('2026-09-25T13:00:00+03:00', { kcalMin: 500, kcalMax: 500, tags: ['soup'] }),
      buildMeal('2026-09-25T16:30:00+03:00', { tags: ['sweet', 'dessert', 'coffee'] }),
      ...today,
    ];
    const context = buildContext({
      user: locatedUser,
      today: dayTotals(today),
      profile: buildBehaviorProfile(diary, { now: NOW, timeZone: 'Europe/Moscow' }),
    });
    const cheesecake = buildCandidate({
      item: buildMenuItem({
        id: 21,
        name: 'Чизкейк',
        category: 'dessert',
        kcal: 320,
        priceRub: 290,
        tags: ['sweet', 'dessert', 'dairy'],
      }),
      venue: buildVenue({ location: metersNorth(430) }),
      deal: buildDeal({ menuItemId: 21, priceRub: 170, endsAt: new Date('2026-09-26T15:30:00Z') }),
    });
    const borscht = buildCandidate({
      item: buildMenuItem({ id: 31, venueId: 2, name: 'Борщ', category: 'soup', kcal: 350, tags: ['soup'] }),
      venue: buildVenue({ id: 2, name: 'Столовая', location: metersNorth(300) }),
    });

    const [first, second] = okItems(rankCandidates(context, [borscht, cheesecake], { limit: 2 }));

    expect(context.profile.readiness).toBe('ready');
    expect(first!.candidate).toBe(cheesecake);
    expect(second!.candidate).toBe(borscht);
    expect(factorOf(first!, 'habit')).toBe(1);
    expect(first!.explanation.headline).toBe('Можно позволить десерт');
    expect(first!.explanation.facts[0]).toBe('Сегодня записано 3 приёма пищи, примерно 1350 ккал');
    expect(first!.explanation.calculations).toEqual([
      'До ориентира 2000 ккал остаётся около 650 ккал',
      'Идти около 450 м',
      'Скидка 41%: 170 ₽ вместо 290 ₽, до 18:30',
      'Осталось 3 шт.',
    ]);
  });
});
