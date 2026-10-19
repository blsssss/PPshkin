import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { botChat, GUEST_ID, guestWorld } from '../../test/bot.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { maxUserJson, signInitData } from '../../test/init-data.ts';
import { recordingNotifications } from '../../test/notifications.ts';
import { seedGuest } from '../../test/bookings.ts';
import { seedDeal, seedDemoVenue, seedMenuItem, seedUser, seedVenue } from '../../test/venues.ts';
import { createBot } from '../bot/index.ts';
import { purgeDealImpressionsJob } from '../jobs/purge-deal-impressions.ts';
import type { Deal, MenuItem, Venue } from '../domain/models.ts';
import { createAuthService } from './auth.ts';
import { createBookingsService } from './bookings.ts';
import { createCatalogService } from './catalog.ts';
import { createConsentsService } from './consents.ts';

const pool = testPool();
const clock = fixedClock('2026-11-03T09:00:00Z');
const catalog = createCatalogService({ pool, clock, demoMode: false });
const BOT_TOKEN = 'pilot-bot-token-0123456789';
const auth = createAuthService(
  pool,
  {
    botToken: BOT_TOKEN,
    sessionSecret: 'pilot-session-secret-0123456789abcdef',
    previousSessionSecret: null,
    sessionTtlSeconds: 3600,
    initDataMaxAgeSeconds: 3600,
    demoTokens: null,
  },
  clock,
);
const GUEST = 70101;
const HOUR = 3_600_000;
const ANYWHERE = { point: null, radiusM: 3000 };

let venue: Venue;
let eclair: MenuItem;
let deal: Deal;

async function impressions() {
  const { rows } = await pool.query<{ user_id: number | null; day: string; source: string }>(
    `select user_id, to_char(day, 'YYYY-MM-DD') as day, source from deal_impressions order by day, source`,
  );
  return rows;
}

async function acquisitionOf(userId: number) {
  const { rows } = await pool.query<{ acquisition: string | null; acquired_at: Date | null }>(
    'select acquisition, acquired_at from users where id = $1',
    [userId],
  );
  return rows[0];
}

function initData(userId: number, startParam: string | null): string {
  return signInitData(
    {
      auth_date: String(Math.floor(clock.now().getTime() / 1000)),
      user: maxUserJson(userId),
      ...(startParam === null ? {} : { start_param: startParam }),
    },
    BOT_TOKEN,
  );
}

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-11-03T09:00:00Z');
  venue = await seedVenue(pool, 70900);
  eclair = await seedMenuItem(pool, venue.id, { priceRub: 200 });
  deal = await seedDeal(pool, eclair, {
    priceRub: 120,
    startsAt: new Date(clock.now().getTime() - HOUR),
    endsAt: new Date(clock.now().getTime() + 5 * HOUR),
  });
  await seedUser(pool, GUEST);
});

afterAll(async () => {
  await closeTestPool();
});

describe('deal impressions', () => {
  it('writes one row per guest, deal and day from the hot deals list', async () => {
    await catalog.deals(GUEST, ANYWHERE);
    await catalog.deals(GUEST, ANYWHERE);
    expect(await impressions()).toEqual([{ user_id: GUEST, day: '2026-11-03', source: 'catalog' }]);

    clock.set('2026-11-04T07:00:00Z');
    await pool.query('update deals set starts_at = $2, ends_at = $3 where id = $1', [
      deal.id,
      new Date('2026-11-04T06:00:00Z'),
      new Date('2026-11-04T12:00:00Z'),
    ]);
    await catalog.deals(GUEST, ANYWHERE);
    expect((await impressions()).map((row) => row.day)).toEqual(['2026-11-03', '2026-11-04']);
  });

  it('counts the venue card and the deal card, the ones the bot opens by v_ and d_ links', async () => {
    await catalog.venue(GUEST, venue.id);
    await catalog.deal(GUEST, deal.id);
    expect(await impressions()).toEqual([{ user_id: GUEST, day: '2026-11-03', source: 'venue_card' }]);

    clock.set('2026-11-04T07:00:00Z');
    await pool.query('update deals set starts_at = $2, ends_at = $3 where id = $1', [
      deal.id,
      new Date('2026-11-04T06:00:00Z'),
      new Date('2026-11-04T12:00:00Z'),
    ]);
    await catalog.deal(GUEST, deal.id);
    expect((await impressions()).map((row) => [row.day, row.source])).toEqual([
      ['2026-11-03', 'venue_card'],
      ['2026-11-04', 'deal_card'],
    ]);
  });

  it('skips demo accounts and demo venues', async () => {
    await seedUser(pool, -1001);
    await catalog.deals(-1001, ANYWHERE);
    const demo = await seedDemoVenue(pool, 999001);
    const demoItem = await seedMenuItem(pool, demo.id);
    await seedDeal(pool, demoItem, {
      startsAt: new Date(clock.now().getTime() - HOUR),
      endsAt: new Date(clock.now().getTime() + HOUR),
    });
    await catalog.venue(GUEST, demo.id);
    expect(await impressions()).toEqual([]);
  });
});

describe('purge_deal_impressions job', () => {
  it('deletes impressions older than 90 days', async () => {
    await catalog.deals(GUEST, ANYWHERE);
    await purgeDealImpressionsJob(pool).run(new Date('2027-02-01T09:00:00Z'));
    expect(await impressions()).toHaveLength(1);
    await purgeDealImpressionsJob(pool).run(new Date('2027-02-01T09:00:01Z'));
    expect(await impressions()).toEqual([]);
  });

  it('keeps the impressions of a deleted account without the user', async () => {
    await catalog.deals(GUEST, ANYWHERE);
    await pool.query('delete from users where id = $1', [GUEST]);
    expect(await impressions()).toEqual([{ user_id: null, day: '2026-11-03', source: 'catalog' }]);
  });
});

describe('list price and channel of a booking', () => {
  it('keeps the menu price of the deal and the channel of the booking', async () => {
    await seedGuest(pool, GUEST, clock.now());
    const bookings = createBookingsService({
      pool,
      clock,
      consents: createConsentsService({ pool, clock }),
      notifications: recordingNotifications().notifications,
    });
    await bookings.create(GUEST, { menuItemId: eclair.id, dealId: deal.id }, 'miniapp');
    await pool.query('update menu_items set price_rub = 250 where id = $1', [eclair.id]);

    const { rows } = await pool.query(
      `select b.price_rub, d.list_price_rub, b.channel from bookings b join deals d on d.id = b.deal_id`,
    );
    expect(rows).toEqual([{ price_rub: 120, list_price_rub: 200, channel: 'miniapp' }]);
  });
});

describe('first link of the user', () => {
  it('keeps the start_param of the first mini app sign in and ignores the later ones', async () => {
    await auth.signInWithMax(initData(70301, 'c_kfu1'));
    clock.advance(HOUR);
    await auth.signInWithMax(initData(70301, 'venue_5'));
    expect(await acquisitionOf(70301)).toEqual({
      acquisition: 'c_kfu1',
      acquired_at: new Date('2026-11-03T09:00:00Z'),
    });
  });

  it.each([
    ['venue_5', 'venue_5'],
    ['deal_42', 'deal_42'],
    [null, 'organic'],
    ['c_KFU1', 'organic'],
    ['c_', 'organic'],
    ['booking_7', 'organic'],
  ])('records %s from the mini app as %s', async (startParam, acquisition) => {
    await auth.signInWithMax(initData(70302, startParam));
    expect((await acquisitionOf(70302))?.acquisition).toBe(acquisition);
  });

  it('keeps the payload of the first /start in the bot, accepts c_ links and leaves old users unknown', async () => {
    const world = guestWorld();
    const chat = botChat({ world, pool, createHandler: (deps) => createBot(deps) });

    await chat.start('c_kfu1');
    await chat.start('v_5');
    expect((await acquisitionOf(GUEST_ID))?.acquisition).toBe('c_kfu1');
    expect(await acquisitionOf(GUEST)).toEqual({ acquisition: null, acquired_at: null });
  });

  it('keeps an old user unknown until a tagged link is opened and then records it once', async () => {
    const world = guestWorld();
    await seedUser(pool, GUEST_ID);
    const chat = botChat({ world, pool, createHandler: (deps) => createBot(deps) });

    await chat.send('привет');
    expect(await acquisitionOf(GUEST_ID)).toEqual({ acquisition: null, acquired_at: null });
    await chat.start('c_kfu1');
    const first = await acquisitionOf(GUEST_ID);
    await chat.start('v_5');
    expect(first?.acquisition).toBe('c_kfu1');
    expect(first?.acquired_at).toBeInstanceOf(Date);
    expect(await acquisitionOf(GUEST_ID)).toEqual(first);
  });

  it('marks a first bot event without a link as organic', async () => {
    const chat = botChat({ world: guestWorld(), pool, createHandler: (deps) => createBot(deps) });

    await chat.send('привет');
    await chat.start('c_kfu1');

    expect((await acquisitionOf(GUEST_ID))?.acquisition).toBe('organic');
  });
});
