import { describe, expect, it, vi } from 'vitest';
import { fakeLogger } from '../../test/max-api.ts';
import { fakeServices } from '../../test/services.ts';
import type { Queryable } from '../db/pool.ts';
import { createJobs, type JobsDependencies } from './index.ts';

const db: Queryable = { query: () => Promise.reject(new Error('the database is not used here')) };

function jobs(
  flags: { DEMO_MODE?: boolean; PROACTIVE_OFFERS?: boolean },
  extra: Partial<JobsDependencies> = {},
) {
  return createJobs({
    config: { DEMO_MODE: false, PROACTIVE_OFFERS: false, ...flags },
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
    });
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

  it('expires bookings across all guests and venues', async () => {
    const expireDue = vi.fn(() => Promise.resolve([]));
    const expire = createJobs({
      config: { DEMO_MODE: false, PROACTIVE_OFFERS: false },
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
