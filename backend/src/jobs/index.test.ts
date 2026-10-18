import { describe, expect, it, vi } from 'vitest';
import { fakeLogger } from '../../test/max-api.ts';
import { fakeServices } from '../../test/services.ts';
import type { Queryable } from '../db/pool.ts';
import { createJobs, type JobsDependencies } from './index.ts';

const db: Queryable = { query: () => Promise.reject(new Error('the database is not used here')) };

function jobs(flags: Partial<JobsDependencies['config']>, extra: Partial<JobsDependencies> = {}) {
  return createJobs({
    config: { BOT_MODE: 'polling', DEMO_MODE: false, PROACTIVE_OFFERS: false, ...flags },
    db,
    services: fakeServices(),
    messenger: () => null,
    logger: fakeLogger(),
    ...extra,
  });
}

const schedules = (list: ReturnType<typeof jobs>) =>
  Object.fromEntries(list.map((job) => [job.name, job.schedule]));

describe('createJobs', () => {
  it('registers the maintenance jobs with their schedules by default', () => {
    expect(schedules(jobs({}))).toEqual({
      expire_bookings: { everyMs: 60_000 },
      fail_stale_imports: { everyMs: 300_000 },
      purge_processed_updates: { everyMs: 3_600_000 },
      purge_notifications: { dailyAt: '04:30', timeZone: 'Europe/Moscow' },
    });
  });

  it('delivers and reminds through the notification queue only when the bot can send', async () => {
    const outbox = {
      enqueue: vi.fn(() => Promise.resolve()),
      flush: vi.fn(),
      deliverDue: vi.fn(() =>
        Promise.resolve({ sent: 0, skipped: 0, unreachable: 0, failed: 0, expired: 0, retried: 0 }),
      ),
    };
    const names = (list: ReturnType<typeof jobs>) => list.map((job) => job.name);

    expect(names(jobs({}))).not.toContain('deliver_notifications');
    expect(schedules(jobs({}, { outbox }))).toMatchObject({
      deliver_notifications: { everyMs: 15_000 },
      booking_reminders: { everyMs: 60_000 },
      deal_ending_reminders: { everyMs: 300_000 },
    });

    const now = new Date('2026-09-26T09:00:00Z');
    await jobs({}, { outbox })
      .find((job) => job.name === 'deliver_notifications')
      ?.run(now);
    expect(outbox.deliverDue).toHaveBeenCalledExactlyOnceWith(now);
  });

  it('leaves proactive offers out unless PROACTIVE_OFFERS is on', () => {
    expect(jobs({ PROACTIVE_OFFERS: false }).map((job) => job.name)).not.toContain('proactive_offers');
    expect(schedules(jobs({ PROACTIVE_OFFERS: true }))).toMatchObject({
      proactive_offers: { everyMs: 900_000 },
    });
  });

  it('refreshes demo data daily at 06:00 in Moscow only in demo mode', async () => {
    const demo = { refresh: vi.fn(() => Promise.resolve({ venues: 6 })) };
    const logger = fakeLogger();

    expect(jobs({ DEMO_MODE: false }, { demo }).map((job) => job.name)).not.toContain('refresh_demo_data');
    expect(jobs({ DEMO_MODE: true }).map((job) => job.name)).not.toContain('refresh_demo_data');

    const refresh = jobs({ DEMO_MODE: true }, { demo, logger }).find(
      (job) => job.name === 'refresh_demo_data',
    );
    expect(refresh?.schedule).toEqual({ dailyAt: '06:00', timeZone: 'Europe/Moscow' });
    await refresh?.run(new Date('2026-09-26T03:00:00Z'));
    expect(demo.refresh).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ demo: { venues: 6 } }, 'demo data refreshed');
  });

  it('guards the MAX webhook subscription every 10 minutes only in webhook mode', async () => {
    const webhookGuard = { check: vi.fn(() => Promise.resolve('restored' as const)) };

    for (const mode of ['polling', 'off'] as const) {
      expect(jobs({ BOT_MODE: mode }, { webhookGuard }).map((job) => job.name)).not.toContain(
        'max_webhook_guard',
      );
    }
    expect(jobs({ BOT_MODE: 'webhook' }).map((job) => job.name)).not.toContain('max_webhook_guard');

    const guard = jobs({ BOT_MODE: 'webhook' }, { webhookGuard }).find(
      (job) => job.name === 'max_webhook_guard',
    );
    expect(guard?.schedule).toEqual({ everyMs: 600_000 });
    await guard?.run(new Date('2026-09-26T09:00:00Z'));
    expect(webhookGuard.check).toHaveBeenCalledTimes(1);
  });

  it('lets a failed webhook check reach the scheduler', async () => {
    const failure = new Error('MAX answered with status 500');
    const guard = jobs(
      { BOT_MODE: 'webhook' },
      { webhookGuard: { check: vi.fn(() => Promise.reject(failure)) } },
    ).find((job) => job.name === 'max_webhook_guard');

    await expect(guard?.run(new Date('2026-09-26T09:00:00Z'))).rejects.toBe(failure);
  });

  it('expires bookings across all guests and venues', async () => {
    const expireDue = vi.fn(() => Promise.resolve([]));
    const expire = createJobs({
      config: { BOT_MODE: 'polling', DEMO_MODE: false, PROACTIVE_OFFERS: false },
      db,
      services: fakeServices({
        bookings: { ...fakeServices().bookings, expireDue },
      }),
      messenger: () => null,
      logger: fakeLogger(),
    }).find((job) => job.name === 'expire_bookings');

    await expire?.run(new Date('2026-09-26T09:00:00Z'));

    expect(expireDue).toHaveBeenCalledWith({});
  });
});
