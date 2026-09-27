import type { FastifyInstance, LogLevel } from 'fastify';
import { Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { MetricsService } from '../services/metrics.ts';

const BOOKING_STATUSES = ['active', 'redeemed', 'cancelled', 'expired'] as const;
const OFFER_STATUSES = ['shown', 'accepted', 'declined'] as const;

export function registerMetrics(app: FastifyInstance, metrics: MetricsService, logLevel: LogLevel): Registry {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const requestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration by route template and status code',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 45],
    registers: [registry],
  });

  const snapshots = new Map<string, number>();
  let pending: Promise<void> | null = null;
  const refresh = () => {
    pending ??= metrics
      .snapshot()
      .then((snapshot) => {
        snapshots.set('users', snapshot.users);
        snapshots.set('meals', snapshot.mealsLastDay);
        snapshots.set('deals', snapshot.activeDeals);
        for (const status of BOOKING_STATUSES)
          snapshots.set(`booking:${status}`, snapshot.bookings[status] ?? 0);
        for (const status of OFFER_STATUSES) snapshots.set(`offer:${status}`, snapshot.offers[status] ?? 0);
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };

  new Gauge({
    name: 'ppshkin_users',
    help: 'Registered users without demo accounts',
    registers: [registry],
    async collect() {
      await refresh();
      this.set(snapshots.get('users') ?? 0);
    },
  });
  new Gauge({
    name: 'ppshkin_meals_last_day',
    help: 'Diary entries created during the last 24 hours',
    registers: [registry],
    async collect() {
      await refresh();
      this.set(snapshots.get('meals') ?? 0);
    },
  });
  new Gauge({
    name: 'ppshkin_active_deals',
    help: 'Hot deals that are live and have portions left',
    registers: [registry],
    async collect() {
      await refresh();
      this.set(snapshots.get('deals') ?? 0);
    },
  });
  new Gauge({
    name: 'ppshkin_bookings',
    help: 'Bookings by status',
    labelNames: ['status'] as const,
    registers: [registry],
    async collect() {
      await refresh();
      for (const status of BOOKING_STATUSES) this.set({ status }, snapshots.get(`booking:${status}`) ?? 0);
    },
  });
  new Gauge({
    name: 'ppshkin_offers',
    help: 'Recommendation offers by status',
    labelNames: ['status'] as const,
    registers: [registry],
    async collect() {
      await refresh();
      for (const status of OFFER_STATUSES) this.set({ status }, snapshots.get(`offer:${status}`) ?? 0);
    },
  });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url;
    if (route === '/metrics') return;
    requestDuration.observe(
      { method: request.method, route: route ?? 'unmatched', status_code: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
  });

  app.get(
    '/metrics',
    { logLevel, config: { rateLimit: false }, schema: { hide: true } },
    async (_request, reply) => {
      reply.type(registry.contentType);
      return registry.metrics();
    },
  );

  return registry;
}
