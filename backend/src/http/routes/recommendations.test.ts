import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp } from '../../../test/services.ts';
import { sampleDeal, sampleMenuItem, sampleVenue } from '../../../test/venues.ts';
import type { OfferExplanation } from '../../domain/models.ts';
import type {
  RecommendationsResult,
  RecommendationsService,
  RecommendedOffer,
} from '../../services/recommendations.ts';
import { conflict, notFound } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const guest = bearer('guest-token');
const GUEST_ID = 101;
const RECOMMENDATIONS = '/api/v1/recommendations';
const DECLINE = '/api/v1/offers/{id}/decline';

const explanation: OfferExplanation = {
  headline: 'Можно позволить десерт',
  facts: [
    'Сегодня записано 2 приёма пищи, примерно 900 ккал',
    '«Эклер» в «Кофейня «Зерно»»: 330 ккал по данным заведения',
  ],
  calculations: [
    'До ориентира 2000 ккал остаётся около 1100 ккал',
    'Идти около 400 м',
    'Скидка 35%: 130 ₽ вместо 200 ₽, до 14:00',
    'Осталось 3 шт.',
  ],
  assumptions: ['Калорийность приблизительная, это не медицинская рекомендация'],
  factors: [{ factor: 'fit', value: 0.35, weight: 0.3 }],
};

const offer: RecommendedOffer = {
  offerId: 501,
  item: sampleMenuItem,
  venue: sampleVenue,
  deal: { deal: sampleDeal, item: sampleMenuItem, status: 'active' },
  score: 0.6425,
  distanceM: 412,
  priceRub: 130,
  kcal: 330,
  explanation,
};

const found: RecommendationsResult = {
  status: 'ok',
  slot: 'snack',
  remainingKcal: 1100,
  slotBudgetKcal: 200,
  demoCenterUsed: false,
  items: [offer],
};

function recommendationsStub(overrides: Partial<RecommendationsService> = {}): RecommendationsService {
  return {
    recommend: () => Promise.resolve(found),
    decline: () => Promise.resolve(),
    ...overrides,
  };
}

describe('recommendation routes', () => {
  it('require authentication', async () => {
    app = await buildTestApp({ services: { recommendations: recommendationsStub() } });
    const anonymous = await app.inject({ method: 'GET', url: RECOMMENDATIONS });
    expect(anonymous.statusCode).toBe(401);
    expectContract(anonymous, 'GET', RECOMMENDATIONS);
    expect(anonymous.json()).toMatchObject({ code: 'unauthorized' });

    const expired = await app.inject({
      method: 'POST',
      url: '/api/v1/offers/7/decline',
      headers: bearer('expired-token'),
      payload: { reason: 'dislike' },
    });
    expect(expired.statusCode).toBe(401);
    expectContract(expired, 'POST', DECLINE);
    expect(expired.json()).toMatchObject({ code: 'invalid_token' });
  });

  it('recommends dishes near the given point with the explanation of the engine', async () => {
    const recommend = vi.fn<RecommendationsService['recommend']>(() => Promise.resolve(found));
    app = await buildTestApp({ services: { recommendations: recommendationsStub({ recommend }) } });
    const response = await app.inject({
      method: 'GET',
      url: `${RECOMMENDATIONS}?lat=55.79&lon=49.12&limit=3`,
      headers: guest,
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', RECOMMENDATIONS);
    expect(response.json()).toEqual({
      status: 'ok',
      slot: 'snack',
      remainingKcal: 1100,
      slotBudgetKcal: 200,
      demoCenterUsed: false,
      items: [
        {
          offerId: 501,
          headline: explanation.headline,
          facts: explanation.facts,
          calculations: explanation.calculations,
          assumptions: explanation.assumptions,
          score: 0.6425,
          item: {
            id: 11,
            name: 'Эклер',
            description: 'Заварное тесто и ванильный крем',
            category: 'dessert',
            priceRub: 200,
            weightG: 80,
            kcal: 330,
            proteinG: 5,
            fatG: 18,
            carbsG: 38.2,
            nutritionSource: 'venue',
            tags: ['dessert', 'sweet'],
            isAvailable: true,
          },
          venue: {
            id: 7,
            name: 'Кофейня «Зерно»',
            address: 'ул. Баумана, 36',
            category: 'coffee',
            location: { lat: 55.7887, lon: 49.1221 },
            opensAt: '08:00',
            closesAt: '22:00',
            timezone: 'Europe/Moscow',
            isDemo: false,
          },
          deal: {
            id: 21,
            menuItemId: 11,
            itemName: 'Эклер',
            priceRub: 130,
            originalPriceRub: 200,
            discountPercent: 35,
            quantityTotal: 5,
            quantityLeft: 3,
            startsAt: '2026-09-25T09:00:00.000Z',
            endsAt: '2026-09-25T11:00:00.000Z',
            status: 'active',
          },
          distanceM: 412,
          priceRub: 130,
          kcal: 330,
        },
      ],
    });
    expect(response.json()).not.toHaveProperty('items.0.factors');
    expect(recommend).toHaveBeenCalledWith(GUEST_ID, {
      location: { lat: 55.79, lon: 49.12 },
      limit: 3,
      channel: 'miniapp',
    });
  });

  it('uses five dishes and the saved location by default', async () => {
    const recommend = vi.fn<RecommendationsService['recommend']>(() =>
      Promise.resolve({ ...found, items: [{ ...offer, deal: null, distanceM: null, priceRub: 200 }] }),
    );
    app = await buildTestApp({ services: { recommendations: recommendationsStub({ recommend }) } });
    for (const query of ['', '?lat=&lon=&limit=']) {
      const response = await app.inject({ method: 'GET', url: `${RECOMMENDATIONS}${query}`, headers: guest });
      expect(response.statusCode).toBe(200);
      expectContract(response, 'GET', RECOMMENDATIONS);
      expect(response.json()).toMatchObject({ items: [{ deal: null, distanceM: null, priceRub: 200 }] });
    }
    expect(recommend.mock.calls).toEqual([
      [GUEST_ID, { location: null, limit: 5, channel: 'miniapp' }],
      [GUEST_ID, { location: null, limit: 5, channel: 'miniapp' }],
    ]);
  });

  it.each([
    ['profile_empty', 'snack', 2000, 200],
    ['budget_exhausted', 'dinner', 40, 40],
    ['nothing_fits', 'lunch', 1300, 700],
  ] as const)('reports %s without items', async (status, slot, remainingKcal, slotBudgetKcal) => {
    const result: RecommendationsResult = {
      status,
      slot,
      remainingKcal,
      slotBudgetKcal,
      demoCenterUsed: false,
      items: [],
    };
    app = await buildTestApp({
      services: { recommendations: recommendationsStub({ recommend: () => Promise.resolve(result) }) },
    });
    const response = await app.inject({ method: 'GET', url: RECOMMENDATIONS, headers: guest });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', RECOMMENDATIONS);
    expect(response.json()).toEqual(result);
  });

  it('validates the point and the limit', async () => {
    const recommend = vi.fn<RecommendationsService['recommend']>(() => Promise.resolve(found));
    app = await buildTestApp({ services: { recommendations: recommendationsStub({ recommend }) } });
    for (const query of [
      'lat=55.79',
      'lon=49.12',
      'lat=&lon=49.12',
      'lat=91&lon=49.12',
      'lat=55.79&lon=181',
      'lat=north&lon=49.12',
      'limit=0',
      'limit=11',
      'limit=2.5',
      'limit=many',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `${RECOMMENDATIONS}?${query}`,
        headers: guest,
      });
      expect(response.statusCode, query).toBe(400);
      expectContract(response, 'GET', RECOMMENDATIONS);
      expect(response.json()).toMatchObject({ code: 'validation_failed' });
    }
    expect(recommend).not.toHaveBeenCalled();
  });

  it('limits recommendations to 30 a minute', async () => {
    app = await buildTestApp({ services: { recommendations: recommendationsStub() } });
    for (let index = 0; index < 30; index += 1) {
      expect((await app.inject({ method: 'GET', url: RECOMMENDATIONS, headers: guest })).statusCode).toBe(
        200,
      );
    }
    const limited = await app.inject({ method: 'GET', url: RECOMMENDATIONS, headers: guest });
    expect(limited.statusCode).toBe(429);
    expectContract(limited, 'GET', RECOMMENDATIONS);
  });

  it('reports a deleted account', async () => {
    app = await buildTestApp({
      services: {
        recommendations: recommendationsStub({
          recommend: () => Promise.reject(notFound('user_not_found', 'User not found')),
        }),
      },
    });
    const response = await app.inject({ method: 'GET', url: RECOMMENDATIONS, headers: guest });
    expect(response.statusCode).toBe(404);
    expectContract(response, 'GET', RECOMMENDATIONS);
    expect(response.json()).toMatchObject({ code: 'user_not_found' });
  });
});

describe('declining an offer', () => {
  it('saves the reason', async () => {
    const decline = vi.fn<RecommendationsService['decline']>(() => Promise.resolve());
    app = await buildTestApp({ services: { recommendations: recommendationsStub({ decline }) } });
    for (const reason of ['not_today', 'dislike'] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/offers/501/decline',
        headers: guest,
        payload: { reason },
      });
      expect(response.statusCode).toBe(204);
      expectContract(response, 'POST', DECLINE);
    }
    expect(decline.mock.calls).toEqual([
      [GUEST_ID, 501, 'not_today'],
      [GUEST_ID, 501, 'dislike'],
    ]);
  });

  it('validates the offer id and the reason', async () => {
    const decline = vi.fn<RecommendationsService['decline']>(() => Promise.resolve());
    app = await buildTestApp({ services: { recommendations: recommendationsStub({ decline }) } });
    for (const [url, payload] of [
      ['/api/v1/offers/501/decline', { reason: 'too_expensive' }],
      ['/api/v1/offers/501/decline', {}],
      ['/api/v1/offers/0/decline', { reason: 'dislike' }],
      ['/api/v1/offers/latest/decline', { reason: 'dislike' }],
    ] as const) {
      const response = await app.inject({ method: 'POST', url, headers: guest, payload });
      expect(response.statusCode, url).toBe(400);
      expectContract(response, 'POST', DECLINE);
      expect(response.json()).toMatchObject({ code: 'validation_failed' });
    }
    const xml = await app.inject({
      method: 'POST',
      url: '/api/v1/offers/501/decline',
      headers: { ...guest, 'content-type': 'application/xml' },
      payload: '<reason>dislike</reason>',
    });
    expect(xml.statusCode).toBe(415);
    expectContract(xml, 'POST', DECLINE);
    expect(decline).not.toHaveBeenCalled();
  });

  it.each([
    ['offer_not_found', 404, notFound('offer_not_found', 'Offer not found')],
    ['offer_already_accepted', 409, conflict('offer_already_accepted', 'The offer is already booked')],
  ] as const)('reports %s', async (code, status, error) => {
    app = await buildTestApp({
      services: { recommendations: recommendationsStub({ decline: () => Promise.reject(error) }) },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/offers/501/decline',
      headers: guest,
      payload: { reason: 'not_today' },
    });
    expect(response.statusCode).toBe(status);
    expectContract(response, 'POST', DECLINE);
    expect(response.json()).toMatchObject({ code });
  });

  it('tells when the demo mode replaced a far away point with the centre of Kazan', async () => {
    const demoOffer: RecommendedOffer = { ...offer, venue: { ...sampleVenue, isDemo: true } };
    app = await buildTestApp({
      services: {
        recommendations: recommendationsStub({
          recommend: () => Promise.resolve({ ...found, demoCenterUsed: true, items: [demoOffer] }),
        }),
      },
    });
    const response = await app.inject({
      method: 'GET',
      url: `${RECOMMENDATIONS}?lat=55.7558&lon=37.6173`,
      headers: guest,
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', RECOMMENDATIONS);
    expect(response.json()).toMatchObject({ demoCenterUsed: true, items: [{ venue: { isDemo: true } }] });
  });
});
