import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp } from '../../../test/services.ts';
import {
  bookingsStub,
  SAMPLE_PNG,
  sampleBooking,
  sampleBookingJson,
  sampleBookingView,
} from '../../../test/bookings.ts';
import type { BookingsService } from '../../services/bookings.ts';
import { conflict, forbidden, notFound, unprocessable, type AppError } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const guest = bearer('guest-token');
const GUEST_ID = 101;
const BOOKINGS = '/api/v1/bookings';
const BOOKING = '/api/v1/bookings/{id}';
const QR = '/api/v1/bookings/{id}/qr';
const CANCEL = '/api/v1/bookings/{id}/cancel';
const view = sampleBookingView;
const bookingJson = sampleBookingJson;

async function appWith(overrides: Partial<BookingsService> = {}) {
  app = await buildTestApp({
    services: { bookings: bookingsStub(overrides) },
  });
  return app;
}

describe('guest booking routes', () => {
  it('require authentication', async () => {
    const server = await appWith();
    for (const [method, url, path] of [
      ['POST', BOOKINGS, BOOKINGS],
      ['GET', BOOKINGS, BOOKINGS],
      ['GET', '/api/v1/bookings/31', BOOKING],
      ['GET', '/api/v1/bookings/31/qr', QR],
      ['POST', '/api/v1/bookings/31/cancel', CANCEL],
    ] as const) {
      const anonymous = await server.inject({ method, url });
      expect(anonymous.statusCode, url).toBe(401);
      expectContract(anonymous, method, path);
      expect(anonymous.json()).toMatchObject({ code: 'unauthorized' });
    }
    const expired = await server.inject({ method: 'GET', url: BOOKINGS, headers: bearer('expired-token') });
    expect(expired.statusCode).toBe(401);
    expectContract(expired, 'GET', BOOKINGS);
    expect(expired.json()).toMatchObject({ code: 'invalid_token' });
  });
});

describe('creating a booking', () => {
  it('books the dish and returns the code, the QR payload and no guest data', async () => {
    const create = vi.fn<BookingsService['create']>(() => Promise.resolve(view));
    const server = await appWith({ create });
    const response = await server.inject({
      method: 'POST',
      url: BOOKINGS,
      headers: guest,
      payload: { menuItemId: 11, dealId: 21, offerId: 501 },
    });
    expect(response.statusCode).toBe(201);
    expectContract(response, 'POST', BOOKINGS);
    expect(response.json()).toEqual(bookingJson);
    expect(create).toHaveBeenCalledExactlyOnceWith(GUEST_ID, { menuItemId: 11, dealId: 21, offerId: 501 });

    const plain = await server.inject({
      method: 'POST',
      url: BOOKINGS,
      headers: guest,
      payload: { menuItemId: 11 },
    });
    expect(plain.statusCode).toBe(201);
    expect(create).toHaveBeenLastCalledWith(GUEST_ID, { menuItemId: 11 });
  });

  it('validates the body', async () => {
    const create = vi.fn<BookingsService['create']>(() => Promise.resolve(view));
    const server = await appWith({ create });
    for (const payload of [
      {},
      { menuItemId: 0 },
      { menuItemId: 1.5 },
      { menuItemId: '11' },
      { menuItemId: 11, dealId: -1 },
    ]) {
      const response = await server.inject({ method: 'POST', url: BOOKINGS, headers: guest, payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expectContract(response, 'POST', BOOKINGS);
      expect(response.json()).toMatchObject({ code: 'validation_failed' });
    }
    const xml = await server.inject({
      method: 'POST',
      url: BOOKINGS,
      headers: { ...guest, 'content-type': 'application/xml' },
      payload: '<menuItemId>11</menuItemId>',
    });
    expect(xml.statusCode).toBe(415);
    expectContract(xml, 'POST', BOOKINGS);
    const huge = await server.inject({
      method: 'POST',
      url: BOOKINGS,
      headers: { ...guest, 'content-type': 'application/json' },
      payload: JSON.stringify({ menuItemId: 11, padding: 'x'.repeat(1024 * 1024) }),
    });
    expect(huge.statusCode).toBe(413);
    expectContract(huge, 'POST', BOOKINGS);
    expect(create).not.toHaveBeenCalled();
  });

  it.each<[string, number, AppError]>([
    ['consent_required', 403, forbidden('consent_required', 'Consent is required')],
    ['user_not_found', 404, notFound('user_not_found', 'User not found')],
    ['menu_item_not_found', 404, notFound('menu_item_not_found', 'Menu item not found')],
    ['deal_not_found', 404, notFound('deal_not_found', 'Deal not found')],
    ['offer_not_found', 404, notFound('offer_not_found', 'Offer not found')],
    ['venue_closed', 409, conflict('venue_closed', 'The venue is closed now')],
    ['deal_not_active', 409, conflict('deal_not_active', 'The deal is over')],
    ['booking_exists', 409, conflict('booking_exists', 'Already booked')],
    ['deal_sold_out', 409, conflict('deal_sold_out', 'Sold out')],
    ['too_many_bookings', 409, conflict('too_many_bookings', 'Too many bookings')],
    ['menu_item_unavailable', 422, unprocessable('menu_item_unavailable', 'Hidden')],
  ])('reports %s', async (code, status, error) => {
    const server = await appWith({ create: () => Promise.reject(error) });
    const response = await server.inject({
      method: 'POST',
      url: BOOKINGS,
      headers: guest,
      payload: { menuItemId: 11 },
    });
    expect(response.statusCode).toBe(status);
    expectContract(response, 'POST', BOOKINGS);
    expect(response.json()).toMatchObject({ code, status });
  });
});

describe('reading bookings', () => {
  it('lists active bookings by default and the history on request', async () => {
    const list = vi.fn<BookingsService['list']>(() => Promise.resolve([view]));
    const server = await appWith({ list });
    for (const url of [BOOKINGS, `${BOOKINGS}?status=active`, `${BOOKINGS}?status=history`]) {
      const response = await server.inject({ method: 'GET', url, headers: guest });
      expect(response.statusCode).toBe(200);
      expectContract(response, 'GET', BOOKINGS);
      expect(response.json()).toEqual({ items: [bookingJson] });
    }
    expect(list.mock.calls).toEqual([
      [GUEST_ID, 'active'],
      [GUEST_ID, 'active'],
      [GUEST_ID, 'history'],
    ]);
    const invalid = await server.inject({ method: 'GET', url: `${BOOKINGS}?status=all`, headers: guest });
    expect(invalid.statusCode).toBe(400);
    expectContract(invalid, 'GET', BOOKINGS);
  });

  it('returns an own booking', async () => {
    const get = vi.fn<BookingsService['get']>(() => Promise.resolve(view));
    const server = await appWith({ get });
    const response = await server.inject({ method: 'GET', url: '/api/v1/bookings/31', headers: guest });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', BOOKING);
    expect(response.json()).toEqual(bookingJson);
    expect(get).toHaveBeenCalledExactlyOnceWith(GUEST_ID, 31);
  });

  it('serves the QR code as an uncached PNG', async () => {
    const qr = vi.fn<BookingsService['qr']>(() => Promise.resolve(SAMPLE_PNG));
    const server = await appWith({ qr });
    const response = await server.inject({ method: 'GET', url: '/api/v1/bookings/31/qr', headers: guest });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', QR);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.rawPayload).toEqual(SAMPLE_PNG);
    expect(qr).toHaveBeenCalledExactlyOnceWith(GUEST_ID, 31);
  });

  it('limits QR codes to 30 a minute', async () => {
    const server = await appWith();
    for (let index = 0; index < 30; index += 1) {
      const response = await server.inject({ method: 'GET', url: '/api/v1/bookings/31/qr', headers: guest });
      expect(response.statusCode).toBe(200);
    }
    const limited = await server.inject({ method: 'GET', url: '/api/v1/bookings/31/qr', headers: guest });
    expect(limited.statusCode).toBe(429);
    expectContract(limited, 'GET', QR);
  });

  it('hides bookings of other guests and validates the id', async () => {
    const missing = () => Promise.reject(notFound('booking_not_found', 'Booking not found'));
    const server = await appWith({ get: missing, qr: missing });
    for (const [url, path] of [
      ['/api/v1/bookings/32', BOOKING],
      ['/api/v1/bookings/32/qr', QR],
    ] as const) {
      const response = await server.inject({ method: 'GET', url, headers: guest });
      expect(response.statusCode).toBe(404);
      expectContract(response, 'GET', path);
      expect(response.json()).toMatchObject({ code: 'booking_not_found' });
    }
    for (const [url, path] of [
      ['/api/v1/bookings/abc', BOOKING],
      ['/api/v1/bookings/0/qr', QR],
    ] as const) {
      const response = await server.inject({ method: 'GET', url, headers: guest });
      expect(response.statusCode).toBe(400);
      expectContract(response, 'GET', path);
      expect(response.json()).toMatchObject({ code: 'validation_failed' });
    }
  });
});

describe('cancelling a booking', () => {
  it('cancels an own booking', async () => {
    const cancelled = {
      ...view,
      booking: {
        ...sampleBooking,
        status: 'cancelled' as const,
        resolvedAt: new Date('2026-09-25T09:10:00Z'),
      },
    };
    const cancel = vi.fn<BookingsService['cancel']>(() => Promise.resolve(cancelled));
    const server = await appWith({ cancel });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/bookings/31/cancel',
      headers: guest,
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'POST', CANCEL);
    expect(response.json()).toEqual({
      ...bookingJson,
      status: 'cancelled',
      resolvedAt: '2026-09-25T09:10:00.000Z',
    });
    expect(cancel).toHaveBeenCalledExactlyOnceWith(GUEST_ID, 31);
  });

  it.each<[string, number, AppError]>([
    ['booking_not_found', 404, notFound('booking_not_found', 'Booking not found')],
    ['booking_not_active', 409, conflict('booking_not_active', 'Already redeemed')],
    ['booking_expired', 409, conflict('booking_expired', 'Expired')],
  ])('reports %s', async (code, status, error) => {
    const server = await appWith({ cancel: () => Promise.reject(error) });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/bookings/31/cancel',
      headers: guest,
    });
    expect(response.statusCode).toBe(status);
    expectContract(response, 'POST', CANCEL);
    expect(response.json()).toMatchObject({ code });
  });

  it('validates the id', async () => {
    const server = await appWith();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/bookings/-1/cancel',
      headers: guest,
    });
    expect(response.statusCode).toBe(400);
    expectContract(response, 'POST', CANCEL);
  });
});
