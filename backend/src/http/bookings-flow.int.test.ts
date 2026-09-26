import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { expectContract } from '../../test/contract.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { decodeQrPng } from '../../test/qr.ts';
import { testConfig } from '../../test/services.ts';
import { DEMO_ACCOUNTS } from '../auth/demo.ts';
import { createServices } from '../container.ts';
import { createRecognition } from '../recognition/index.ts';
import * as users from '../repositories/users.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { buildApp } from './app.ts';

const GUEST_TOKEN = 'demo-guest-token-bookings-0123456789';
const VENUE_TOKEN = 'demo-venue-token-bookings-0123456789';
const guest = { authorization: `Bearer ${GUEST_TOKEN}` };
const owner = { authorization: `Bearer ${VENUE_TOKEN}` };
const clock = fixedClock('2026-09-26T13:00:00Z');
const pool = testPool();
let app: FastifyInstance;

interface BookingBody {
  id: number;
  code: string;
  qrPayload: string;
  status: string;
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

async function dealStock(dealId: number): Promise<number | undefined> {
  for (const status of ['active', 'finished']) {
    const response = await send('GET', `/api/v1/venue/deals?status=${status}`, '/api/v1/venue/deals', owner);
    const deals = response.json<{ items: { id: number; quantityLeft: number }[] }>().items;
    const found = deals.find((deal) => deal.id === dealId);
    if (found) return found.quantityLeft;
  }
  return undefined;
}

describe('bookings flow against the database', () => {
  it('books a hot deal, redeems it by QR and shows the result to the guest and the venue', async () => {
    const venue = await send('POST', '/api/v1/venue', '/api/v1/venue', owner, {
      name: 'Кофейня «Зерно»',
      address: 'ул. Баумана, 36',
      category: 'coffee',
      location: { lat: 55.7887, lon: 49.1221 },
      opensAt: '08:00',
      closesAt: '22:00',
    });
    expect(venue.statusCode).toBe(201);
    const item = await send('POST', '/api/v1/venue/menu/items', '/api/v1/venue/menu/items', owner, {
      name: 'Чизкейк',
      category: 'dessert',
      priceRub: 250,
      kcal: 320,
      proteinG: 7,
      fatG: 21,
      carbsG: 26,
      tags: ['dessert', 'sweet'],
    });
    const menuItemId = item.json<{ id: number }>().id;
    const deal = await send('POST', '/api/v1/venue/deals', '/api/v1/venue/deals', owner, {
      menuItemId,
      priceRub: 160,
      quantity: 2,
      endsAt: '2026-09-26T16:00:00Z',
    });
    const dealId = deal.json<{ id: number }>().id;

    const denied = await send('POST', '/api/v1/bookings', '/api/v1/bookings', guest, { menuItemId, dealId });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'consent_required' });
    await send('PUT', '/api/v1/consents/personal_data', '/api/v1/consents/{kind}', guest, {
      version: '2026-09-25',
    });

    const created = await send('POST', '/api/v1/bookings', '/api/v1/bookings', guest, { menuItemId, dealId });
    expect(created.statusCode).toBe(201);
    const booking = created.json<BookingBody>();
    expect(booking).toMatchObject({ status: 'active', qrPayload: `ppshkin:booking:${booking.code}` });
    expect(booking.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(created.json()).toMatchObject({ priceRub: 160, kcal: 320, expiresAt: '2026-09-26T14:00:00.000Z' });
    expect(await dealStock(dealId)).toBe(1);

    const qr = await send('GET', `/api/v1/bookings/${booking.id}/qr`, '/api/v1/bookings/{id}/qr', guest);
    expect(qr.statusCode).toBe(200);
    expect((await decodeQrPng(qr.rawPayload)).text).toBe(booking.qrPayload);

    const redeem = { code: booking.qrPayload.toLowerCase() };
    const redeemed = await send(
      'POST',
      '/api/v1/venue/bookings/redeem',
      '/api/v1/venue/bookings/redeem',
      owner,
      redeem,
    );
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json()).toMatchObject({ id: booking.id, status: 'redeemed' });
    const again = await send(
      'POST',
      '/api/v1/venue/bookings/redeem',
      '/api/v1/venue/bookings/redeem',
      owner,
      redeem,
    );
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'booking_not_active' });

    const diary = await send('GET', '/api/v1/diary/today', '/api/v1/diary/today', guest);
    expect(diary.json()).toMatchObject({
      meals: [
        { title: 'Чизкейк', kcalMin: 288, kcalMax: 352, source: 'booking', tags: ['dessert', 'sweet'] },
      ],
    });

    const second = await send('POST', '/api/v1/bookings', '/api/v1/bookings', guest, { menuItemId, dealId });
    expect(await dealStock(dealId)).toBe(0);
    const cancelled = await send(
      'POST',
      `/api/v1/bookings/${second.json<BookingBody>().id}/cancel`,
      '/api/v1/bookings/{id}/cancel',
      guest,
    );
    expect(cancelled.json()).toMatchObject({ status: 'cancelled' });
    expect(await dealStock(dealId)).toBe(1);

    const history = await send('GET', '/api/v1/bookings?status=history', '/api/v1/bookings', guest);
    expect(history.json<{ items: BookingBody[] }>().items.map((entry) => entry.status)).toEqual([
      'cancelled',
      'redeemed',
    ]);
    const venueHistory = await send(
      'GET',
      '/api/v1/venue/bookings?status=history',
      '/api/v1/venue/bookings',
      owner,
    );
    expect(venueHistory.json<{ items: BookingBody[] }>().items).toHaveLength(2);

    const analytics = await send('GET', '/api/v1/venue/analytics', '/api/v1/venue/analytics', owner);
    expect(analytics.json()).toMatchObject({
      from: '2026-09-20',
      to: '2026-09-26',
      bookingsCreated: 2,
      bookingsRedeemed: 1,
      bookingsCancelled: 1,
      redeemRate: 0.5,
      revenueRub: 160,
      surplusUnitsSold: 1,
      surplusRevenueRub: 160,
      topItems: [{ menuItemId, name: 'Чизкейк', redeemed: 1, revenueRub: 160 }],
    });
  });
});
