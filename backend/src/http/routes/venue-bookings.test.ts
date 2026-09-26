import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookingsStub, sampleBooking, sampleBookingJson, sampleBookingView } from '../../../test/bookings.ts';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp } from '../../../test/services.ts';
import { sampleMenuItem } from '../../../test/venues.ts';
import type { AnalyticsService, VenueAnalytics } from '../../services/analytics.ts';
import type { BookingsService } from '../../services/bookings.ts';
import { badRequest, conflict, notFound, type AppError } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const owner = bearer('venue-token');
const OWNER_ID = 202;
const BOOKINGS = '/api/v1/venue/bookings';
const REDEEM = '/api/v1/venue/bookings/redeem';
const ANALYTICS = '/api/v1/venue/analytics';

const noVenue = () => Promise.reject(notFound('venue_not_found', 'You have no venue yet'));

const analytics: VenueAnalytics = {
  from: '2026-09-19',
  to: '2026-09-25',
  timezone: 'Europe/Moscow',
  offersShown: 5,
  offersAccepted: 3,
  bookingsCreated: 4,
  bookingsRedeemed: 3,
  bookingsExpired: 1,
  bookingsCancelled: 0,
  acceptRate: 0.6,
  redeemRate: 0.75,
  revenueRub: 460,
  surplusUnitsSold: 2,
  surplusRevenueRub: 260,
  topItems: [{ menuItemId: sampleMenuItem.id, name: 'Эклер', redeemed: 2, revenueRub: 260 }],
  byDay: [
    {
      date: '2026-09-25',
      offersShown: 5,
      offersAccepted: 3,
      bookingsCreated: 4,
      bookingsRedeemed: 3,
      revenueRub: 460,
    },
  ],
};

async function appWith(bookings: Partial<BookingsService> = {}, stats: Partial<AnalyticsService> = {}) {
  app = await buildTestApp({
    services: {
      bookings: bookingsStub(bookings),
      analytics: { get: () => Promise.resolve(analytics), ...stats },
    },
  });
  return app;
}

describe('venue booking routes', () => {
  it('require authentication', async () => {
    const server = await appWith();
    for (const [method, url] of [
      ['GET', BOOKINGS],
      ['POST', REDEEM],
      ['GET', ANALYTICS],
    ] as const) {
      const anonymous = await server.inject({ method, url });
      expect(anonymous.statusCode, url).toBe(401);
      expectContract(anonymous, method, url);
      expect(anonymous.json()).toMatchObject({ code: 'unauthorized' });
    }
  });

  it('report a missing venue', async () => {
    const server = await appWith({ listForVenue: noVenue, redeem: noVenue }, { get: noVenue });
    for (const [method, url, payload] of [
      ['GET', BOOKINGS, undefined],
      ['POST', REDEEM, { code: 'K7MP4X' }],
      ['GET', ANALYTICS, undefined],
    ] as const) {
      const response = await server.inject({ method, url, headers: owner, payload });
      expect(response.statusCode, url).toBe(404);
      expectContract(response, method, url);
      expect(response.json()).toMatchObject({ code: 'venue_not_found' });
    }
  });
});

describe('venue bookings list', () => {
  it('lists bookings without any guest data', async () => {
    const listForVenue = vi.fn<BookingsService['listForVenue']>(() => Promise.resolve([sampleBookingView]));
    const server = await appWith({ listForVenue });
    for (const url of [BOOKINGS, `${BOOKINGS}?status=history&date=2026-09-25`]) {
      const response = await server.inject({ method: 'GET', url, headers: owner });
      expect(response.statusCode).toBe(200);
      expectContract(response, 'GET', BOOKINGS);
      expect(response.json()).toEqual({ items: [sampleBookingJson] });
      const [item] = response.json<{ items: Record<string, unknown>[] }>().items;
      expect(item).not.toHaveProperty('userId');
      expect(item).not.toHaveProperty('offerId');
    }
    expect(listForVenue.mock.calls).toEqual([
      [OWNER_ID, { status: 'active' }],
      [OWNER_ID, { status: 'history', date: '2026-09-25' }],
    ]);
  });

  it('validates the filters', async () => {
    const listForVenue = vi.fn<BookingsService['listForVenue']>(() => Promise.resolve([]));
    const server = await appWith({ listForVenue });
    for (const query of ['status=all', 'date=2026-02-30', 'date=25.09.2026', 'date=']) {
      const response = await server.inject({ method: 'GET', url: `${BOOKINGS}?${query}`, headers: owner });
      expect(response.statusCode, query).toBe(400);
      expectContract(response, 'GET', BOOKINGS);
      expect(response.json()).toMatchObject({ code: 'validation_failed' });
    }
    expect(listForVenue).not.toHaveBeenCalled();
  });
});

describe('redeeming a booking', () => {
  it('redeems the code as the scanner read it', async () => {
    const redeemed = {
      ...sampleBookingView,
      booking: {
        ...sampleBooking,
        status: 'redeemed' as const,
        resolvedAt: new Date('2026-09-25T09:20:00Z'),
      },
    };
    const redeem = vi.fn<BookingsService['redeem']>(() => Promise.resolve(redeemed));
    const server = await appWith({ redeem });
    const response = await server.inject({
      method: 'POST',
      url: REDEEM,
      headers: owner,
      payload: { code: 'ppshkin:booking:k7mp4x' },
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'POST', REDEEM);
    expect(response.json()).toEqual({
      ...sampleBookingJson,
      status: 'redeemed',
      resolvedAt: '2026-09-25T09:20:00.000Z',
    });
    expect(redeem).toHaveBeenCalledExactlyOnceWith(OWNER_ID, 'ppshkin:booking:k7mp4x');
  });

  it('validates the code', async () => {
    const redeem = vi.fn<BookingsService['redeem']>(() => Promise.resolve(sampleBookingView));
    const server = await appWith({ redeem });
    for (const payload of [{}, { code: '' }, { code: 'x'.repeat(65) }, { code: 42 }]) {
      const response = await server.inject({ method: 'POST', url: REDEEM, headers: owner, payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expectContract(response, 'POST', REDEEM);
      expect(response.json()).toMatchObject({ code: 'validation_failed' });
    }
    const text = await server.inject({
      method: 'POST',
      url: REDEEM,
      headers: { ...owner, 'content-type': 'application/xml' },
      payload: '<code>K7MP4X</code>',
    });
    expect(text.statusCode).toBe(415);
    expectContract(text, 'POST', REDEEM);
    const huge = await server.inject({
      method: 'POST',
      url: REDEEM,
      headers: { ...owner, 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'K7MP4X', padding: 'x'.repeat(1024 * 1024) }),
    });
    expect(huge.statusCode).toBe(413);
    expectContract(huge, 'POST', REDEEM);
    expect(redeem).not.toHaveBeenCalled();
  });

  it.each<[string, number, AppError]>([
    ['booking_not_found', 404, notFound('booking_not_found', 'Booking not found')],
    ['booking_expired', 409, conflict('booking_expired', 'Expired')],
    ['booking_not_active', 409, conflict('booking_not_active', 'Already redeemed')],
  ])('reports %s', async (code, status, error) => {
    const server = await appWith({ redeem: () => Promise.reject(error) });
    const response = await server.inject({
      method: 'POST',
      url: REDEEM,
      headers: owner,
      payload: { code: 'K7MP4X' },
    });
    expect(response.statusCode).toBe(status);
    expectContract(response, 'POST', REDEEM);
    expect(response.json()).toMatchObject({ code });
  });
});

describe('venue analytics', () => {
  it('returns the analytics for the requested period', async () => {
    const get = vi.fn<AnalyticsService['get']>(() => Promise.resolve(analytics));
    const server = await appWith({}, { get });
    for (const url of [ANALYTICS, `${ANALYTICS}?from=2026-09-19&to=2026-09-25`]) {
      const response = await server.inject({ method: 'GET', url, headers: owner });
      expect(response.statusCode).toBe(200);
      expectContract(response, 'GET', ANALYTICS);
      expect(response.json()).toEqual(analytics);
    }
    expect(get.mock.calls).toEqual([
      [OWNER_ID, {}],
      [OWNER_ID, { from: '2026-09-19', to: '2026-09-25' }],
    ]);
  });

  it('validates the period', async () => {
    const get = vi.fn<AnalyticsService['get']>(() =>
      Promise.reject(badRequest('invalid_period', 'from must not be later than to')),
    );
    const server = await appWith({}, { get });
    for (const query of ['from=2026-13-01', 'to=yesterday']) {
      const response = await server.inject({ method: 'GET', url: `${ANALYTICS}?${query}`, headers: owner });
      expect(response.statusCode, query).toBe(400);
      expectContract(response, 'GET', ANALYTICS);
      expect(response.json()).toMatchObject({ code: 'validation_failed' });
    }
    expect(get).not.toHaveBeenCalled();
    const inverted = await server.inject({
      method: 'GET',
      url: `${ANALYTICS}?from=2026-09-25&to=2026-09-19`,
      headers: owner,
    });
    expect(inverted.statusCode).toBe(400);
    expectContract(inverted, 'GET', ANALYTICS);
    expect(inverted.json()).toMatchObject({ code: 'invalid_period' });
  });
});
