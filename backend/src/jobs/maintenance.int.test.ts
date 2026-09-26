import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedGuest } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { fakeLogger } from '../../test/max-api.ts';
import { testConfig } from '../../test/services.ts';
import { seedDeal, seedMenuItem, seedVenue } from '../../test/venues.ts';
import { createServices } from '../container.ts';
import type { Notifier } from '../ports/notifier.ts';
import { createRecognition } from '../recognition/index.ts';
import * as menuImports from '../repositories/menu-imports.ts';
import { createMenuImportsService } from '../services/menu-imports.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { failStaleImportsJob } from './fail-stale-imports.ts';
import { createJobs } from './index.ts';
import { purgeProcessedUpdatesJob } from './purge-processed-updates.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const OWNER = 202;
const GUEST = 101;

const ago = (ms: number) => new Date(clock.now().getTime() - ms);

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-25T09:00:00Z');
});

afterAll(async () => {
  await closeTestPool();
});

describe('expire_bookings job', () => {
  const notifier = {
    bookingCreated: vi.fn<Notifier['bookingCreated']>(() => Promise.resolve()),
    bookingCancelled: vi.fn<Notifier['bookingCancelled']>(() => Promise.resolve()),
    bookingRedeemed: vi.fn<Notifier['bookingRedeemed']>(() => Promise.resolve()),
    bookingExpired: vi.fn<Notifier['bookingExpired']>(() => Promise.resolve()),
  } satisfies Notifier;
  const config = testConfig();
  const background = createBackgroundTasks({ error: () => undefined });
  const services = createServices({
    config,
    pool,
    clock,
    recognition: createRecognition({
      apiKey: undefined,
      baseUrl: config.CHADGPT_BASE_URL,
      visionModel: config.CHADGPT_MODEL,
      fallbackModel: config.CHADGPT_FALLBACK_MODEL,
      timeoutMs: config.CHADGPT_TIMEOUT_MS,
      menuTimeoutMs: config.CHADGPT_MENU_TIMEOUT_MS,
    }),
    background,
    notifier,
  });
  const { bookings } = services;
  const job = createJobs({ config, db: pool, services, messenger: () => null, logger: fakeLogger() }).find(
    (registered) => registered.name === 'expire_bookings',
  );
  const runJob = () => job?.run(clock.now());

  async function dealStock(dealId: number): Promise<number | undefined> {
    const { rows } = await pool.query<{ quantity_left: number }>(
      'select quantity_left from deals where id = $1',
      [dealId],
    );
    return rows[0]?.quantity_left;
  }

  it('expires due bookings, returns the portion and tells the guest once', async () => {
    const venue = await seedVenue(pool, OWNER);
    const eclair = await seedMenuItem(pool, venue.id);
    const deal = await seedDeal(pool, eclair, { quantity: 3, startsAt: ago(HOUR), endsAt: ago(-5 * HOUR) });
    await seedGuest(pool, GUEST, ago(DAY));
    const { booking } = await bookings.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    expect(await dealStock(deal.id)).toBe(2);
    await background.idle();
    expect(notifier.bookingCreated).toHaveBeenCalledTimes(1);

    clock.advance(59 * MINUTE);
    await runJob();
    expect((await bookings.get(GUEST, booking.id)).booking.status).toBe('active');

    clock.advance(MINUTE);
    await runJob();
    await background.idle();

    const { rows } = await pool.query<{ status: string; resolved_at: Date }>(
      'select status, resolved_at from bookings where id = $1',
      [booking.id],
    );
    expect(rows).toEqual([{ status: 'expired', resolved_at: clock.now() }]);
    expect(await dealStock(deal.id)).toBe(3);
    expect(notifier.bookingExpired).toHaveBeenCalledTimes(1);
    expect(notifier.bookingExpired).toHaveBeenCalledWith({
      booking: expect.objectContaining({ id: booking.id, status: 'expired' }) as unknown,
      venue: expect.objectContaining({ id: venue.id, ownerId: OWNER }) as unknown,
    });

    clock.advance(MINUTE);
    await runJob();
    await background.idle();
    expect(await dealStock(deal.id)).toBe(3);
    expect(notifier.bookingExpired).toHaveBeenCalledTimes(1);
  });
});

describe('fail_stale_imports job', () => {
  const job = failStaleImportsJob(pool);
  const service = createMenuImportsService({
    pool,
    clock,
    menus: {
      fromPhoto: () => Promise.reject(new Error('menus.fromPhoto is not stubbed')),
      fromText: () => Promise.reject(new Error('menus.fromText is not stubbed')),
    },
    background: createBackgroundTasks({ error: () => undefined }),
  });

  async function importRow(id: number) {
    const { rows } = await pool.query<{ status: string; error: string | null; completed_at: Date | null }>(
      'select status, error, completed_at from menu_imports where id = $1',
      [id],
    );
    return rows[0];
  }

  it('fails imports stuck in processing for more than 30 minutes the way reads already show them', async () => {
    const venue = await seedVenue(pool, OWNER);
    const stale = await menuImports.insert(pool, venue.id, 'photo', ago(31 * MINUTE));
    const recent = await menuImports.insert(pool, venue.id, 'text', ago(29 * MINUTE));
    const ready = await menuImports.insert(pool, venue.id, 'text', ago(40 * MINUTE));
    await menuImports.complete(
      pool,
      ready.id,
      { status: 'ready', items: [], error: null, model: 'gpt-6-luna' },
      ago(39 * MINUTE),
      new Date(0),
    );

    const shownBefore = await service.get(OWNER, stale.id);
    await job.run(clock.now());

    expect(await service.get(OWNER, stale.id)).toEqual(shownBefore);
    expect(await importRow(stale.id)).toEqual({
      status: 'failed',
      error: 'Не успели распознать меню, попробуйте фото получше или вставьте текст',
      completed_at: new Date(stale.createdAt.getTime() + 30 * MINUTE),
    });
    expect(await importRow(recent.id)).toEqual({ status: 'processing', error: null, completed_at: null });
    expect(await importRow(ready.id)).toEqual({
      status: 'ready',
      error: null,
      completed_at: ago(39 * MINUTE),
    });

    await job.run(clock.now());
    expect((await importRow(stale.id))?.completed_at).toEqual(
      new Date(stale.createdAt.getTime() + 30 * MINUTE),
    );
  });

  it('keeps an import that reached exactly 30 minutes', async () => {
    const venue = await seedVenue(pool, OWNER);
    const boundary = await menuImports.insert(pool, venue.id, 'photo', ago(30 * MINUTE));

    expect(await menuImports.failStale(pool, clock.now())).toBe(0);
    expect((await importRow(boundary.id))?.status).toBe('processing');
  });
});

describe('purge_processed_updates job', () => {
  const job = purgeProcessedUpdatesJob(pool);

  it('deletes processed update keys older than two days', async () => {
    const seeded: [string, Date][] = [
      ['old', ago(3 * DAY)],
      ['just-over', ago(2 * DAY + SECOND)],
      ['just-under', ago(2 * DAY - SECOND)],
      ['fresh', ago(HOUR)],
    ];
    for (const [key, at] of seeded) {
      await pool.query('insert into processed_updates (key, processed_at) values ($1, $2)', [key, at]);
    }

    await job.run(clock.now());

    const { rows } = await pool.query<{ key: string }>('select key from processed_updates order by key');
    expect(rows.map((row) => row.key)).toEqual(['fresh', 'just-under']);
  });
});
