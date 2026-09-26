import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { expectContract } from '../../test/contract.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { maxUserJson, signInitData } from '../../test/init-data.ts';
import { multipart, TINY_PNG } from '../../test/multipart.ts';
import { testConfig } from '../../test/services.ts';
import { createServices } from '../container.ts';
import { disabledRecognition } from '../recognition/index.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { buildApp } from './app.ts';

const BOT_TOKEN = 'diary-flow-bot-token-0123';
const DEMO_TOKEN = 'demo-guest-token-diary-0123456789';
const clock = fixedClock('2026-09-25T12:00:00Z');
const pool = testPool();
let app: FastifyInstance;

beforeAll(async () => {
  const config = testConfig({ MAX_BOT_TOKEN: BOT_TOKEN, DEMO_MODE: 'true', DEMO_GUEST_TOKEN: DEMO_TOKEN });
  const services = createServices({
    config,
    pool,
    clock,
    recognition: {
      ...disabledRecognition(),
      dishes: {
        fromPhoto: () =>
          Promise.resolve({
            status: 'recognized',
            items: [
              {
                title: 'Овсянка с бананом',
                portionG: 300,
                kcalMin: 320,
                kcalMax: 400,
                proteinG: 10,
                fatG: 7,
                carbsG: 60,
                tags: ['grain', 'fruit'],
                confidence: 0.8,
              },
            ],
            basis: 'Видна тарелка овсянки с бананом',
            model: 'test-model',
          }),
        fromText: () => Promise.resolve({ status: 'unavailable', reason: 'disabled' }),
      },
    },
    background: createBackgroundTasks({ error: () => undefined }),
  });
  app = await buildApp({ config, services });
  await app.ready();
});

beforeEach(async () => {
  await resetDatabase(pool);
});

afterAll(async () => {
  await app.close();
  await closeTestPool();
});

async function signIn(): Promise<{ headers: { authorization: string }; body: Record<string, unknown> }> {
  const initData = signInitData(
    { auth_date: String(Math.floor(clock.now().getTime() / 1000)), user: maxUserJson(7070, 'Лиля') },
    BOT_TOKEN,
  );
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/max', payload: { initData } });
  expect(response.statusCode).toBe(200);
  expectContract(response, 'POST', '/api/v1/auth/max');
  const body = response.json<{ token: string; user: Record<string, unknown> }>();
  return { headers: { authorization: `Bearer ${body.token}` }, body: body.user };
}

describe('guest diary flow against the database', () => {
  it('asks for consent, keeps the diary and deletes everything on request', async () => {
    const { headers, body: firstProfile } = await signIn();
    expect(firstProfile).toMatchObject({
      consents: { personalData: { granted: false, version: null }, personalizedOffers: { granted: false } },
    });

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/diary/meals',
      headers,
      payload: { title: 'Сырники', kcal: 350 },
    });
    expect(blocked.statusCode).toBe(403);
    expectContract(blocked, 'POST', '/api/v1/diary/meals');
    expect(blocked.json()).toMatchObject({ code: 'consent_required' });

    const documents = await app.inject({ method: 'GET', url: '/api/v1/consents', headers });
    expectContract(documents, 'GET', '/api/v1/consents');
    const { items } = documents.json<{ items: { kind: string; version: string; granted: boolean }[] }>();
    expect(items.map((item) => [item.kind, item.granted])).toEqual([
      ['personal_data', false],
      ['personalized_offers', false],
    ]);

    const outdated = await app.inject({
      method: 'PUT',
      url: '/api/v1/consents/personal_data',
      headers,
      payload: { version: '2020-01-01' },
    });
    expect(outdated.statusCode).toBe(409);
    expectContract(outdated, 'PUT', '/api/v1/consents/{kind}');

    const granted = await app.inject({
      method: 'PUT',
      url: '/api/v1/consents/personal_data',
      headers,
      payload: { version: items[0]?.version },
    });
    expect(granted.statusCode).toBe(200);
    expectContract(granted, 'PUT', '/api/v1/consents/{kind}');
    expect(granted.json()).toEqual({
      granted: true,
      version: '2026-09-25',
      grantedAt: '2026-09-25T12:00:00.000Z',
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/diary/meals',
      headers,
      payload: { title: 'Сырники', kcal: 350 },
    });
    expect(created.statusCode).toBe(201);
    expectContract(created, 'POST', '/api/v1/diary/meals');
    expect(created.json()).toMatchObject({ title: 'Сырники', kcal: 350, source: 'manual', slot: 'lunch' });

    const upload = multipart([
      { field: 'image', filename: 'dish.png', contentType: 'image/png', data: TINY_PNG },
    ]);
    const photo = await app.inject({
      method: 'POST',
      url: '/api/v1/diary/meals/photo',
      headers: { ...upload.headers, ...headers },
      payload: upload.payload,
    });
    expect(photo.statusCode).toBe(200);
    expectContract(photo, 'POST', '/api/v1/diary/meals/photo');
    expect(photo.json()).toMatchObject({
      status: 'logged',
      meals: [{ title: 'Овсянка с бананом', source: 'photo', confidence: 0.8 }],
      day: { totals: { meals: 2, kcal: 710 }, remainingKcal: 1290 },
    });

    const today = await app.inject({ method: 'GET', url: '/api/v1/diary/today', headers });
    expectContract(today, 'GET', '/api/v1/diary/today');
    expect(today.json()).toMatchObject({ date: '2026-09-25', totals: { meals: 2 } });

    const summary = await app.inject({ method: 'GET', url: '/api/v1/diary/summary', headers });
    expectContract(summary, 'GET', '/api/v1/diary/summary');
    const { days } = summary.json<{ days: { date: string; kcal: number }[] }>();
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ date: '2026-09-19', kcal: 0 });
    expect(days[6]).toMatchObject({ date: '2026-09-25', kcal: 710 });

    const badZone = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers,
      payload: { timezone: 'Mars/Olympus' },
    });
    expect(badZone.statusCode).toBe(422);
    expectContract(badZone, 'PATCH', '/api/v1/me');

    const keepConsent = await app.inject({
      method: 'DELETE',
      url: '/api/v1/consents/personal_data',
      headers,
    });
    expect(keepConsent.statusCode).toBe(409);
    expectContract(keepConsent, 'DELETE', '/api/v1/consents/{kind}');

    const deleted = await app.inject({ method: 'DELETE', url: '/api/v1/me', headers });
    expect(deleted.statusCode).toBe(204);
    expectContract(deleted, 'DELETE', '/api/v1/me');

    const gone = await app.inject({ method: 'GET', url: '/api/v1/me', headers });
    expect(gone.statusCode).toBe(404);
    expectContract(gone, 'GET', '/api/v1/me');
    expect(gone.json()).toMatchObject({ code: 'user_not_found' });

    const again = await signIn();
    expect(again.body).toMatchObject({
      kcalTarget: 2000,
      consents: { personalData: { granted: false, version: null } },
    });
    const emptyDay = await app.inject({ method: 'GET', url: '/api/v1/diary/today', headers: again.headers });
    expect(emptyDay.json()).toMatchObject({ totals: { meals: 0 }, meals: [] });
  });

  it('keeps the demo account from being deleted', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${DEMO_TOKEN}` },
    });
    expect(response.statusCode).toBe(403);
    expectContract(response, 'DELETE', '/api/v1/me');
    expect(response.json()).toMatchObject({ code: 'demo_account_protected' });
  });
});
