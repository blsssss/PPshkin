import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { bearer, buildTestApp } from '../../../test/services.ts';
import type { User } from '../../domain/models.ts';
import { unauthorized } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const user: User = {
  id: 101,
  firstName: 'Анна',
  username: null,
  timezone: 'Europe/Moscow',
  kcalTarget: 1800,
  goal: 'maintain',
  dislikedTags: ['fish'],
  location: null,
  locationUpdatedAt: null,
  createdAt: new Date('2026-09-20T10:00:00Z'),
  updatedAt: new Date('2026-09-20T10:00:00Z'),
};

describe('POST /api/v1/auth/max', () => {
  it('returns a session for valid init data', async () => {
    app = await buildTestApp({
      services: {
        auth: {
          signInWithMax: (initData) =>
            initData === 'signed'
              ? Promise.resolve({
                  token: 'session-token',
                  expiresAt: new Date('2026-09-26T00:00:00Z'),
                  user,
                  startParam: 'venue_1',
                })
              : Promise.reject(unauthorized('init_data_bad_signature', 'bad')),
          resolveBearer: () => Promise.resolve(null),
        },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/max',
      payload: { initData: 'signed' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      token: 'session-token',
      expiresAt: '2026-09-26T00:00:00.000Z',
      startParam: 'venue_1',
      user: {
        id: 101,
        firstName: 'Анна',
        username: null,
        timezone: 'Europe/Moscow',
        kcalTarget: 1800,
        goal: 'maintain',
        dislikedTags: ['fish'],
        location: null,
      },
    });

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/max',
      payload: { initData: 'x' },
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json()).toMatchObject({ code: 'init_data_bad_signature' });
  });

  it('validates the request body', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/max', payload: { initData: '' } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_failed', errors: [{ path: 'body.initData' }] });
  });
});

describe('GET /api/v1/me', () => {
  it('requires authentication', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'unauthorized' });
  });

  it('rejects unknown and malformed tokens', async () => {
    app = await buildTestApp();
    const unknown = await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer('nope') });
    const malformed = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: 'Basic x' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toMatchObject({ code: 'invalid_token' });
    expect(malformed.statusCode).toBe(401);
    expect(malformed.json()).toMatchObject({ code: 'invalid_token' });
  });

  it('returns the profile of the authenticated user', async () => {
    app = await buildTestApp({
      services: { users: { get: (id) => Promise.resolve({ ...user, id }) } },
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer('guest-token') });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 101, kcalTarget: 1800, dislikedTags: ['fish'] });
  });
});
