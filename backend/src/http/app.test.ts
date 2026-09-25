import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { conflict } from '../shared/errors.ts';
import { buildApp } from './app.ts';

let app: FastifyInstance | undefined;

async function start(env: Record<string, string> = {}, extend?: (instance: FastifyInstance) => void) {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', ...env });
  app = await buildApp({ config });
  extend?.(app);
  await app.ready();
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
    expect(response.json()).toEqual({ status: 'ok' });
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
    const instance = await start({}, (server) => {
      server.get('/boom', () => {
        throw conflict('already_exists', 'Already exists');
      });
    });
    const response = await instance.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'already_exists', detail: 'Already exists' });
  });

  it('hides internal error messages', async () => {
    const instance = await start({}, (server) => {
      server.get('/crash', () => {
        throw new Error('database password leaked');
      });
    });
    const response = await instance.inject({ method: 'GET', url: '/crash' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'internal_error', detail: 'Internal server error' });
    expect(response.body).not.toContain('password');
  });

  it('reports malformed JSON bodies as client errors', async () => {
    const instance = await start({}, (server) => {
      server.post('/echo', (request) => request.body);
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
    const instance = await start({ CORS_ORIGINS: 'https://app.example' });
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
    const instance = await start({ RATE_LIMIT_PER_MINUTE: '1' }, (server) => {
      server.get('/ip', (request) => ({ ip: request.ip }));
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
    const instance = await start({ TRUST_PROXY: 'true' }, (server) => {
      server.get('/ip', (request) => ({ ip: request.ip }));
    });
    const response = await instance.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    expect(response.json<{ ip: string }>().ip).toBe('10.0.0.1');
  });

  it('limits request rate with a problem response', async () => {
    const instance = await start({ RATE_LIMIT_PER_MINUTE: '2' }, (server) => {
      server.get('/limited', () => ({ ok: true }));
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect((await instance.inject({ method: 'GET', url: '/limited' })).statusCode).toBe(200);
    }
    const response = await instance.inject({ method: 'GET', url: '/limited' });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: 'rate_limited' });
  });
});
