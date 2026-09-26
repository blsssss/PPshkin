import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { expectContract } from '../../test/contract.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { maxUserJson, signInitData } from '../../test/init-data.ts';
import { testConfig } from '../../test/services.ts';
import { createServices } from '../container.ts';
import { loadDemoDataset } from '../demo/dataset.ts';
import { CONSENT_DOCUMENTS } from '../domain/consents.ts';
import { createRecognition } from '../recognition/index.ts';
import type { Services } from '../services/index.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { buildApp } from './app.ts';

const BOT_TOKEN = 'demo-flow-bot-token-0123';
const GUEST_TOKEN = 'demo-guest-token-demo-flow-0123456789';
const VENUE_TOKEN = 'demo-venue-token-demo-flow-0123456789';
const demoGuest = { authorization: `Bearer ${GUEST_TOKEN}` };
const demoVenue = { authorization: `Bearer ${VENUE_TOKEN}` };
const CENTRE = 'lat=55.7887&lon=49.1221';
const MOSCOW = 'lat=55.7558&lon=37.6173';
const DEMO_VENUE_IDS = [900001, 900002, 900003, 900004, 900005, 900006];
const clock = fixedClock('2026-09-26T13:00:00Z');
const pool = testPool();
let app: FastifyInstance;
let services: Services;

type Method = 'GET' | 'POST' | 'PUT';

async function send(
  method: Method,
  url: string,
  path: string,
  headers: Record<string, string>,
  payload?: object,
) {
  const response = await app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  expectContract(response, method, path);
  return response;
}

interface VenueCardBody {
  venue: { id: number; isDemo: boolean };
  distanceM: number | null;
}

async function venueIds(headers: Record<string, string>, query = CENTRE): Promise<number[]> {
  const response = await send('GET', `/api/v1/venues?${query}`, '/api/v1/venues', headers);
  expect(response.statusCode).toBe(200);
  return response
    .json<{ items: VenueCardBody[] }>()
    .items.map((card) => card.venue.id)
    .sort((left, right) => left - right);
}

async function signIn(userId: number): Promise<Record<string, string>> {
  const initData = signInitData(
    { auth_date: String(Math.floor(clock.now().getTime() / 1000)), user: maxUserJson(userId, 'Проверяющий') },
    BOT_TOKEN,
  );
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/max', payload: { initData } });
  expect(response.statusCode).toBe(200);
  const headers = { authorization: `Bearer ${response.json<{ token: string }>().token}` };
  const consent = await send('PUT', '/api/v1/consents/personal_data', '/api/v1/consents/{kind}', headers, {
    version: CONSENT_DOCUMENTS.personal_data.version,
  });
  expect(consent.statusCode).toBe(200);
  return headers;
}

beforeAll(async () => {
  const config = testConfig({
    MAX_BOT_TOKEN: BOT_TOKEN,
    DEMO_MODE: 'true',
    DEMO_GUEST_TOKEN: GUEST_TOKEN,
    DEMO_VENUE_TOKEN: VENUE_TOKEN,
  });
  services = createServices({
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
    demoDataset: await loadDemoDataset(),
  });
  app = await buildApp({ config, services });
  await app.ready();
});

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-26T13:00:00Z');
  await services.demo.seed();
});

afterAll(async () => {
  await app.close();
  await closeTestPool();
});

describe('demo mode through the HTTP API', () => {
  it('shows the Kazan demo venues near the centre and from far away', async () => {
    const near = await send('GET', `/api/v1/venues?${CENTRE}`, '/api/v1/venues', demoGuest);
    const body = near.json<{ items: VenueCardBody[]; demoCenterUsed: boolean }>();
    expect(body.demoCenterUsed).toBe(false);
    expect(body.items).toHaveLength(6);
    expect(body.items.every((card) => card.venue.isDemo && (card.distanceM ?? Infinity) < 1000)).toBe(true);

    const far = await send('GET', `/api/v1/venues?${MOSCOW}`, '/api/v1/venues', demoGuest);
    expect(far.json()).toMatchObject({ demoCenterUsed: true });
    expect(await venueIds(demoGuest, MOSCOW)).toEqual(DEMO_VENUE_IDS);

    const deals = await send('GET', `/api/v1/deals?${MOSCOW}`, '/api/v1/deals', demoGuest);
    const dealBody = deals.json<{ items: { deal: { status: string } }[]; demoCenterUsed: boolean }>();
    expect(dealBody.demoCenterUsed).toBe(true);
    expect(dealBody.items.length).toBeGreaterThanOrEqual(6);
    expect(dealBody.items.every((card) => card.deal.status === 'active')).toBe(true);
  });

  it('suggests a dessert to the demo guest around 16:00 and marks the venue as a test one', async () => {
    const response = await send(
      'GET',
      `/api/v1/recommendations?${CENTRE}`,
      '/api/v1/recommendations',
      demoGuest,
    );
    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; items: { headline: string; assumptions: string[] }[] }>();
    expect(body.status).toBe('ok');
    expect(body.items[0]?.headline).toBe('Можно позволить десерт');
    expect(body.items[0]?.assumptions).toContain('Заведение и меню тестовые');
  });

  it('gives the demo venue a week of analytics and survives a restart', async () => {
    const response = await send(
      'GET',
      '/api/v1/venue/analytics?from=2026-09-19&to=2026-09-25',
      '/api/v1/venue/analytics',
      demoVenue,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ offersShown: 57, bookingsCreated: 21, bookingsRedeemed: 16 });

    await services.demo.seed();
    expect(await venueIds(demoGuest)).toEqual(DEMO_VENUE_IDS);
    const again = await send(
      'GET',
      '/api/v1/venue/analytics?from=2026-09-19&to=2026-09-25',
      '/api/v1/venue/analytics',
      demoVenue,
    );
    expect(again.json()).toMatchObject({ offersShown: 57, bookingsRedeemed: 16 });
  });

  it('lets a reviewer take a demo venue, get a ready profile and go through a booking on one account', async () => {
    const reviewer = await signIn(7070);

    const diary = await send('POST', '/api/v1/diary/demo', '/api/v1/diary/demo', reviewer);
    expect(diary.statusCode).toBe(201);
    expect(diary.json()).toEqual({ mealsAdded: 26, fromDate: '2026-09-21', toDate: '2026-09-25' });
    expect((await send('POST', '/api/v1/diary/demo', '/api/v1/diary/demo', reviewer)).statusCode).toBe(409);
    const insights = await send('GET', '/api/v1/insights', '/api/v1/insights', reviewer);
    expect(insights.json()).toMatchObject({ readiness: 'ready', mealsCount: 26, daysTracked: 5 });

    const claimed = await send('POST', '/api/v1/venue/demo', '/api/v1/venue/demo', reviewer, {});
    expect(claimed.statusCode).toBe(201);
    const copy = claimed.json<{ id: number; isDemo: boolean }>();
    expect(copy.isDemo).toBe(true);
    expect((await send('POST', '/api/v1/venue/demo', '/api/v1/venue/demo', reviewer, {})).statusCode).toBe(
      409,
    );
    expect(await venueIds(reviewer)).toEqual([copy.id, ...DEMO_VENUE_IDS.slice(1)]);

    const hidden = await send('GET', `/api/v1/venues/${copy.id}`, '/api/v1/venues/{id}', demoGuest);
    expect(hidden.statusCode).toBe(404);

    const liveDeals = await send('GET', '/api/v1/venue/deals', '/api/v1/venue/deals', reviewer);
    const [cheesecake] = liveDeals.json<{ items: { id: number; menuItemId: number; status: string }[] }>()
      .items;
    expect(cheesecake?.status).toBe('active');
    const booked = await send('POST', '/api/v1/bookings', '/api/v1/bookings', reviewer, {
      menuItemId: cheesecake!.menuItemId,
      dealId: cheesecake!.id,
    });
    expect(booked.statusCode).toBe(201);
    const redeemed = await send(
      'POST',
      '/api/v1/venue/bookings/redeem',
      '/api/v1/venue/bookings/redeem',
      reviewer,
      { code: booked.json<{ code: string }>().code },
    );
    expect(redeemed.json()).toMatchObject({ status: 'redeemed' });

    const refused = await send('POST', '/api/v1/venue/demo', '/api/v1/venue/demo', demoGuest, {});
    expect(refused.json()).toMatchObject({ status: 403, code: 'demo_account' });
  });
});
