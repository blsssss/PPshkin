import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedBooking, seedOffer } from '../../test/bookings.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedDeal, seedDemoVenue, seedMenuItem, seedUser, seedVenue } from '../../test/venues.ts';
import type { MenuItem } from '../domain/models.ts';
import * as deals from '../repositories/deals.ts';
import * as users from '../repositories/users.ts';
import { buildPilotReport, renderPilotReport, type PilotReport } from './pilot-report.ts';

const pool = testPool();
const NOW = new Date('2026-11-20T12:00:00Z');
const PERIOD = { from: '2026-11-02', to: '2026-11-08', venueId: null };
const OWNER_A = 70900;
const OWNER_B = 70901;
const G1 = 70101;
const G2 = 70102;
const G3 = 70103;
const DEMO = -1001;
const R1 = 70201;
const R2 = 70202;
const R3 = 70203;
const R4 = 70204;

let venueA: number;
let venueB: number;
let report: PilotReport;

const at = (iso: string) => new Date(iso);

async function meal(userId: number, createdAt: string, source = 'manual'): Promise<void> {
  await pool.query(
    `insert into meals (user_id, title, kcal_min, kcal_max, source, eaten_at, created_at)
     values ($1, 'Сырники', 300, 400, $2, $3, $3)`,
    [userId, source, at(createdAt)],
  );
}

async function signedUp(userId: number, acquisition: string, createdAt: string, timezone = 'Europe/Moscow') {
  await users.upsert(pool, {
    id: userId,
    firstName: null,
    username: null,
    acquisition: { source: acquisition, at: at(createdAt) },
  });
  await pool.query('update users set created_at = $2, timezone = $3 where id = $1', [
    userId,
    at(createdAt),
    timezone,
  ]);
}

async function seed(): Promise<void> {
  const a = await seedVenue(pool, OWNER_A, { name: 'Зерно, на Баумана' });
  const b = await seedVenue(pool, OWNER_B, { name: 'Пекарня «Б»' });
  venueA = a.id;
  venueB = b.id;
  const demo = await seedDemoVenue(pool, 999001);
  const eclair = await seedMenuItem(pool, a.id, { name: 'Эклер', priceRub: 200 });
  const bun = await seedMenuItem(pool, b.id, { name: 'Булка', priceRub: 100 });
  const demoItem = await seedMenuItem(pool, demo.id, { name: 'Демо', priceRub: 100 });
  for (const id of [G1, G2, G3, DEMO]) await seedUser(pool, id);
  await pool.query(`update users set created_at = '2026-10-01T00:00:00Z' where id > 0`);

  const dA1 = await seedDeal(pool, eclair, {
    priceRub: 120,
    quantity: 10,
    startsAt: at('2026-11-03T09:00:00Z'),
    endsAt: at('2026-11-03T18:00:00Z'),
  });
  const dA2 = await seedDeal(pool, eclair, {
    quantity: 5,
    startsAt: at('2026-11-04T09:00:00Z'),
    endsAt: at('2026-11-04T18:00:00Z'),
  });
  await deals.cancelLiveInVenue(pool, a.id, dA2.id, at('2026-11-04T10:00:00Z'));
  const dA3 = await seedDeal(pool, eclair, {
    priceRub: 150,
    quantity: 4,
    startsAt: at('2026-11-05T09:00:00Z'),
    endsAt: at('2026-11-05T18:00:00Z'),
  });
  await seedDeal(pool, eclair, {
    quantity: 7,
    startsAt: at('2026-10-30T09:00:00Z'),
    endsAt: at('2026-10-30T18:00:00Z'),
  });
  const dB1 = await seedDeal(pool, bun, {
    priceRub: 60,
    quantity: 5,
    startsAt: at('2026-11-03T09:00:00Z'),
    endsAt: at('2026-11-03T18:00:00Z'),
  });
  const dD = await seedDeal(pool, demoItem, {
    quantity: 3,
    startsAt: at('2026-11-03T09:00:00Z'),
    endsAt: at('2026-11-03T18:00:00Z'),
  });

  const redeemed = (
    item: MenuItem,
    userId: number | null,
    code: string,
    created: string,
    dealId: number | null,
    priceRub?: number,
  ) =>
    seedBooking(pool, {
      userId,
      item,
      code,
      createdAt: at(created),
      resolvedAt: at(created),
      status: 'redeemed',
      dealId,
      priceRub,
    });

  await redeemed(eclair, G2, 'KDG2AB', '2026-10-25T10:00:00Z', null);
  await redeemed(eclair, G1, 'AAA232', '2026-11-03T10:00:00Z', dA1.id, 120);
  await redeemed(eclair, G1, 'AAA242', '2026-11-04T10:00:00Z', dA1.id, 120);
  await redeemed(eclair, G2, 'AAA252', '2026-11-05T10:00:00Z', dA3.id, 150);
  await pool.query(`update deals set cancelled_at = '2026-11-05T12:00:00Z' where id = $1`, [dA3.id]);
  await redeemed(eclair, null, 'AAA262', '2026-11-06T10:00:00Z', dA1.id, 120);
  await seedBooking(pool, {
    userId: G3,
    item: eclair,
    code: 'AAA272',
    createdAt: at('2026-11-07T10:00:00Z'),
    status: 'expired',
    dealId: dA1.id,
    priceRub: 120,
  });
  await redeemed(eclair, DEMO, 'AAA282', '2026-11-07T11:00:00Z', dA1.id, 120);
  await seedBooking(pool, {
    userId: G3,
    item: eclair,
    code: 'AAA292',
    createdAt: at('2026-11-07T12:00:00Z'),
    status: 'cancelled',
  });
  await redeemed(bun, G1, 'BBB232', '2026-11-04T10:00:00Z', dB1.id, 60);
  await redeemed(demoItem, G3, 'DDD232', '2026-11-04T10:00:00Z', dD.id, 50);

  await seedOffer(pool, { userId: G1, item: eclair, createdAt: at('2026-11-03T08:00:00Z') });
  await seedOffer(pool, {
    userId: G1,
    item: eclair,
    createdAt: at('2026-11-04T08:00:00Z'),
    status: 'accepted',
  });
  await seedOffer(pool, {
    userId: G2,
    item: eclair,
    createdAt: at('2026-11-05T08:00:00Z'),
    status: 'declined',
  });
  await seedOffer(pool, {
    userId: DEMO,
    item: eclair,
    createdAt: at('2026-11-05T08:00:00Z'),
    status: 'accepted',
  });
  await pool.query(
    `insert into offers (user_id, venue_id, menu_item_id, channel, score, explanation, status, created_at)
     values ($1, $2, $3, 'push', 0.5, '{}'::jsonb, 'accepted', '2026-11-05T08:00:00Z')`,
    [G2, a.id, eclair.id],
  );
  for (let index = 0; index < 10; index += 1) {
    await pool.query(
      `insert into deal_impressions (deal_id, user_id, day, source, created_at) values ($1, $2, $3, 'catalog', $3::date)`,
      [dA1.id, [G1, G2, G3][index % 3], `2026-11-0${String(2 + (index % 7))}`],
    );
  }
  await pool.query(
    `insert into deal_impressions (deal_id, user_id, day, source, created_at) values ($1, $2, '2026-11-12', 'catalog', '2026-11-12')`,
    [dA1.id, G1],
  );

  await signedUp(R1, 'c_kfu1', '2026-11-02T09:00:00Z');
  await meal(R1, '2026-11-02T20:30:00Z');
  await meal(R1, '2026-11-09T10:00:00Z');
  await pool.query(
    `insert into consents (user_id, kind, version, channel, granted_at) values ($1, 'personal_data', '2026-09-25', 'bot', '2026-11-02T09:00:00Z')`,
    [R1],
  );
  await seedOffer(pool, { userId: R1, item: bun, createdAt: at('2026-11-15T09:00:00Z') });
  await redeemed(bun, R1, 'BBB999', '2026-11-15T10:00:00Z', null);

  await signedUp(R2, 'organic', '2026-11-03T09:00:00Z');
  await meal(R2, '2026-11-03T09:30:00Z');
  await meal(R2, '2026-11-09T09:30:00Z');
  await meal(R2, '2026-11-11T09:30:00Z');
  await pool.query(
    `insert into consents (user_id, kind, version, channel, granted_at) values ($1, 'personal_data', '2026-09-25', 'miniapp', '2026-11-03T09:00:00Z')`,
    [R2],
  );

  await signedUp(R3, 'v_1', '2026-11-04T09:00:00Z', 'Asia/Yekaterinburg');
  await meal(R3, '2026-11-04T20:00:00Z');
  await meal(R3, '2026-11-11T19:30:00Z');

  await signedUp(R4, 'organic', '2026-10-20T09:00:00Z');
  await meal(R4, '2026-10-30T09:00:00Z');
  await meal(DEMO, '2026-11-03T09:00:00Z');
  await meal(G3, '2026-11-03T09:00:00Z', 'demo');
}

beforeAll(async () => {
  await resetDatabase(pool);
  await seed();
  report = await buildPilotReport(pool, PERIOD, NOW);
});

afterAll(async () => {
  await closeTestPool();
});

describe('pilot report', () => {
  it('counts H1-H4 and the redeemed share for each pilot venue, without demo venues and accounts', () => {
    expect(report.venues.map((venue) => venue.name)).toEqual(['Зерно, на Баумана', 'Пекарня «Б»']);
    const [a, b] = report.venues;
    expect(a).toMatchObject({
      venueId: venueA,
      listed: 14,
      sold: 4,
      soldShare: { numerator: 4, denominator: 14, value: 0.2857 },
      offerAcceptance: { numerator: 1, denominator: 3, value: 0.3333 },
      catalogConversion: { numerator: 5, denominator: 10, value: 0.5 },
      newGuests: 1,
      newGuestsPerWeek: 1,
      newGuestShare: { numerator: 1, denominator: 2, value: 0.5 },
      costPerGuest: { numerator: 160, denominator: 400, value: 0.4 },
      redeemShare: { numerator: 4, denominator: 6, value: 0.6667 },
      bookingsWithoutGuest: 1,
    });
    expect(b).toMatchObject({
      venueId: venueB,
      listed: 5,
      sold: 1,
      newGuests: 1,
      costPerGuest: { numerator: 40, denominator: 100, value: 0.4 },
      redeemShare: { numerator: 1, denominator: 1, value: 1 },
      offerAcceptance: { numerator: 0, denominator: 0, value: null },
    });
  });

  it('sums the pilot total from the venue numerators and denominators', () => {
    expect(report.total).toMatchObject({
      listed: 19,
      sold: 5,
      newGuests: 2,
      redeemingGuests: 3,
      soldShare: { value: 0.2632 },
      costPerGuest: { numerator: 200, denominator: 500, value: 0.4 },
      redeemShare: { numerator: 5, denominator: 7, value: 0.7143 },
      bookingsWithoutGuest: 1,
    });
  });

  it('counts day 7 retention in the time zone of each guest and splits it by the first link', () => {
    expect(report.retentionD7).toEqual({ numerator: 2, denominator: 3, value: 0.6667 });
    expect(report.channels).toEqual([
      { acquisition: 'c_kfu1', newGuests: 0, retentionD7: { numerator: 1, denominator: 1, value: 1 } },
      { acquisition: 'organic', newGuests: 0, retentionD7: { numerator: 0, denominator: 1, value: 0 } },
      { acquisition: 'unknown', newGuests: 2, retentionD7: { numerator: 0, denominator: 0, value: null } },
      { acquisition: 'v_1', newGuests: 0, retentionD7: { numerator: 1, denominator: 1, value: 1 } },
    ]);
  });

  it('builds the funnel of the users who signed in during the period', () => {
    expect(report.funnel).toEqual({
      signedIn: 3,
      consented: 2,
      firstMeal: 3,
      firstOffer: 1,
      firstBooking: 1,
      firstRedeemed: 1,
    });
  });

  it('filters one venue', async () => {
    const one = await buildPilotReport(pool, { ...PERIOD, venueId: venueB }, NOW);
    expect(one.venues.map((venue) => venue.venueId)).toEqual([venueB]);
    expect(one.total.listed).toBe(5);
  });

  it('prints CSV and JSON with aggregates only', () => {
    const csv = renderPilotReport(report, 'csv');
    const json = renderPilotReport(report, 'json');
    expect(csv.split('\n').slice(0, 3)).toEqual([
      'period,2026-11-02,2026-11-08,7',
      '',
      'venue_id,venue,listed,sold,sold_share,offers_shown,offers_accepted,offer_acceptance,catalog_bookings,deal_impressions,catalog_conversion,new_guests,new_guests_per_week,redeeming_guests,new_guest_share,new_guest_discount_rub,new_guest_list_price_rub,cost_per_guest,bookings_created,bookings_redeemed,redeem_share,bookings_without_guest',
    ]);
    expect(csv).toContain(
      `${String(venueA)},"Зерно, на Баумана",14,4,0.2857,3,1,0.3333,5,10,0.5,1,1,2,0.5,160,400,0.4,6,4,0.6667,1`,
    );
    expect(csv).toContain(',Итого,19,5,');
    expect(csv).toContain('all,2,3,2,0.6667');
    expect(csv).toContain('first_redeemed,1');
    expect(JSON.parse(json)).toMatchObject({ period: { from: '2026-11-02', to: '2026-11-08', days: 7 } });
    for (const output of [csv, json]) {
      for (const secret of [G1, G2, G3, R1, R2, R3, R4, OWNER_A, OWNER_B])
        expect(output).not.toContain(String(secret));
      for (const code of ['AAA232', 'BBB232', 'KDG2AB']) expect(output).not.toContain(code);
    }
  });
});
