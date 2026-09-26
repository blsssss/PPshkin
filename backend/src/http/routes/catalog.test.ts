import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp } from '../../../test/services.ts';
import { sampleDeal, sampleMenuItem, sampleVenue } from '../../../test/venues.ts';
import type { CatalogService, DealCardView, VenueCardView } from '../../services/catalog.ts';
import { notFound } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const guest = bearer('guest-token');
const GUEST_ID = 101;

const venueCard: VenueCardView = { venue: sampleVenue, distanceM: 420, openNow: true, activeDeals: 1 };
const dealCard: DealCardView = {
  deal: { deal: sampleDeal, item: sampleMenuItem, status: 'active' },
  venue: sampleVenue,
  distanceM: null,
};

function catalogStub(overrides: Partial<CatalogService> = {}): CatalogService {
  return {
    venues: () => Promise.resolve([venueCard]),
    venue: () =>
      Promise.resolve({ venue: sampleVenue, openNow: false, menu: [sampleMenuItem], deals: [dealCard.deal] }),
    deals: () => Promise.resolve([dealCard]),
    deal: () => Promise.resolve(dealCard),
    ...overrides,
  };
}

describe('catalog routes', () => {
  it('require authentication', async () => {
    app = await buildTestApp();
    for (const [url, path] of [
      ['/api/v1/venues', '/api/v1/venues'],
      ['/api/v1/venues/7', '/api/v1/venues/{id}'],
      ['/api/v1/deals', '/api/v1/deals'],
    ] as const) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
      expectContract(response, 'GET', path);
    }
  });

  it('lists venues near the given point', async () => {
    const venues = vi.fn<CatalogService['venues']>(() => Promise.resolve([venueCard]));
    app = await buildTestApp({ services: { catalog: catalogStub({ venues }) } });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/venues?lat=55.79&lon=49.12&radius=1500',
      headers: guest,
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/venues');
    expect(response.json()).toEqual({
      items: [
        {
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
          distanceM: 420,
          openNow: true,
          activeDeals: 1,
        },
      ],
    });
    expect(venues).toHaveBeenCalledWith(GUEST_ID, { point: { lat: 55.79, lon: 49.12 }, radiusM: 1500 });

    await app.inject({ method: 'GET', url: '/api/v1/venues', headers: guest });
    expect(venues).toHaveBeenLastCalledWith(GUEST_ID, { point: null, radiusM: 3000 });
  });

  it('validates the search point and radius', async () => {
    app = await buildTestApp({ services: { catalog: catalogStub() } });
    for (const path of ['/api/v1/venues', '/api/v1/deals']) {
      for (const query of [
        'lat=55.79',
        'lon=49.12',
        'lat=91&lon=49.12',
        'lat=55.79&lon=49.12&radius=50',
        'radius=20000',
        'lat=abc&lon=1',
      ]) {
        const response = await app.inject({ method: 'GET', url: `${path}?${query}`, headers: guest });
        expect(response.statusCode, `${path}?${query}`).toBe(400);
        expectContract(response, 'GET', path);
        expect(response.json()).toMatchObject({ code: 'validation_failed' });
      }
    }
  });

  it('shows the venue card with its menu and deals', async () => {
    const venue = vi.fn<CatalogService['venue']>(() => catalogStub().venue(GUEST_ID, 7));
    app = await buildTestApp({ services: { catalog: catalogStub({ venue }) } });
    const response = await app.inject({ method: 'GET', url: '/api/v1/venues/7', headers: guest });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/venues/{id}');
    expect(response.json()).toMatchObject({
      venue: { id: 7 },
      openNow: false,
      menu: [{ id: 11, name: 'Эклер', nutritionSource: 'venue' }],
      deals: [{ id: 21, itemName: 'Эклер', originalPriceRub: 200, discountPercent: 35, status: 'active' }],
    });
    expect(venue).toHaveBeenCalledWith(GUEST_ID, 7);
  });

  it('reports unknown venues and malformed ids', async () => {
    app = await buildTestApp({
      services: { catalog: catalogStub({ venue: () => Promise.reject(notFound('venue_not_found', 'x')) }) },
    });
    const missing = await app.inject({ method: 'GET', url: '/api/v1/venues/404', headers: guest });
    expect(missing.statusCode).toBe(404);
    expectContract(missing, 'GET', '/api/v1/venues/{id}');
    expect(missing.json()).toMatchObject({ code: 'venue_not_found' });

    const malformed = await app.inject({ method: 'GET', url: '/api/v1/venues/seven', headers: guest });
    expect(malformed.statusCode).toBe(400);
    expectContract(malformed, 'GET', '/api/v1/venues/{id}');
  });

  it('lists deals nearby', async () => {
    const deals = vi.fn<CatalogService['deals']>(() => Promise.resolve([dealCard]));
    app = await buildTestApp({ services: { catalog: catalogStub({ deals }) } });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/deals?lat=55.79&lon=49.12',
      headers: guest,
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/deals');
    expect(response.json()).toMatchObject({
      items: [
        {
          deal: { id: 21, priceRub: 130, quantityLeft: 3, endsAt: '2026-09-25T11:00:00.000Z' },
          item: { id: 11, kcal: 330 },
          venue: { id: 7, isDemo: false },
          distanceM: null,
        },
      ],
    });
    expect(deals).toHaveBeenCalledWith(GUEST_ID, { point: { lat: 55.79, lon: 49.12 }, radiusM: 3000 });
  });
});
