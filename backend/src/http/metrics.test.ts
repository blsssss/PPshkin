import type { FastifyInstance } from 'fastify';
import { Registry } from 'prom-client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, fakeServices, testConfig } from '../../test/services.ts';
import { buildApp } from './app.ts';
import { createJobMetrics } from './metrics.ts';

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

  it('exposes background job runs recorded into the shared registry', async () => {
    const registry = new Registry();
    const jobs = createJobMetrics(registry, ['expire_bookings', 'purge_processed_updates']);
    jobs.record({
      job: 'expire_bookings',
      result: 'failed',
      durationSeconds: 0.2,
      finishedAt: new Date('2026-10-18T10:00:00Z'),
    });
    jobs.record({
      job: 'expire_bookings',
      result: 'failed',
      durationSeconds: 0.2,
      finishedAt: new Date('2026-10-18T10:01:00Z'),
    });
    jobs.record({
      job: 'expire_bookings',
      result: 'ok',
      durationSeconds: 0.05,
      finishedAt: new Date('2026-10-18T10:02:00Z'),
    });
    jobs.record({
      job: 'purge_processed_updates',
      result: 'locked',
      durationSeconds: 0.001,
      finishedAt: new Date('2026-10-18T10:02:00Z'),
    });
    jobs.record({
      job: 'purge_processed_updates',
      result: 'failed',
      durationSeconds: 1,
      finishedAt: new Date('2026-10-18T10:03:00Z'),
    });
    app = await buildApp({ config: testConfig(), services: fakeServices(), metricsRegistry: registry });

    const response = await app.inject({ method: 'GET', url: '/metrics' });

    expect(response.body).toContain('ppshkin_job_runs_total{name="expire_bookings",result="ok"} 1\n');
    expect(response.body).toContain('ppshkin_job_runs_total{name="expire_bookings",result="failed"} 2\n');
    expect(response.body).toContain('ppshkin_job_runs_total{name="expire_bookings",result="locked"} 0\n');
    expect(response.body).toContain(
      'ppshkin_job_runs_total{name="purge_processed_updates",result="locked"} 1\n',
    );
    expect(response.body).toContain('ppshkin_job_duration_seconds_count{name="expire_bookings"} 3\n');
    expect(response.body).toContain('ppshkin_job_duration_seconds_count{name="purge_processed_updates"} 1\n');
    expect(response.body).toContain(
      'ppshkin_job_last_success_timestamp_seconds{name="expire_bookings"} 1792317720\n',
    );
    expect(response.body).not.toContain(
      'ppshkin_job_last_success_timestamp_seconds{name="purge_processed_updates"}',
    );
    expect(response.body).toContain('ppshkin_job_consecutive_failures{name="expire_bookings"} 0\n');
    expect(response.body).toContain('ppshkin_job_consecutive_failures{name="purge_processed_updates"} 1\n');
  });

  it('does not measure its own scrapes', async () => {
    const instance = await start();
    await instance.inject({ method: 'GET', url: '/metrics' });
    const response = await instance.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).not.toContain('route="/metrics"');
  });
});
