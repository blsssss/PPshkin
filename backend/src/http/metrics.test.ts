import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../test/services.ts';

let app: FastifyInstance | undefined;

async function start() {
  app = await buildTestApp();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /metrics', () => {
  it('exposes request, runtime and domain metrics in the Prometheus text format', async () => {
    const instance = await start();
    await instance.inject({ method: 'GET', url: '/health' });
    const response = await instance.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toMatch(
      /http_request_duration_seconds_count\{method="GET",route="\/health",status_code="200"\} 1\n/,
    );
    expect(response.body).toContain('process_cpu_seconds_total');
    expect(response.body).toContain('ppshkin_users 3\n');
    expect(response.body).toContain('ppshkin_meals_last_day 5\n');
    expect(response.body).toContain('ppshkin_active_deals 2\n');
    expect(response.body).toContain('ppshkin_bookings{status="redeemed"} 4\n');
    expect(response.body).toContain('ppshkin_bookings{status="active"} 0\n');
    expect(response.body).toContain('ppshkin_offers{status="shown"} 7\n');
  });

  it('labels unknown paths as unmatched so raw paths never become label values', async () => {
    const instance = await start();
    await instance.inject({ method: 'GET', url: '/no/such/path/123' });
    const response = await instance.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).toMatch(/route="unmatched",status_code="404"/);
    expect(response.body).not.toContain('/no/such/path');
  });

  it('does not measure its own scrapes', async () => {
    const instance = await start();
    await instance.inject({ method: 'GET', url: '/metrics' });
    const response = await instance.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).not.toContain('route="/metrics"');
  });
});
