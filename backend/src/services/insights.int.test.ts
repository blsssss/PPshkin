import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedUser } from '../../test/venues.ts';
import type { Tag } from '../domain/vocabulary.ts';
import * as meals from '../repositories/meals.ts';
import * as users from '../repositories/users.ts';
import { forbidden } from '../shared/errors.ts';
import { createInsightsService } from './insights.ts';

const pool = testPool();
const clock = fixedClock('2026-09-26T13:00:00Z');
const insights = createInsightsService({
  pool,
  clock,
  consents: { requirePersonalData: () => Promise.resolve() },
});
const GUEST = 101;

async function logMeal(
  eatenAt: string,
  title: string,
  kcal: number,
  tags: Tag[],
  proteinG: number | null = null,
) {
  await meals.insert(pool, {
    userId: GUEST,
    title,
    kcalMin: kcal - 50,
    kcalMax: kcal + 50,
    proteinG,
    fatG: null,
    carbsG: null,
    tags,
    source: 'photo',
    confidence: 0.8,
    eatenAt: new Date(eatenAt),
  });
}

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-26T13:00:00Z');
  await seedUser(pool, GUEST);
});

afterAll(async () => {
  await closeTestPool();
});

describe('insights', () => {
  it('starts with an empty profile and a full budget for today', async () => {
    await logMeal('2026-09-11T12:00:00Z', 'Старый обед', 700, ['soup']);
    expect(await insights.get(GUEST)).toEqual({
      profile: expect.objectContaining({
        readiness: 'empty',
        mealsCount: 0,
        mealsUntilReady: 5,
        daysTracked: 0,
        averageDailyKcal: null,
        topTags: [],
      }) as unknown,
      today: {
        date: '2026-09-26',
        slot: 'snack',
        targetKcal: 2000,
        totals: { meals: 0, kcalMin: 0, kcalMax: 0, kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
        remainingKcal: 2000,
      },
    });
  });

  it('builds habits from the last 14 days in the time zone of the guest', async () => {
    await users.updateProfile(pool, GUEST, { timezone: 'Asia/Yekaterinburg', kcalTarget: 1800 });
    await logMeal('2026-09-12T12:00:00Z', 'Старый обед', 700, ['soup']);
    await logMeal('2026-09-24T03:00:00Z', 'Омлет', 400, ['eggs', 'breakfast'], 25);
    await logMeal('2026-09-24T11:00:00Z', 'Эклер', 300, ['dessert', 'sweet']);
    await logMeal('2026-09-25T07:00:00Z', 'Борщ', 500, ['soup', 'meat'], 20);
    await logMeal('2026-09-25T11:30:00Z', 'Чизкейк', 350, ['dessert', 'sweet']);
    await logMeal('2026-09-25T19:30:00Z', 'Бутерброд', 250, ['bread']);
    await logMeal('2026-09-26T05:00:00Z', 'Сырники', 450, ['breakfast', 'dairy'], 22);

    const { profile, today } = await insights.get(GUEST);
    expect(profile).toMatchObject({
      readiness: 'ready',
      mealsCount: 6,
      mealsUntilReady: 0,
      daysTracked: 3,
      averageDailyKcal: 750,
      topTags: ['breakfast', 'sweet', 'dessert'],
      slots: {
        breakfast: { share: 0.67, averageKcal: 425, typicalHour: 8 },
        lunch: { share: 0.33, averageKcal: 500, typicalHour: 12 },
        snack: { share: 1, averageKcal: 300, typicalHour: 16 },
        dinner: { share: 0, averageKcal: null, typicalHour: null },
      },
      sweetTooth: { share: 0.67, typicalHour: 16 },
      proteinShare: 0.2,
    });
    expect(today).toEqual({
      date: '2026-09-26',
      slot: 'dinner',
      targetKcal: 1800,
      totals: { meals: 2, kcalMin: 600, kcalMax: 800, kcal: 700, proteinG: 22, fatG: 0, carbsG: 0 },
      remainingKcal: 1100,
    });
  });

  it('refuses to build insights without consent to personal data processing', async () => {
    const guarded = createInsightsService({
      pool,
      clock,
      consents: {
        requirePersonalData: () =>
          Promise.reject(forbidden('consent_required', 'Consent to personal data processing is required')),
      },
    });
    await expect(guarded.get(GUEST)).rejects.toMatchObject({ status: 403, code: 'consent_required' });
  });

  it('reports a deleted account', async () => {
    await expect(insights.get(404)).rejects.toMatchObject({ status: 404, code: 'user_not_found' });
  });
});

describe('target estimate', () => {
  it('follows the guideline example and adjusts for the goal', () => {
    expect(
      insights.estimateTarget({
        sex: 'female',
        ageYears: 30,
        heightCm: 165,
        weightKg: 60,
        activity: 'light',
        goal: 'maintain',
      }),
    ).toEqual({ kcalTarget: 1800, bmrKcal: 1320, maintenanceKcal: 1815 });
    expect(
      insights.estimateTarget({
        sex: 'male',
        ageYears: 40,
        heightCm: 180,
        weightKg: 90,
        activity: 'moderate',
        goal: 'lose',
      }),
    ).toEqual({ kcalTarget: 2400, bmrKcal: 1830, maintenanceKcal: 2837 });
  });

  it('rejects body parameters out of range as a validation error', () => {
    expect(() =>
      insights.estimateTarget({
        sex: 'female',
        ageYears: 13,
        heightCm: 165,
        weightKg: 60,
        activity: 'light',
        goal: 'maintain',
      }),
    ).toThrow(
      expect.objectContaining({
        status: 400,
        code: 'validation_failed',
        details: [{ path: '', message: 'ageYears must be between 14 and 100' }],
      }) as Error,
    );
  });
});
