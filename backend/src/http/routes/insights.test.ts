import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp } from '../../../test/services.ts';
import type { BehaviorProfile } from '../../domain/nutrition/profile.ts';
import { estimateTarget, type BodyParameters } from '../../domain/nutrition/targets.ts';
import type { Insights, InsightsService } from '../../services/insights.ts';
import { notFound } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const guest = bearer('guest-token');
const INSIGHTS = '/api/v1/insights';
const ESTIMATE = '/api/v1/me/target/estimate';

const profile: BehaviorProfile = {
  mealsCount: 6,
  daysTracked: 3,
  readiness: 'ready',
  mealsUntilReady: 0,
  averageDailyKcal: 1750,
  tagAffinity: { sweet: 0.4, dessert: 0.4, soup: 0.2 },
  topTags: ['sweet', 'dessert', 'soup'],
  slots: {
    breakfast: { share: 0.67, averageKcal: 425, typicalHour: 8 },
    lunch: { share: 0.33, averageKcal: 500, typicalHour: 13 },
    snack: { share: 1, averageKcal: 300, typicalHour: 16 },
    dinner: { share: 0, averageKcal: null, typicalHour: null },
  },
  sweetTooth: { share: 0.67, typicalHour: 16 },
  proteinShare: 0.2,
};

const insightsResult: Insights = {
  profile,
  today: {
    date: '2026-09-26',
    slot: 'snack',
    targetKcal: 2000,
    totals: { meals: 2, kcalMin: 800, kcalMax: 1000, kcal: 900, proteinG: 41.5, fatG: 30.2, carbsG: 95 },
    remainingKcal: 1100,
  },
};

const guideline: BodyParameters = {
  sex: 'female',
  ageYears: 30,
  heightCm: 165,
  weightKg: 60,
  activity: 'light',
  goal: 'maintain',
};

function insightsStub(overrides: Partial<InsightsService> = {}): InsightsService {
  return {
    get: () => Promise.resolve(insightsResult),
    estimateTarget,
    ...overrides,
  };
}

describe('insights routes', () => {
  it('require authentication', async () => {
    app = await buildTestApp({ services: { insights: insightsStub() } });
    const insights = await app.inject({ method: 'GET', url: INSIGHTS });
    expect(insights.statusCode).toBe(401);
    expectContract(insights, 'GET', INSIGHTS);

    const estimate = await app.inject({ method: 'POST', url: ESTIMATE, payload: guideline });
    expect(estimate.statusCode).toBe(401);
    expectContract(estimate, 'POST', ESTIMATE);
  });

  it('shows the eating profile with Russian labels and the summary of today', async () => {
    const get = vi.fn<InsightsService['get']>(() => Promise.resolve(insightsResult));
    app = await buildTestApp({ services: { insights: insightsStub({ get }) } });
    const response = await app.inject({ method: 'GET', url: INSIGHTS, headers: guest });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', INSIGHTS);
    expect(response.json()).toEqual({
      readiness: 'ready',
      mealsCount: 6,
      mealsUntilReady: 0,
      daysTracked: 3,
      averageDailyKcal: 1750,
      topTags: [
        { tag: 'sweet', label: 'сладкое' },
        { tag: 'dessert', label: 'десерт' },
        { tag: 'soup', label: 'суп' },
      ],
      slots: [
        { slot: 'breakfast', label: 'завтрак', share: 0.67, averageKcal: 425, typicalHour: 8 },
        { slot: 'lunch', label: 'обед', share: 0.33, averageKcal: 500, typicalHour: 13 },
        { slot: 'snack', label: 'перекус', share: 1, averageKcal: 300, typicalHour: 16 },
        { slot: 'dinner', label: 'ужин', share: 0, averageKcal: null, typicalHour: null },
      ],
      sweetTooth: { share: 0.67, typicalHour: 16 },
      proteinShare: 0.2,
      today: {
        date: '2026-09-26',
        slot: 'snack',
        targetKcal: 2000,
        meals: 2,
        kcal: 900,
        remainingKcal: 1100,
        proteinG: 41.5,
        fatG: 30.2,
        carbsG: 95,
      },
    });
    expect(get).toHaveBeenCalledWith(101);
  });

  it('shows an empty profile of a new guest', async () => {
    const empty: Insights = {
      profile: {
        ...profile,
        mealsCount: 0,
        daysTracked: 0,
        readiness: 'empty',
        mealsUntilReady: 5,
        averageDailyKcal: null,
        tagAffinity: {},
        topTags: [],
        slots: {
          breakfast: profile.slots.dinner,
          lunch: profile.slots.dinner,
          snack: profile.slots.dinner,
          dinner: profile.slots.dinner,
        },
        sweetTooth: { share: 0, typicalHour: null },
        proteinShare: null,
      },
      today: {
        ...insightsResult.today,
        totals: { meals: 0, kcalMin: 0, kcalMax: 0, kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
        remainingKcal: 2000,
      },
    };
    app = await buildTestApp({ services: { insights: insightsStub({ get: () => Promise.resolve(empty) }) } });
    const response = await app.inject({ method: 'GET', url: INSIGHTS, headers: guest });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', INSIGHTS);
    expect(response.json()).toMatchObject({
      readiness: 'empty',
      mealsUntilReady: 5,
      averageDailyKcal: null,
      topTags: [],
      proteinShare: null,
      today: { meals: 0, kcal: 0, remainingKcal: 2000 },
    });
  });

  it('reports a deleted account', async () => {
    app = await buildTestApp({
      services: {
        insights: insightsStub({ get: () => Promise.reject(notFound('user_not_found', 'User not found')) }),
      },
    });
    const response = await app.inject({ method: 'GET', url: INSIGHTS, headers: guest });
    expect(response.statusCode).toBe(404);
    expectContract(response, 'GET', INSIGHTS);
    expect(response.json()).toMatchObject({ code: 'user_not_found' });
  });
});

describe('kcal target estimate', () => {
  it('estimates the guideline without saving it', async () => {
    const estimate = vi.fn<InsightsService['estimateTarget']>(estimateTarget);
    app = await buildTestApp({ services: { insights: insightsStub({ estimateTarget: estimate }) } });
    const response = await app.inject({ method: 'POST', url: ESTIMATE, headers: guest, payload: guideline });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'POST', ESTIMATE);
    expect(response.json()).toEqual({ kcalTarget: 1800, bmrKcal: 1320, maintenanceKcal: 1815 });
    expect(estimate).toHaveBeenCalledWith(guideline);

    const precise = await app.inject({
      method: 'POST',
      url: ESTIMATE,
      headers: guest,
      payload: { ...guideline, weightKg: 72.5, goal: 'gain' },
    });
    expect(precise.statusCode).toBe(200);
    expectContract(precise, 'POST', ESTIMATE);
  });

  it.each([
    { ageYears: 13 },
    { ageYears: 101 },
    { ageYears: 30.5 },
    { heightCm: 119 },
    { heightCm: 231 },
    { weightKg: 34.9 },
    { weightKg: 250.1 },
    { weightKg: 60.25 },
    { sex: 'other' },
    { activity: 'extreme' },
    { goal: 'bulk' },
    { weightKg: '60' },
  ])('rejects %o', async (change) => {
    const estimate = vi.fn<InsightsService['estimateTarget']>(estimateTarget);
    app = await buildTestApp({ services: { insights: insightsStub({ estimateTarget: estimate }) } });
    const response = await app.inject({
      method: 'POST',
      url: ESTIMATE,
      headers: guest,
      payload: { ...guideline, ...change },
    });
    expect(response.statusCode).toBe(400);
    expectContract(response, 'POST', ESTIMATE);
    expect(response.json()).toMatchObject({ code: 'validation_failed' });
    expect(estimate).not.toHaveBeenCalled();
  });

  it.each(Object.keys(guideline))('requires %s', async (field) => {
    app = await buildTestApp({ services: { insights: insightsStub() } });
    const response = await app.inject({
      method: 'POST',
      url: ESTIMATE,
      headers: guest,
      payload: { ...guideline, [field]: undefined },
    });
    expect(response.statusCode).toBe(400);
    expectContract(response, 'POST', ESTIMATE);
    expect(response.json()).toMatchObject({ code: 'validation_failed' });
  });
});
