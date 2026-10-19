import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedOffer } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { fakeLogger } from '../../test/max-api.ts';
import { seedMenuItem, seedUser, seedVenue } from '../../test/venues.ts';
import { jsonb } from '../db/pool.ts';
import type { MenuItem } from '../domain/models.ts';
import { monthsBefore } from '../domain/retention.ts';
import { createOutbox } from '../notifications/outbox.ts';
import * as audit from '../repositories/audit.ts';
import * as users from '../repositories/users.ts';
import { createAccountService } from '../services/account.ts';
import { createAnalyticsService } from '../services/analytics.ts';
import { createBookingsService } from '../services/bookings.ts';
import { createConsentsService } from '../services/consents.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { purgeRetentionJob } from './purge-retention.ts';

const pool = testPool();
const NOW = '2026-09-25T09:00:00Z';
const clock = fixedClock(NOW);
const SECOND = 1000;
const DAY = 86_400_000;
const OWNER = 202;
const GUEST = 101;

const notifications = createOutbox({
  pool,
  clock,
  bot: () => null,
  miniAppEnabled: false,
  diaryDay: () => Promise.reject(new Error('diary is not used here')),
  reports: {
    build: () => Promise.reject(new Error('reports are not used here')),
    file: () => Promise.reject(new Error('reports are not used here')),
  },
  background: createBackgroundTasks({ error: () => undefined }),
  logger: fakeLogger(),
});
const account = createAccountService({ pool, clock, notifications });

function job(purgeInactiveAccounts: boolean) {
  return purgeRetentionJob({ db: pool, account, notifications, purgeInactiveAccounts, logger: fakeLogger() });
}

const ago = (ms: number) => new Date(clock.now().getTime() - ms);

let item: MenuItem;

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set(NOW);
  const venue = await seedVenue(pool, OWNER);
  item = await seedMenuItem(pool, venue.id);
  await seedUser(pool, GUEST);
});

afterAll(async () => {
  await closeTestPool();
});

describe('purge_retention', () => {
  it('clears offer explanations older than 90 days and keeps the offers in the venue statistics', async () => {
    const old = await seedOffer(pool, { userId: GUEST, item, createdAt: ago(90 * DAY + SECOND) });
    const edge = await seedOffer(pool, { userId: GUEST, item, createdAt: ago(90 * DAY) });
    await pool.query(`update offers set explanation = $1::jsonb`, [jsonb({ headline: 'Можно десерт' })]);

    await job(false).run(clock.now());

    const { rows } = await pool.query<{ id: number; explanation: object }>(
      'select id, explanation from offers order by id',
    );
    expect(rows).toEqual([
      { id: old, explanation: {} },
      { id: edge, explanation: { headline: 'Можно десерт' } },
    ]);
    const analytics = createAnalyticsService({
      pool,
      clock,
      bookings: createBookingsService({
        pool,
        clock,
        consents: createConsentsService({ pool, clock }),
        notifications,
      }),
    });
    const stats = await analytics.get({ userId: OWNER }, { from: '2026-06-26', to: '2026-09-25' });
    expect(stats.offersShown).toBe(2);
  });

  it('deletes dialog states untouched for 7 days, but not those of demo accounts', async () => {
    await seedUser(pool, GUEST + 1);
    await seedUser(pool, -1001);
    for (const [userId, at] of [
      [GUEST, ago(7 * DAY + SECOND)],
      [GUEST + 1, ago(7 * DAY)],
      [-1001, ago(30 * DAY)],
    ] as const) {
      await pool.query(`insert into chat_states (user_id, state, updated_at) values ($1, '{}'::jsonb, $2)`, [
        userId,
        at,
      ]);
    }

    await job(false).run(clock.now());

    const { rows } = await pool.query<{ user_id: number }>(
      'select user_id from chat_states order by user_id',
    );
    expect(rows.map((row) => row.user_id)).toEqual([-1001, GUEST + 1]);
  });

  it('deletes audit records older than a year', async () => {
    const venueId = item.venueId;
    for (const at of [ago(365 * DAY + SECOND), ago(365 * DAY)]) {
      await audit.record(
        pool,
        {
          venueId,
          actorUserId: OWNER,
          action: 'venue.update',
          target: { type: 'venue', id: venueId },
          channel: 'bot',
          details: {},
        },
        at,
      );
    }

    await job(false).run(clock.now());

    const { rows } = await pool.query<{ count: number }>('select count(*)::int as count from audit_events');
    expect(rows[0]?.count).toBe(1);
  });
});

describe('inactive accounts', () => {
  async function seenAt(userId: number, at: Date) {
    await pool.query('update users set last_seen_at = $2 where id = $1', [userId, at]);
  }

  async function warnings(userId: number) {
    const { rows } = await pool.query<{ count: number }>(
      `select count(*)::int as count from notifications where user_id = $1 and kind = 'account_inactive_warning'`,
      [userId],
    );
    return rows[0]?.count ?? 0;
  }

  async function exists(userId: number) {
    return (await users.findById(pool, userId)) !== null;
  }

  it('does nothing while PURGE_INACTIVE_ACCOUNTS is off', async () => {
    await seenAt(GUEST, monthsBefore(clock.now(), 19));

    await job(false).run(clock.now());

    expect(await warnings(GUEST)).toBe(0);
    expect(await exists(GUEST)).toBe(true);
  });

  it('warns once 14 days before and then deletes the account', async () => {
    await seenAt(GUEST, new Date(monthsBefore(clock.now(), 18).getTime() + 13 * DAY));
    await seedUser(pool, -1001);
    await seenAt(-1001, monthsBefore(clock.now(), 30));
    await seedUser(pool, GUEST + 1);
    await seenAt(GUEST + 1, new Date(monthsBefore(clock.now(), 18).getTime() + 15 * DAY));

    await job(true).run(clock.now());
    await job(true).run(clock.now());
    expect(await warnings(GUEST)).toBe(1);
    expect(await warnings(GUEST + 1)).toBe(0);
    expect(await warnings(-1001)).toBe(0);

    clock.advance(13 * DAY);
    await job(true).run(clock.now());
    expect(await exists(GUEST)).toBe(true);

    clock.advance(DAY);
    await job(true).run(clock.now());
    expect(await exists(GUEST)).toBe(false);
    expect(await exists(-1001)).toBe(true);
  });

  it('keeps the account when the user comes back after the warning', async () => {
    await seenAt(GUEST, new Date(monthsBefore(clock.now(), 18).getTime() + 13 * DAY));
    await job(true).run(clock.now());
    expect(await warnings(GUEST)).toBe(1);

    clock.advance(DAY);
    await users.touchLastSeen(pool, GUEST, clock.now(), 3_600_000);
    clock.advance(20 * DAY);
    await job(true).run(clock.now());

    expect(await exists(GUEST)).toBe(true);
    expect(await warnings(GUEST)).toBe(1);
  });

  it('updates the last visit at most once an hour', async () => {
    await users.touchLastSeen(pool, GUEST, clock.now(), 3_600_000);
    const first = await users.lastActiveAt(pool, GUEST);
    clock.advance(59 * 60_000);
    await users.touchLastSeen(pool, GUEST, clock.now(), 3_600_000);
    expect(await users.lastActiveAt(pool, GUEST)).toEqual(first);
    clock.advance(60_000);
    await users.touchLastSeen(pool, GUEST, clock.now(), 3_600_000);
    expect(await users.lastActiveAt(pool, GUEST)).toEqual(clock.now());
  });
});
