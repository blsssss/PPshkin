import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { expectContract } from '../../test/contract.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { testConfig } from '../../test/services.ts';
import { DEMO_ACCOUNTS } from '../auth/demo.ts';
import { createServices } from '../container.ts';
import { createRecognition } from '../recognition/index.ts';
import * as users from '../repositories/users.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { buildApp } from './app.ts';

const GUEST_TOKEN = 'demo-guest-token-recommendations-0123';
const VENUE_TOKEN = 'demo-venue-token-recommendations-0123';
const guest = { authorization: `Bearer ${GUEST_TOKEN}` };
const owner = { authorization: `Bearer ${VENUE_TOKEN}` };
const clock = fixedClock('2026-09-26T13:00:00Z');
const pool = testPool();
const NEARBY = '/api/v1/recommendations?lat=55.7887&lon=49.1221';
let app: FastifyInstance;

interface RecommendationsBody {
  status: string;
  items: {
    offerId: number;
    headline: string;
    facts: string[];
    calculations: string[];
    assumptions: string[];
    item: { id: number; name: string };
    deal: { id: number } | null;
  }[];
}

beforeAll(async () => {
  const config = testConfig({
    DEMO_MODE: 'true',
    DEMO_GUEST_TOKEN: GUEST_TOKEN,
    DEMO_VENUE_TOKEN: VENUE_TOKEN,
  });
  const services = createServices({
    config,
    pool,
    clock,
    recognition: createRecognition({
      apiKey: undefined,
      baseUrl: config.CHADGPT_BASE_URL,
      visionModel: config.CHADGPT_MODEL,
      fallbackModel: config.CHADGPT_FALLBACK_MODEL,
      timeoutMs: config.CHADGPT_TIMEOUT_MS,
      menuTimeoutMs: config.CHADGPT_MENU_TIMEOUT_MS,
    }),
    background: createBackgroundTasks({ error: () => undefined }),
  });
  app = await buildApp({ config, services });
  await app.ready();
});

beforeEach(async () => {
  await resetDatabase(pool);
  for (const account of Object.values(DEMO_ACCOUNTS)) {
    await users.upsert(pool, { id: account.userId, firstName: account.firstName, username: null });
  }
});

afterAll(async () => {
  await app.close();
  await closeTestPool();
});

async function send(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  path: string,
  headers: Record<string, string>,
  payload?: object,
) {
  const response = await app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  expectContract(response, method, path);
  return response;
}

async function addMenuItem(fields: object): Promise<number> {
  const response = await send('POST', '/api/v1/venue/menu/items', '/api/v1/venue/menu/items', owner, fields);
  expect(response.statusCode).toBe(201);
  return response.json<{ id: number }>().id;
}

describe('recommendations flow against the database', () => {
  it('turns a diary and hot deals into explained offers the guest can decline', async () => {
    const venue = await send('POST', '/api/v1/venue', '/api/v1/venue', owner, {
      name: 'Кофейня «Зерно»',
      address: 'ул. Баумана, 36',
      category: 'coffee',
      location: { lat: 55.7887, lon: 49.1221 },
      opensAt: '08:00',
      closesAt: '22:00',
    });
    expect(venue.statusCode).toBe(201);
    const cheesecake = await addMenuItem({
      name: 'Чизкейк',
      category: 'dessert',
      priceRub: 250,
      kcal: 320,
      tags: ['dessert', 'sweet'],
    });
    await addMenuItem({ name: 'Капучино', category: 'drink', priceRub: 180, kcal: 120, tags: ['coffee'] });
    await addMenuItem({ name: 'Борщ', category: 'soup', priceRub: 290, kcal: 350, tags: ['soup', 'meat'] });
    await addMenuItem({ name: 'Сырники', category: 'breakfast', priceRub: 320, kcal: 450, tags: ['dairy'] });
    const deal = await send('POST', '/api/v1/venue/deals', '/api/v1/venue/deals', owner, {
      menuItemId: cheesecake,
      priceRub: 160,
      quantity: 5,
      endsAt: '2026-09-26T16:00:00Z',
    });
    expect(deal.statusCode).toBe(201);

    const denied = await send('GET', NEARBY, '/api/v1/recommendations', guest);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'consent_required' });

    const consent = await send('PUT', '/api/v1/consents/personal_data', '/api/v1/consents/{kind}', guest, {
      version: '2026-09-25',
    });
    expect(consent.statusCode).toBe(200);

    const empty = await send('GET', NEARBY, '/api/v1/recommendations', guest);
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      status: 'profile_empty',
      slot: 'snack',
      remainingKcal: 2000,
      slotBudgetKcal: 200,
      items: [],
    });
    for (const meal of [
      { title: 'Эклер', kcal: 300, tags: ['dessert', 'sweet'], eatenAt: '2026-09-25T13:00:00Z' },
      { title: 'Омлет', kcal: 400, tags: ['eggs', 'breakfast'], eatenAt: '2026-09-26T06:00:00Z' },
      { title: 'Суп', kcal: 350, tags: ['soup'], eatenAt: '2026-09-26T10:00:00Z' },
    ]) {
      const logged = await send('POST', '/api/v1/diary/meals', '/api/v1/diary/meals', guest, meal);
      expect(logged.statusCode).toBe(201);
    }

    const offered = await send('GET', NEARBY, '/api/v1/recommendations', guest);
    expect(offered.statusCode).toBe(200);
    const body = offered.json<RecommendationsBody>();
    expect(body.status).toBe('ok');
    expect(body.items.map((item) => item.item.name).toSorted()).toEqual([
      'Борщ',
      'Капучино',
      'Сырники',
      'Чизкейк',
    ]);
    const dessert = body.items.find((item) => item.item.id === cheesecake);
    expect(dessert).toMatchObject({
      headline: 'Можно позволить десерт',
      facts: [
        'Сегодня записано 2 приёма пищи, примерно 750 ккал',
        '«Чизкейк» в «Кофейня «Зерно»»: 320 ккал по данным заведения',
      ],
      calculations: [
        'До ориентира 2000 ккал остаётся около 1250 ккал',
        'Идти около 50 м',
        'Скидка 36%: 160 ₽ вместо 250 ₽, до 19:00',
        'Осталось 5 шт.',
      ],
      assumptions: [
        'Калорийность приблизительная, это не медицинская рекомендация',
        'Профиль вкусов ещё собирается',
      ],
      deal: { id: deal.json<{ id: number }>().id },
    });

    const foreign = await send(
      'POST',
      `/api/v1/offers/${dessert!.offerId}/decline`,
      '/api/v1/offers/{id}/decline',
      owner,
      { reason: 'dislike' },
    );
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ code: 'offer_not_found' });

    const declined = await send(
      'POST',
      `/api/v1/offers/${dessert!.offerId}/decline`,
      '/api/v1/offers/{id}/decline',
      guest,
      { reason: 'not_today' },
    );
    expect(declined.statusCode).toBe(204);

    const next = await send('GET', NEARBY, '/api/v1/recommendations', guest);
    expect(
      next
        .json<RecommendationsBody>()
        .items.map((item) => item.item.name)
        .toSorted(),
    ).toEqual(['Борщ', 'Капучино', 'Сырники']);

    const insights = await send('GET', '/api/v1/insights', '/api/v1/insights', guest);
    expect(insights.statusCode).toBe(200);
    expect(insights.json()).toMatchObject({
      readiness: 'collecting',
      mealsCount: 3,
      mealsUntilReady: 2,
      daysTracked: 2,
      today: { date: '2026-09-26', slot: 'snack', meals: 2, kcal: 750, remainingKcal: 1250 },
    });

    const estimate = await send('POST', '/api/v1/me/target/estimate', '/api/v1/me/target/estimate', guest, {
      sex: 'female',
      ageYears: 30,
      heightCm: 165,
      weightKg: 60,
      activity: 'light',
      goal: 'maintain',
    });
    expect(estimate.statusCode).toBe(200);
    expect(estimate.json()).toEqual({ kcalTarget: 1800, bmrKcal: 1320, maintenanceKcal: 1815 });
  });

  it('serves insights when a diary entry has more protein than calories', async () => {
    const consent = await send('PUT', '/api/v1/consents/personal_data', '/api/v1/consents/{kind}', guest, {
      version: '2026-09-25',
    });
    expect(consent.statusCode).toBe(200);
    const logged = await send('POST', '/api/v1/diary/meals', '/api/v1/diary/meals', guest, {
      title: 'Протеиновый коктейль',
      kcal: 100,
      proteinG: 50,
      eatenAt: '2026-09-26T10:00:00Z',
    });
    expect(logged.statusCode).toBe(201);

    const insights = await send('GET', '/api/v1/insights', '/api/v1/insights', guest);
    expect(insights.statusCode).toBe(200);
    expect(insights.json()).toMatchObject({ mealsCount: 1, proteinShare: 1 });
  });
});
