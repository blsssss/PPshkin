import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp, fakeServices } from '../../../test/services.ts';
import type { AdminComplaint } from '../../domain/moderation.ts';
import type { ModerationService } from '../../services/moderation.ts';
import { conflict } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const admin = bearer('guest-token');
const stranger = bearer('venue-token');
const ADMIN_ID = 101;

const complaint: AdminComplaint = {
  id: 5,
  venueId: 7,
  bookingId: 31,
  reason: 'price_mismatch',
  status: 'open',
  createdAt: new Date('2026-09-25T10:00:00Z'),
  resolvedAt: null,
  text: 'На кассе дороже',
  venueName: 'Кофейня «Зерно»',
  bookingCode: 'K7M2QX',
  itemName: 'Эклер',
  resolution: null,
};

const ROUTES = [
  ['GET', '/api/v1/admin/complaints', '/api/v1/admin/complaints'],
  ['POST', '/api/v1/admin/complaints/5/resolution', '/api/v1/admin/complaints/{id}/resolution'],
  ['POST', '/api/v1/admin/venues/7/block', '/api/v1/admin/venues/{id}/block'],
  ['POST', '/api/v1/admin/venues/7/unblock', '/api/v1/admin/venues/{id}/unblock'],
  ['POST', '/api/v1/admin/users/9/block', '/api/v1/admin/users/{id}/block'],
  ['POST', '/api/v1/admin/users/9/unblock', '/api/v1/admin/users/{id}/unblock'],
] as const;

async function appWith(overrides: Partial<ModerationService> = {}) {
  app = await buildTestApp({
    services: {
      moderation: { ...fakeServices().moderation, isAdmin: (id) => id === ADMIN_ID, ...overrides },
    },
  });
  return app;
}

describe('admin routes', () => {
  it('require authentication', async () => {
    const server = await appWith();
    for (const [method, url, path] of ROUTES) {
      const response = await server.inject({ method, url });
      expect(response.statusCode, url).toBe(401);
      expectContract(response, method, path);
    }
  });

  it('hide themselves from a user who is not an administrator, even with a bad body', async () => {
    const server = await appWith();
    for (const [method, url, path] of ROUTES) {
      const response = await server.inject({ method, url, headers: stranger, payload: { reason: '' } });
      expect(response.statusCode, url).toBe(404);
      expectContract(response, method, path);
      expect(response.json()).toMatchObject({ code: 'not_found' });
    }
  });

  it('lists complaints waiting for a decision', async () => {
    const listForReview = vi.fn<ModerationService['listForReview']>(() => Promise.resolve([complaint]));
    const server = await appWith({ listForReview });
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/admin/complaints',
      headers: admin,
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/admin/complaints');
    expect(response.json()).toMatchObject({
      items: [{ id: 5, text: 'На кассе дороже', venueName: 'Кофейня «Зерно»', bookingCode: 'K7M2QX' }],
    });
    expect(listForReview).toHaveBeenCalledWith(ADMIN_ID, 'open');
    const bad = await server.inject({
      method: 'GET',
      url: '/api/v1/admin/complaints?status=done',
      headers: admin,
    });
    expect(bad.statusCode).toBe(400);
    expectContract(bad, 'GET', '/api/v1/admin/complaints');
  });

  it('resolves a complaint and answers 409 for a decided one', async () => {
    const resolveComplaint = vi.fn<ModerationService['resolveComplaint']>(() =>
      Promise.resolve({ ...complaint, status: 'resolved', resolution: 'Связались' }),
    );
    const server = await appWith({ resolveComplaint });
    const url = '/api/v1/admin/complaints/5/resolution';
    const path = '/api/v1/admin/complaints/{id}/resolution';
    const response = await server.inject({
      method: 'POST',
      url,
      headers: admin,
      payload: { status: 'resolved', resolution: 'Связались' },
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'POST', path);
    expect(resolveComplaint).toHaveBeenCalledWith(
      ADMIN_ID,
      5,
      { status: 'resolved', resolution: 'Связались' },
      'api',
    );
    const invalid = await server.inject({ method: 'POST', url, headers: admin, payload: { status: 'open' } });
    expect(invalid.statusCode).toBe(400);
    expectContract(invalid, 'POST', path);

    await server.close();
    const decided = await appWith({
      resolveComplaint: () => Promise.reject(conflict('already_resolved', 'decided')),
    });
    const conflicting = await decided.inject({
      method: 'POST',
      url,
      headers: admin,
      payload: { status: 'rejected' },
    });
    expect(conflicting.statusCode).toBe(409);
    expectContract(conflicting, 'POST', path);
  });

  it('blocks and unblocks venues and users', async () => {
    const blockVenue = vi.fn<ModerationService['blockVenue']>(() => Promise.resolve());
    const unblockVenue = vi.fn<ModerationService['unblockVenue']>(() => Promise.resolve());
    const blockUser = vi.fn<ModerationService['blockUser']>(() => Promise.resolve());
    const unblockUser = vi.fn<ModerationService['unblockUser']>(() => Promise.resolve());
    const server = await appWith({ blockVenue, unblockVenue, blockUser, unblockUser });

    const blocked = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/venues/7/block',
      headers: admin,
      payload: { reason: ' Нет подтверждения ' },
    });
    expect(blocked.statusCode).toBe(200);
    expectContract(blocked, 'POST', '/api/v1/admin/venues/{id}/block');
    expect(blocked.json()).toEqual({ blocked: true });
    expect(blockVenue).toHaveBeenCalledWith(ADMIN_ID, 7, 'Нет подтверждения', 'api');

    const unblocked = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/venues/7/unblock',
      headers: admin,
    });
    expect(unblocked.json()).toEqual({ blocked: false });
    expectContract(unblocked, 'POST', '/api/v1/admin/venues/{id}/unblock');
    expect(unblockVenue).toHaveBeenCalledWith(ADMIN_ID, 7, 'api');

    const userBlocked = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/users/9/block',
      headers: admin,
      payload: { reason: 'Злоупотребление' },
    });
    expect(userBlocked.statusCode).toBe(200);
    expectContract(userBlocked, 'POST', '/api/v1/admin/users/{id}/block');
    expect(blockUser).toHaveBeenCalledWith(ADMIN_ID, 9, 'Злоупотребление', 'api');

    const userUnblocked = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/users/9/unblock',
      headers: admin,
    });
    expect(userUnblocked.statusCode).toBe(200);
    expectContract(userUnblocked, 'POST', '/api/v1/admin/users/{id}/unblock');
    expect(unblockUser).toHaveBeenCalledWith(ADMIN_ID, 9, 'api');
  });

  it('requires a reason of up to 500 characters to block', async () => {
    const server = await appWith();
    for (const reason of ['', '   ', 'я'.repeat(501)]) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/admin/venues/7/block',
        headers: admin,
        payload: { reason },
      });
      expect(response.statusCode).toBe(400);
      expectContract(response, 'POST', '/api/v1/admin/venues/{id}/block');
    }
  });

  it('passes conflicts of repeated blocks through', async () => {
    const server = await appWith({
      blockVenue: () => Promise.reject(conflict('already_blocked', 'blocked')),
      unblockVenue: () => Promise.reject(conflict('not_blocked', 'open')),
    });
    const block = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/venues/7/block',
      headers: admin,
      payload: { reason: 'тест' },
    });
    expect(block.statusCode).toBe(409);
    expectContract(block, 'POST', '/api/v1/admin/venues/{id}/block');
    const unblock = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/venues/7/unblock',
      headers: admin,
    });
    expect(unblock.statusCode).toBe(409);
    expectContract(unblock, 'POST', '/api/v1/admin/venues/{id}/unblock');
  });
});
