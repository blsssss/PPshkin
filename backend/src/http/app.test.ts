import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { expectContract } from '../../test/contract.ts';
import { bearer, buildTestApp } from '../../test/services.ts';
import { conflict } from '../shared/errors.ts';
import { quietestLevel, trustProxyOption } from './app.ts';

let app: FastifyInstance | undefined;

async function start(options: Parameters<typeof buildTestApp>[0] = {}) {
  app = await buildTestApp(options);
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('buildApp', () => {
  it('answers the liveness probe', async () => {
    const instance = await start();
    const response = await instance.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/health');
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('ignores credentials on public routes', async () => {
    const instance = await start();
    const response = await instance.inject({ method: 'GET', url: '/health', headers: bearer('nope') });
    expect(response.statusCode).toBe(200);
  });

  it('reports readiness when the database answers', async () => {
    const instance = await start();
    const response = await instance.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/ready');
    expect(response.json()).toEqual({ status: 'ready' });
  });

  it('reports unavailability when the database is down', async () => {
    const instance = await start({
      services: { health: { databaseReachable: () => Promise.resolve(false) } },
    });
    const response = await instance.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expectContract(response, 'GET', '/ready');
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ code: 'database_unavailable' });
  });

  it('sets security headers', async () => {
    const instance = await start();
    const response = await instance.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('returns problem details for unknown routes', async () => {
    const instance = await start();
    const response = await instance.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 404, code: 'route_not_found', title: 'Not Found' });
  });

  it('maps application errors to their status and code', async () => {
    const instance = await start({
      extend: (server) => {
        server.get('/boom', () => {
          throw conflict('already_exists', 'Already exists');
        });
      },
    });
    const response = await instance.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'already_exists', detail: 'Already exists' });
  });

  it('hides internal error messages', async () => {
    const instance = await start({
      extend: (server) => {
        server.get('/crash', () => {
          throw new Error('database password leaked');
        });
      },
    });
    const response = await instance.inject({ method: 'GET', url: '/crash' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'internal_error', detail: 'Internal server error' });
    expect(response.body).not.toContain('password');
  });

  it('reports malformed JSON bodies as client errors', async () => {
    const instance = await start({
      extend: (server) => {
        server.post('/echo', (request) => request.body);
      },
    });
    const response = await instance.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken"',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: 400, code: 'fst_err_ctp_invalid_json_body' });
  });

  it('allows only configured CORS origins', async () => {
    const instance = await start({ env: { CORS_ORIGINS: 'https://app.example' } });
    const allowed = await instance.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.example' },
    });
    const denied = await instance.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('ignores forwarded addresses unless the proxy is trusted', async () => {
    const instance = await start({
      env: { RATE_LIMIT_PER_MINUTE: '1' },
      extend: (server) => {
        server.get('/ip', (request) => ({ ip: request.ip }));
      },
    });
    const first = await instance.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    const second = await instance.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '10.0.0.2' },
    });
    expect(first.json<{ ip: string }>().ip).not.toBe('10.0.0.1');
    expect(second.statusCode).toBe(429);
  });

  it('uses forwarded addresses behind a trusted proxy', async () => {
    const instance = await start({
      env: { TRUST_PROXY: 'true' },
      extend: (server) => {
        server.get('/ip', (request) => ({ ip: request.ip }));
      },
    });
    const response = await instance.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    expect(response.json<{ ip: string }>().ip).toBe('10.0.0.1');
  });

  it('limits request rate per user rather than per address when authenticated', async () => {
    const instance = await start({
      env: { RATE_LIMIT_PER_MINUTE: '1' },
      extend: (server) => {
        server.get('/limited', () => ({ ok: true }));
      },
    });
    const guest = await instance.inject({ method: 'GET', url: '/limited', headers: bearer('guest-token') });
    const venue = await instance.inject({ method: 'GET', url: '/limited', headers: bearer('venue-token') });
    const guestAgain = await instance.inject({
      method: 'GET',
      url: '/limited',
      headers: bearer('guest-token'),
    });
    expect(guest.statusCode).toBe(200);
    expect(venue.statusCode).toBe(200);
    expect(guestAgain.statusCode).toBe(429);
    expect(guestAgain.json()).toMatchObject({
      code: 'rate_limited',
      detail: expect.stringContaining('retry') as unknown,
    });
    expect(guestAgain.headers['retry-after']).toBeDefined();
  });

  it('gives each reviewer of a shared demo account a separate rate limit bucket', async () => {
    const instance = await start({
      env: { RATE_LIMIT_PER_MINUTE: '1' },
      extend: (server) => {
        server.get('/limited', () => ({ ok: true }));
      },
    });
    const from = (remoteAddress: string) =>
      instance.inject({ method: 'GET', url: '/limited', headers: bearer('demo-guest-token'), remoteAddress });
    expect((await from('10.0.0.1')).statusCode).toBe(200);
    expect((await from('10.0.0.2')).statusCode).toBe(200);
    expect((await from('10.0.0.1')).statusCode).toBe(429);
  });

  it('documents rate limited responses of the readiness probe', async () => {
    const instance = await start({ env: { RATE_LIMIT_PER_MINUTE: '1' } });
    await instance.inject({ method: 'GET', url: '/ready' });
    const limited = await instance.inject({ method: 'GET', url: '/ready' });
    expect(limited.statusCode).toBe(429);
    expectContract(limited, 'GET', '/ready');
  });

  it('serves interactive API documentation', async () => {
    const instance = await start();
    const response = await instance.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ openapi: '3.1.0', info: { title: 'PPshkin API' } });
  });
});

describe('quietestLevel', () => {
  it('never makes probes louder than the configured level', () => {
    expect(quietestLevel('info', 'warn')).toBe('warn');
    expect(quietestLevel('silent', 'warn')).toBe('silent');
    expect(quietestLevel('error', 'warn')).toBe('error');
  });
});

describe('trustProxyOption', () => {
  it('turns a hop count into a trust function', () => {
    const option = trustProxyOption(1);
    expect(typeof option).toBe('function');
    if (typeof option === 'function') {
      expect(option('10.0.0.1', 0)).toBe(true);
      expect(option('10.0.0.1', 1)).toBe(false);
    }
    expect(trustProxyOption(false)).toBe(false);
    expect(trustProxyOption(['10.0.0.0/8'])).toEqual(['10.0.0.0/8']);
  });
});
