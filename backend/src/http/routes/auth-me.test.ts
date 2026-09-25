import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
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

const signInService = {
  auth: {
    signInWithMax: (initData: string) =>
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
};

describe('POST /api/v1/auth/max', () => {
  it('returns a session for valid init data', async () => {
    app = await buildTestApp({ services: signInService });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/max',
      payload: { initData: 'signed' },
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'POST', '/api/v1/auth/max');
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
  });

  it('rejects bad init data with a problem', async () => {
    app = await buildTestApp({ services: signInService });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/max',
      payload: { initData: 'x' },
    });
    expect(response.statusCode).toBe(401);
    expectContract(response, 'POST', '/api/v1/auth/max');
    expect(response.json()).toMatchObject({ code: 'init_data_bad_signature' });
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('signs in even when a stale token is still sent', async () => {
    app = await buildTestApp({ services: signInService });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/max',
      headers: bearer('expired-token'),
      payload: { initData: 'signed' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('validates the request body', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/max', payload: { initData: '' } });
    expect(response.statusCode).toBe(400);
    expectContract(response, 'POST', '/api/v1/auth/max');
    expect(response.json()).toMatchObject({ code: 'validation_failed', errors: [{ path: 'body.initData' }] });
  });

  it('limits sign in attempts per address', async () => {
    app = await buildTestApp({ services: signInService });
    const attempt = () =>
      app!.inject({ method: 'POST', url: '/api/v1/auth/max', payload: { initData: 'signed' } });
    for (let index = 0; index < 30; index += 1) {
      expect((await attempt()).statusCode).toBe(200);
    }
    const limited = await attempt();
    expect(limited.statusCode).toBe(429);
    expectContract(limited, 'POST', '/api/v1/auth/max');
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('GET /api/v1/me', () => {
  it('requires authentication', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(response.statusCode).toBe(401);
    expectContract(response, 'GET', '/api/v1/me');
    expect(response.json()).toMatchObject({ code: 'unauthorized' });
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('asks to sign in again for unknown or malformed tokens', async () => {
    app = await buildTestApp();
    for (const authorization of ['Bearer nope', 'Basic x', 'Bearer']) {
      const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization } });
      expect(response.statusCode).toBe(401);
      expectContract(response, 'GET', '/api/v1/me');
      expect(response.json()).toMatchObject({ code: 'invalid_token' });
      expect(response.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
    }
  });

  it('returns the profile of the authenticated user', async () => {
    app = await buildTestApp({
      services: { users: { get: (id) => Promise.resolve({ ...user, id }) } },
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer('guest-token') });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/me');
    expect(response.json()).toMatchObject({ id: 101, kcalTarget: 1800, dislikedTags: ['fish'] });
  });

  it('keeps CORS headers on authentication failures', async () => {
    app = await buildTestApp({ env: { CORS_ORIGINS: 'https://app.example' } });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { ...bearer('nope'), origin: 'https://app.example' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example');
    expect(response.headers['access-control-expose-headers']).toContain('Retry-After');
  });
});
