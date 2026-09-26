import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp, fakeServices } from '../../../test/services.ts';
import type { User } from '../../domain/models.ts';
import type { ConsentStatus } from '../../services/consents.ts';
import type { ProfilePatch, ProfileService } from '../../services/profile.ts';
import { forbidden, notFound, unprocessable } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const user: User = {
  id: 101,
  firstName: 'Анна',
  username: 'anna',
  timezone: 'Europe/Moscow',
  kcalTarget: 2000,
  goal: null,
  dislikedTags: [],
  location: null,
  locationUpdatedAt: null,
  createdAt: new Date('2026-09-20T10:00:00Z'),
  updatedAt: new Date('2026-09-20T10:00:00Z'),
};

const consents: ConsentStatus = {
  personalData: { granted: true, version: '2026-09-25', grantedAt: new Date('2026-09-25T09:00:00Z') },
  personalizedOffers: { granted: false, version: '2025-01-01', grantedAt: new Date('2025-01-02T09:00:00Z') },
};

function profileService(overrides: Partial<ProfileService>): { profile: ProfileService } {
  return { profile: { ...fakeServices().profile, ...overrides } };
}

describe('PATCH /api/v1/me', () => {
  it('applies the patch and returns the profile', async () => {
    const received: ProfilePatch[] = [];
    app = await buildTestApp({
      services: profileService({
        update: (id, patch) => {
          received.push(patch);
          return Promise.resolve({ user: { ...user, id, ...patch }, consents });
        },
      }),
    });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: bearer('guest-token'),
      payload: { kcalTarget: 1800, goal: 'lose', dislikedTags: ['fish'], timezone: 'Asia/Yekaterinburg' },
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'PATCH', '/api/v1/me');
    expect(received).toEqual([
      { kcalTarget: 1800, goal: 'lose', dislikedTags: ['fish'], timezone: 'Asia/Yekaterinburg' },
    ]);
    expect(response.json()).toMatchObject({
      kcalTarget: 1800,
      goal: 'lose',
      timezone: 'Asia/Yekaterinburg',
      consents: {
        personalData: { granted: true, version: '2026-09-25', grantedAt: '2026-09-25T09:00:00.000Z' },
        personalizedOffers: { granted: false, version: '2025-01-01' },
      },
    });
  });

  it('lets the goal be cleared', async () => {
    app = await buildTestApp({
      services: profileService({
        update: (id, patch) => Promise.resolve({ user: { ...user, id, ...patch }, consents }),
      }),
    });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: bearer('guest-token'),
      payload: { goal: null },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ goal: null });
  });

  it('rejects an empty or invalid patch', async () => {
    app = await buildTestApp();
    const payloads = [
      [{}, 'body'],
      [{ kcalTarget: 999 }, 'body.kcalTarget'],
      [{ kcalTarget: 1800.5 }, 'body.kcalTarget'],
      [{ goal: 'bulk' }, 'body.goal'],
      [{ dislikedTags: ['unknown'] }, 'body.dislikedTags.0'],
      [{ timezone: '' }, 'body.timezone'],
    ] as const;
    for (const [payload, path] of payloads) {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me',
        headers: bearer('guest-token'),
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expectContract(response, 'PATCH', '/api/v1/me');
      expect(response.json()).toMatchObject({ code: 'validation_failed', errors: [{ path }] });
    }
  });

  it('passes service errors through as problems', async () => {
    const errors = [
      forbidden('consent_required', 'Consent is required'),
      notFound('user_not_found', 'User not found'),
      unprocessable('invalid_timezone', 'Unknown time zone'),
    ];
    for (const error of errors) {
      app = await buildTestApp({ services: profileService({ update: () => Promise.reject(error) }) });
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me',
        headers: bearer('guest-token'),
        payload: { timezone: 'Mars/Olympus' },
      });
      expect(response.statusCode).toBe(error.status);
      expectContract(response, 'PATCH', '/api/v1/me');
      expect(response.json()).toMatchObject({ code: error.code });
      await app.close();
      app = undefined;
    }
  });

  it('requires authentication', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/me', payload: {} });
    expect(response.statusCode).toBe(401);
    expectContract(response, 'PATCH', '/api/v1/me');
  });
});

describe('PUT /api/v1/me/location', () => {
  it('returns the stored coarse location', async () => {
    app = await buildTestApp({
      services: profileService({
        setLocation: (_id, point) =>
          Promise.resolve({
            location: { lat: Math.round(point.lat * 100) / 100, lon: Math.round(point.lon * 100) / 100 },
            updatedAt: new Date('2026-09-25T09:00:00Z'),
          }),
      }),
    });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/location',
      headers: bearer('guest-token'),
      payload: { lat: 55.796389, lon: 49.108891 },
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'PUT', '/api/v1/me/location');
    expect(response.json()).toEqual({
      location: { lat: 55.8, lon: 49.11 },
      updatedAt: '2026-09-25T09:00:00.000Z',
    });
  });

  it('validates coordinates', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/location',
      headers: bearer('guest-token'),
      payload: { lat: 91, lon: 49 },
    });
    expect(response.statusCode).toBe(400);
    expectContract(response, 'PUT', '/api/v1/me/location');
    expect(response.json()).toMatchObject({ errors: [{ path: 'body.lat' }] });
  });

  it('answers 403 without consent', async () => {
    app = await buildTestApp({
      services: profileService({
        setLocation: () => Promise.reject(forbidden('consent_required', 'Consent')),
      }),
    });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/location',
      headers: bearer('guest-token'),
      payload: { lat: 55.79, lon: 49.12 },
    });
    expect(response.statusCode).toBe(403);
    expectContract(response, 'PUT', '/api/v1/me/location');
  });
});

describe('DELETE /api/v1/me/location', () => {
  it('clears the location with an empty response', async () => {
    const cleared: number[] = [];
    app = await buildTestApp({
      services: profileService({
        clearLocation: (id) => {
          cleared.push(id);
          return Promise.resolve();
        },
      }),
    });
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/location',
      headers: bearer('guest-token'),
    });
    expect(response.statusCode).toBe(204);
    expectContract(response, 'DELETE', '/api/v1/me/location');
    expect(cleared).toEqual([101]);
  });

  it('requires authentication', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/v1/me/location' });
    expect(response.statusCode).toBe(401);
    expectContract(response, 'DELETE', '/api/v1/me/location');
  });
});

describe('DELETE /api/v1/me', () => {
  it('deletes the account of the caller', async () => {
    const deleted: number[] = [];
    app = await buildTestApp({
      services: {
        account: {
          deleteAccount: (id) => {
            deleted.push(id);
            return Promise.resolve();
          },
        },
      },
    });
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me',
      headers: bearer('guest-token'),
    });
    expect(response.statusCode).toBe(204);
    expectContract(response, 'DELETE', '/api/v1/me');
    expect(response.body).toBe('');
    expect(deleted).toEqual([101]);
  });

  it('refuses to delete a demo account', async () => {
    app = await buildTestApp({
      services: {
        account: {
          deleteAccount: (id) =>
            Promise.reject(id < 0 ? forbidden('demo_account_protected', 'Demo') : new Error('unexpected')),
        },
      },
    });
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me',
      headers: bearer('demo-guest-token'),
    });
    expect(response.statusCode).toBe(403);
    expectContract(response, 'DELETE', '/api/v1/me');
    expect(response.json()).toMatchObject({ code: 'demo_account_protected' });
  });

  it('requires authentication', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/v1/me' });
    expect(response.statusCode).toBe(401);
    expectContract(response, 'DELETE', '/api/v1/me');
  });
});
