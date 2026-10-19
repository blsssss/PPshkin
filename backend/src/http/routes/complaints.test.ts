import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp, fakeServices } from '../../../test/services.ts';
import type { Complaint } from '../../domain/moderation.ts';
import type { ModerationService } from '../../services/moderation.ts';
import { conflict, notFound } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const COMPLAINTS = '/api/v1/complaints';
const guest = bearer('guest-token');

const complaint: Complaint = {
  id: 5,
  venueId: 7,
  bookingId: 31,
  reason: 'not_served',
  status: 'open',
  createdAt: new Date('2026-09-25T10:00:00Z'),
  resolvedAt: null,
};

async function appWith(overrides: Partial<ModerationService> = {}) {
  app = await buildTestApp({
    services: { moderation: { ...fakeServices().moderation, ...overrides } },
  });
  return app;
}

describe('complaint routes', () => {
  it('require authentication', async () => {
    const server = await appWith();
    for (const method of ['POST', 'GET'] as const) {
      const response = await server.inject({ method, url: COMPLAINTS });
      expect(response.statusCode).toBe(401);
      expectContract(response, method, COMPLAINTS);
    }
  });

  it('files a complaint for the signed in guest', async () => {
    const createComplaint = vi.fn<ModerationService['createComplaint']>(() => Promise.resolve(complaint));
    const server = await appWith({ createComplaint });
    const response = await server.inject({
      method: 'POST',
      url: COMPLAINTS,
      headers: guest,
      payload: { venueId: 7, bookingId: 31, reason: 'not_served', text: 'Не выдали' },
    });
    expect(response.statusCode).toBe(201);
    expectContract(response, 'POST', COMPLAINTS);
    expect(response.json()).toEqual({
      id: 5,
      venueId: 7,
      bookingId: 31,
      reason: 'not_served',
      status: 'open',
      createdAt: '2026-09-25T10:00:00.000Z',
      resolvedAt: null,
    });
    expect(createComplaint).toHaveBeenCalledWith(101, {
      venueId: 7,
      bookingId: 31,
      reason: 'not_served',
      text: 'Не выдали',
    });
  });

  it('rejects an unknown reason and an overlong text', async () => {
    const server = await appWith();
    for (const payload of [
      { venueId: 7, reason: 'rude' },
      { venueId: 7, reason: 'other', text: 'я'.repeat(501) },
      { reason: 'other' },
    ]) {
      const response = await server.inject({ method: 'POST', url: COMPLAINTS, headers: guest, payload });
      expect(response.statusCode).toBe(400);
      expectContract(response, 'POST', COMPLAINTS);
      expect(response.json()).toMatchObject({ code: 'validation_failed' });
    }
  });

  it('passes on the limit, duplicate and missing booking errors', async () => {
    const failures = [
      notFound('booking_not_found', 'Booking not found'),
      notFound('venue_not_found', 'Venue not found'),
      conflict('complaint_exists', 'exists'),
      conflict('complaint_limit', 'limit'),
    ];
    for (const failure of failures) {
      const server = await appWith({ createComplaint: () => Promise.reject(failure) });
      const response = await server.inject({
        method: 'POST',
        url: COMPLAINTS,
        headers: guest,
        payload: { venueId: 7, reason: 'other' },
      });
      expect(response.statusCode).toBe(failure.status);
      expectContract(response, 'POST', COMPLAINTS);
      expect(response.json()).toMatchObject({ code: failure.code });
      await server.close();
    }
  });

  it('lists the guest complaints', async () => {
    const listComplaints = vi.fn<ModerationService['listComplaints']>(() => Promise.resolve([complaint]));
    const server = await appWith({ listComplaints });
    const response = await server.inject({ method: 'GET', url: COMPLAINTS, headers: guest });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', COMPLAINTS);
    expect(response.json()).toMatchObject({ items: [{ id: 5, status: 'open' }] });
    expect(listComplaints).toHaveBeenCalledWith(101);
  });
});
