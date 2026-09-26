import { describe, expect, it } from 'vitest';
import { buildMeal, NOW } from '../../../test/fixtures/domain.ts';
import type { Meal } from '../models.ts';
import type { Tag } from '../vocabulary.ts';
import type { SlotHabit } from './profile.ts';
import { buildBehaviorProfile, PROFILE_WINDOW_DAYS, READY_MIN_DAYS, READY_MIN_MEALS } from './profile.ts';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const kcal = (value: number): Partial<Meal> => ({ kcalMin: value, kcalMax: value });
const tagged = (...tags: Tag[]): Partial<Meal> => ({ tags });
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

function profileOf(meals: readonly Meal[], options: { timeZone?: string; windowDays?: number } = {}) {
  return buildBehaviorProfile(meals, { now: NOW, timeZone: 'Europe/Moscow', ...options });
}

const quiet: SlotHabit = { share: 0, averageKcal: null, typicalHour: null };

describe('buildBehaviorProfile', () => {
  it('uses the documented readiness thresholds and window', () => {
    expect([PROFILE_WINDOW_DAYS, READY_MIN_MEALS, READY_MIN_DAYS]).toEqual([14, 5, 2]);
  });

  it('returns an empty profile when there are no meals', () => {
    expect(profileOf([])).toEqual({
      mealsCount: 0,
      daysTracked: 0,
      readiness: 'empty',
      mealsUntilReady: 5,
      averageDailyKcal: null,
      tagAffinity: {},
      topTags: [],
      slots: { breakfast: quiet, lunch: quiet, snack: quiet, dinner: quiet },
      sweetTooth: { share: 0, typicalHour: null },
      proteinShare: null,
    });
  });

  it.each([
    ['1 meal', ['2026-09-26T09:00:00+03:00'], 'collecting', 4],
    [
      '4 meals over 2 days',
      [
        '2026-09-25T09:00:00+03:00',
        '2026-09-25T13:00:00+03:00',
        '2026-09-26T09:00:00+03:00',
        '2026-09-26T13:00:00+03:00',
      ],
      'collecting',
      1,
    ],
    [
      '5 meals in 1 day',
      [
        '2026-09-26T07:00:00+03:00',
        '2026-09-26T09:00:00+03:00',
        '2026-09-26T11:00:00+03:00',
        '2026-09-26T13:00:00+03:00',
        '2026-09-26T15:00:00+03:00',
      ],
      'collecting',
      0,
    ],
    [
      '5 meals over 2 days',
      [
        '2026-09-25T09:00:00+03:00',
        '2026-09-25T13:00:00+03:00',
        '2026-09-25T19:00:00+03:00',
        '2026-09-26T09:00:00+03:00',
        '2026-09-26T13:00:00+03:00',
      ],
      'ready',
      0,
    ],
  ])('is %s -> %s', (_label, times, readiness, mealsUntilReady) => {
    const profile = profileOf(times.map((time) => buildMeal(time)));
    expect(profile.mealsCount).toBe(times.length);
    expect(profile.readiness).toBe(readiness);
    expect(profile.mealsUntilReady).toBe(mealsUntilReady);
  });

  it('counts meals in the half-open window ending now', () => {
    const profile = profileOf([
      buildMeal(daysAgo(PROFILE_WINDOW_DAYS)),
      buildMeal(new Date(daysAgo(PROFILE_WINDOW_DAYS).getTime() + 1)),
      buildMeal(NOW),
      buildMeal(new Date(NOW.getTime() + 60_000)),
    ]);
    expect(profile.mealsCount).toBe(2);
    expect(profile.daysTracked).toBe(2);
  });

  it('accepts a custom window length', () => {
    const meals = [buildMeal(daysAgo(6)), buildMeal(daysAgo(8))];
    expect(profileOf(meals, { windowDays: 7 }).mealsCount).toBe(1);
    expect(profileOf(meals).mealsCount).toBe(2);
  });

  it.each([0, -1, Number.NaN])('rejects a window of %d days', (windowDays) => {
    expect(() => profileOf([], { windowDays })).toThrow(RangeError);
  });

  it('weighs recent meals more when computing tag affinity', () => {
    const profile = profileOf([
      buildMeal(NOW, tagged('sweet', 'dessert')),
      buildMeal(daysAgo(7), tagged('soup')),
    ]);
    expect(profile.tagAffinity).toEqual({ sweet: 0.67, dessert: 0.67, soup: 0.33 });
    expect(profile.topTags).toEqual(['sweet', 'dessert', 'soup']);
  });

  it('counts a tag once per meal', () => {
    expect(profileOf([buildMeal(NOW, tagged('soup', 'soup')), buildMeal(NOW)]).tagAffinity).toEqual({
      soup: 0.5,
    });
  });

  it('keeps at most five top tags above the threshold and breaks ties by tag order', () => {
    const profile = profileOf(
      [
        tagged('tea', 'coffee'),
        tagged('tea', 'coffee'),
        tagged('soup', 'coffee'),
        tagged('soup', 'coffee'),
        tagged('fish', 'coffee'),
        tagged('fish', 'coffee'),
        tagged('meat', 'rice'),
        tagged('meat'),
        tagged('sweet'),
        tagged('sweet'),
      ].map((overrides) => buildMeal(NOW, overrides)),
    );
    expect(profile.tagAffinity).toEqual({
      coffee: 0.6,
      tea: 0.2,
      soup: 0.2,
      fish: 0.2,
      meat: 0.2,
      sweet: 0.2,
      rice: 0.1,
    });
    expect(profile.topTags).toEqual(['coffee', 'sweet', 'meat', 'fish', 'soup']);
  });

  it('applies the top tag threshold to the rounded affinity', () => {
    const profile = profileOf([
      ...Array.from({ length: 4 }, () => buildMeal(NOW)),
      buildMeal(new Date(NOW.getTime() - HOUR_MS), tagged('soup')),
    ]);
    expect(profile.tagAffinity).toEqual({ soup: 0.2 });
    expect(profile.topTags).toEqual(['soup']);
  });

  it('orders top tags with equal rounded affinity by tag order', () => {
    const profile = profileOf([
      buildMeal(new Date(NOW.getTime() - HOUR_MS), tagged('coffee')),
      buildMeal(NOW, tagged('tea')),
      ...Array.from({ length: 3 }, () => buildMeal(NOW)),
    ]);
    expect(profile.tagAffinity).toEqual({ coffee: 0.2, tea: 0.2 });
    expect(profile.topTags).toEqual(['coffee', 'tea']);
  });

  it('averages daily calories over days with at least two meals', () => {
    const profile = profileOf([
      buildMeal('2026-09-24T09:00:00+03:00', kcal(400)),
      buildMeal('2026-09-24T14:00:00+03:00', kcal(600)),
      buildMeal('2026-09-25T09:00:00+03:00', kcal(500)),
      buildMeal('2026-09-25T14:00:00+03:00', kcal(500)),
      buildMeal('2026-09-25T19:00:00+03:00', kcal(500)),
      buildMeal('2026-09-26T09:00:00+03:00', kcal(2000)),
    ]);
    expect(profile.averageDailyKcal).toBe(1250);
  });

  it('rounds the daily average and leaves it empty without full days', () => {
    const rounded = profileOf([
      buildMeal('2026-09-24T09:00:00+03:00', kcal(500)),
      buildMeal('2026-09-24T14:00:00+03:00', kcal(501)),
      buildMeal('2026-09-25T09:00:00+03:00', kcal(501)),
      buildMeal('2026-09-25T14:00:00+03:00', kcal(501)),
    ]);
    expect(rounded.averageDailyKcal).toBe(1002);
    const sparse = profileOf([
      buildMeal('2026-09-24T09:00:00+03:00'),
      buildMeal('2026-09-25T09:00:00+03:00'),
    ]);
    expect(sparse.averageDailyKcal).toBeNull();
  });

  it('describes meal slot habits', () => {
    const profile = profileOf([
      buildMeal('2026-09-24T08:00:00+03:00', kcal(300)),
      buildMeal('2026-09-24T23:30:00+03:00', kcal(200)),
      buildMeal('2026-09-25T09:00:00+03:00', kcal(350)),
      buildMeal('2026-09-25T07:00:00+03:00', kcal(400)),
      buildMeal('2026-09-25T16:30:00+03:00', kcal(301)),
      buildMeal('2026-09-26T13:00:00+03:00', kcal(700)),
    ]);
    expect(profile.daysTracked).toBe(3);
    expect(profile.slots).toEqual({
      breakfast: { share: 0.67, averageKcal: 350, typicalHour: 8 },
      lunch: { share: 0.33, averageKcal: 700, typicalHour: 13 },
      snack: { share: 0.67, averageKcal: 251, typicalHour: 16 },
      dinner: quiet,
    });
  });

  it('takes the lower middle hour as the median of an even count', () => {
    const profile = profileOf(
      ['12:10', '15:10', '13:10', '14:10'].map((time) => buildMeal(`2026-09-25T${time}:00+03:00`)),
    );
    expect(profile.slots.lunch.typicalHour).toBe(13);
  });

  it('detects a sweet tooth by days with sweet meals', () => {
    const profile = profileOf([
      buildMeal('2026-09-24T16:00:00+03:00', tagged('sweet', 'dessert')),
      buildMeal('2026-09-24T19:00:00+03:00', tagged('meat')),
      buildMeal('2026-09-25T17:00:00+03:00', tagged('dessert')),
      buildMeal('2026-09-26T09:00:00+03:00', tagged('coffee')),
    ]);
    expect(profile.sweetTooth).toEqual({ share: 0.67, typicalHour: 16 });
  });

  it('computes the protein share of calories over meals with known protein', () => {
    const profile = profileOf([
      buildMeal(daysAgo(1), { ...kcal(400), proteinG: 30 }),
      buildMeal(daysAgo(1), { ...kcal(600), proteinG: 20 }),
      buildMeal(daysAgo(1), kcal(1000)),
    ]);
    expect(profile.proteinShare).toBe(0.2);
  });

  it('caps the protein share at 1 when protein outweighs the estimated calories', () => {
    expect(profileOf([buildMeal(daysAgo(1), { ...kcal(100), proteinG: 50 })]).proteinShare).toBe(1);
    expect(profileOf([buildMeal(daysAgo(1), { ...kcal(100), proteinG: 27 })]).proteinShare).toBe(1);
  });

  it('leaves the protein share empty without protein data or calories', () => {
    expect(profileOf([buildMeal(daysAgo(1))]).proteinShare).toBeNull();
    expect(profileOf([buildMeal(daysAgo(1), { ...kcal(0), proteinG: 0 })]).proteinShare).toBeNull();
  });

  it('uses the time zone of the user for local dates and slots', () => {
    const meals = [buildMeal('2026-09-25T22:30:00Z'), buildMeal('2026-09-26T10:00:00Z')];
    const moscow = profileOf(meals);
    expect(moscow.daysTracked).toBe(1);
    expect(moscow.averageDailyKcal).toBe(800);
    expect(moscow.slots.snack.typicalHour).toBe(1);
    expect(moscow.slots.lunch.typicalHour).toBe(13);
    const utc = profileOf(meals, { timeZone: 'UTC' });
    expect(utc.daysTracked).toBe(2);
    expect(utc.averageDailyKcal).toBeNull();
    expect(utc.slots.dinner.typicalHour).toBe(22);
    expect(utc.slots.breakfast.typicalHour).toBe(10);
  });
});
