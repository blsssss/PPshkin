import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../test/services.ts';
import { createNotificationStats } from '../notifications/stats.ts';

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
    expect(response.body).toContain('ppshkin_notifications_pending 4\n');
    expect(response.body).toContain('ppshkin_notifications_oldest_pending_seconds 12.5\n');
  });

  it('counts delivered and failed notifications and the delivery delay', async () => {
    const notificationStats = createNotificationStats();
    notificationStats.delivered('venue_booking_created', 1.5);
    notificationStats.finished('booking_reminder', 'failed');
    notificationStats.finished('booking_reminder', 'expired');
    app = await buildTestApp({ notificationStats });

    const { body } = await app.inject({ method: 'GET', url: '/metrics' });

    expect(body).toContain('ppshkin_notifications_total{kind="venue_booking_created",result="sent"} 1\n');
    expect(body).toContain('ppshkin_notifications_total{kind="booking_reminder",result="failed"} 1\n');
    expect(body).toContain('ppshkin_notifications_total{kind="booking_reminder",result="expired"} 1\n');
    expect(body).toContain(
      'ppshkin_notification_delay_seconds_bucket{le="2",kind="venue_booking_created"} 1\n',
    );
    expect(body).toContain('ppshkin_notification_delay_seconds_count{kind="venue_booking_created"} 1\n');
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
