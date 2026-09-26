import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedBooking, seedOffer } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedDeal, seedMenuItem, seedUser, seedVenue } from '../../test/venues.ts';
import type { MenuItem } from '../domain/models.ts';
import { createAnalyticsService } from './analytics.ts';
import { createMenuService } from './menu.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const service = createAnalyticsService({ pool, clock });

const OWNER = 202;
const OTHER_OWNER = 303;
const GUEST = 101;

const at = (iso: string) => new Date(iso);
const zeroDay = (date: string) => ({
  date,
  offersShown: 0,
  offersAccepted: 0,
  bookingsCreated: 0,
  bookingsRedeemed: 0,
  revenueRub: 0,
});

let latte: MenuItem;
let eclair: MenuItem;
let tart: MenuItem;
let achma: MenuItem;
let bun: MenuItem;

beforeAll(async () => {
  await resetDatabase(pool);
  await seedUser(pool, GUEST);
  const venue = await seedVenue(pool, OWNER, { timezone: 'Asia/Yekaterinburg' });
  eclair = await seedMenuItem(pool, venue.id, { name: 'Эклер', priceRub: 200 });
  tart = await seedMenuItem(pool, venue.id, { name: 'Тарт', priceRub: 250 });
  latte = await seedMenuItem(pool, venue.id, { name: 'Латте', category: 'drink', priceRub: 180 });
  achma = await seedMenuItem(pool, venue.id, { name: 'Ачма', category: 'bakery', priceRub: 100 });
  bun = await seedMenuItem(pool, venue.id, { name: 'Булочка', category: 'bakery', priceRub: 100 });
  const waffle = await seedMenuItem(pool, venue.id, { name: 'Вафля', priceRub: 100 });
  const eclairDeal = await seedDeal(pool, eclair, {
    priceRub: 130,
    startsAt: at('2026-09-20T09:00:00Z'),
    endsAt: at('2026-09-20T20:00:00Z'),
  });
  const tartDeal = await seedDeal(pool, tart, {
    priceRub: 150,
    startsAt: at('2026-09-22T09:00:00Z'),
    endsAt: at('2026-09-22T20:00:00Z'),
  });
  const foreignItem = await seedMenuItem(pool, (await seedVenue(pool, OTHER_OWNER)).id);

  const offers: [MenuItem, string, 'shown' | 'accepted' | 'declined', number | null][] = [
    [eclair, '2026-09-20T18:59:00Z', 'accepted', GUEST],
    [eclair, '2026-09-21T10:00:00Z', 'shown', GUEST],
    [tart, '2026-09-21T11:00:00Z', 'accepted', GUEST],
    [latte, '2026-09-22T19:00:00Z', 'accepted', null],
    [achma, '2026-09-23T05:00:00Z', 'declined', GUEST],
    [eclair, '2026-09-25T08:00:00Z', 'accepted', GUEST],
    [foreignItem, '2026-09-22T10:00:00Z', 'accepted', GUEST],
  ];
  for (const [item, createdAt, status, userId] of offers) {
    await seedOffer(pool, { userId, item, createdAt: at(createdAt), status });
  }

  const bookings: [
    MenuItem,
    string,
    'active' | 'redeemed' | 'cancelled' | 'expired',
    number | null,
    number,
    number | null,
  ][] = [
    [eclair, '2026-09-20T18:59:00Z', 'redeemed', eclairDeal.id, 130, GUEST],
    [eclair, '2026-09-21T12:00:00Z', 'redeemed', eclairDeal.id, 130, GUEST],
    [tart, '2026-09-21T13:00:00Z', 'expired', null, 250, GUEST],
    [latte, '2026-09-21T19:00:00Z', 'redeemed', null, 180, GUEST],
    [eclair, '2026-09-22T10:00:00Z', 'cancelled', null, 200, GUEST],
    [tart, '2026-09-22T11:00:00Z', 'redeemed', tartDeal.id, 150, GUEST],
    [eclair, '2026-09-22T12:00:00Z', 'redeemed', eclairDeal.id, 130, null],
    [latte, '2026-09-22T18:59:00Z', 'redeemed', null, 180, GUEST],
    [achma, '2026-09-23T06:00:00Z', 'redeemed', null, 100, GUEST],
    [waffle, '2026-09-23T07:00:00Z', 'redeemed', null, 100, GUEST],
    [bun, '2026-09-23T08:00:00Z', 'redeemed', null, 100, GUEST],
    [eclair, '2026-09-25T08:30:00Z', 'active', null, 200, GUEST],
    [eclair, '2026-09-25T19:00:00Z', 'redeemed', null, 200, GUEST],
    [foreignItem, '2026-09-22T10:00:00Z', 'redeemed', null, 100, GUEST],
  ];
  for (const [item, createdAt, status, dealId, priceRub, userId] of bookings) {
    await seedBooking(pool, {
      userId,
      item,
      code: 'ABCDE2',
      createdAt: at(createdAt),
      status,
      dealId,
      priceRub,
      expiresAt: at('2026-09-26T09:00:00Z'),
    });
  }
  await createMenuService({ pool, clock }).update(OWNER, achma.id, { name: 'Ачма с сыром' });
});

afterAll(async () => {
  await closeTestPool();
});

describe('venue analytics', () => {
  it('counts offers, bookings and revenue by local day of creation', async () => {
    expect(await service.get(OWNER, { from: '2026-09-21', to: '2026-09-25' })).toEqual({
      from: '2026-09-21',
      to: '2026-09-25',
      timezone: 'Asia/Yekaterinburg',
      offersShown: 5,
      offersAccepted: 3,
      bookingsCreated: 11,
      bookingsRedeemed: 8,
      bookingsExpired: 1,
      bookingsCancelled: 1,
      acceptRate: 0.6,
      redeemRate: 0.73,
      revenueRub: 1070,
      surplusUnitsSold: 3,
      surplusRevenueRub: 410,
      topItems: [
        { menuItemId: latte.id, name: 'Латте', redeemed: 2, revenueRub: 360 },
        { menuItemId: eclair.id, name: 'Эклер', redeemed: 2, revenueRub: 260 },
        { menuItemId: tart.id, name: 'Тарт', redeemed: 1, revenueRub: 150 },
        { menuItemId: achma.id, name: 'Ачма с сыром', redeemed: 1, revenueRub: 100 },
        { menuItemId: bun.id, name: 'Булочка', redeemed: 1, revenueRub: 100 },
      ],
      byDay: [
        {
          date: '2026-09-21',
          offersShown: 2,
          offersAccepted: 1,
          bookingsCreated: 2,
          bookingsRedeemed: 1,
          revenueRub: 130,
        },
        {
          date: '2026-09-22',
          offersShown: 0,
          offersAccepted: 0,
          bookingsCreated: 5,
          bookingsRedeemed: 4,
          revenueRub: 640,
        },
        {
          date: '2026-09-23',
          offersShown: 2,
          offersAccepted: 1,
          bookingsCreated: 3,
          bookingsRedeemed: 3,
          revenueRub: 300,
        },
        zeroDay('2026-09-24'),
        {
          date: '2026-09-25',
          offersShown: 1,
          offersAccepted: 1,
          bookingsCreated: 1,
          bookingsRedeemed: 0,
          revenueRub: 0,
        },
      ],
    });
  });

  it('covers the last 7 local days including today by default', async () => {
    const analytics = await service.get(OWNER, {});
    expect(analytics).toMatchObject({
      from: '2026-09-19',
      to: '2026-09-25',
      offersShown: 6,
      offersAccepted: 4,
      bookingsCreated: 12,
      bookingsRedeemed: 9,
      revenueRub: 1200,
      surplusUnitsSold: 4,
      surplusRevenueRub: 540,
    });
    expect(analytics.byDay.map((day) => day.date)).toEqual([
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
    ]);
    expect(analytics.byDay[1]).toEqual({
      ...zeroDay('2026-09-20'),
      offersShown: 1,
      offersAccepted: 1,
      bookingsCreated: 1,
      bookingsRedeemed: 1,
      revenueRub: 130,
    });
    expect((await service.get(OWNER, { from: '2026-09-24' })).byDay.map((day) => day.date)).toEqual([
      '2026-09-24',
      '2026-09-25',
    ]);
    expect(await service.get(OWNER, { to: '2026-09-22' })).toMatchObject({
      from: '2026-09-16',
      to: '2026-09-22',
    });
  });

  it('reports zeros for a quiet period', async () => {
    expect(await service.get(OWNER, { from: '2026-09-24', to: '2026-09-24' })).toMatchObject({
      offersShown: 0,
      bookingsCreated: 0,
      acceptRate: 0,
      redeemRate: 0,
      revenueRub: 0,
      topItems: [],
      byDay: [zeroDay('2026-09-24')],
    });
  });

  it('allows periods of up to 92 days', async () => {
    const longest = await service.get(OWNER, { from: '2026-06-26', to: '2026-09-25' });
    expect(longest.byDay).toHaveLength(92);
    expect(longest.bookingsCreated).toBe(12);
    for (const period of [
      { from: '2026-06-25', to: '2026-09-25' },
      { from: '2026-09-25', to: '2026-09-24' },
      { from: '2026-09-26' },
    ]) {
      await expect(service.get(OWNER, period)).rejects.toMatchObject({ status: 400, code: 'invalid_period' });
    }
  });

  it('validates dates and needs a venue', async () => {
    await expect(service.get(OWNER, { from: '2026-02-30', to: '25.09.2026' })).rejects.toMatchObject({
      status: 400,
      code: 'validation_failed',
      details: [
        { path: 'from', message: 'must be a calendar date in YYYY-MM-DD format' },
        { path: 'to', message: 'must be a calendar date in YYYY-MM-DD format' },
      ],
    });
    await expect(service.get(GUEST, { to: 'today' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(service.get(GUEST, {})).rejects.toMatchObject({ status: 404, code: 'venue_not_found' });
  });
});
