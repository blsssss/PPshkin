import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedGuest } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { testConfig } from '../../test/services.ts';
import { seedDeal, seedMenuItem, seedUser, seedVenue } from '../../test/venues.ts';
import { DEMO_ACCOUNTS } from '../auth/demo.ts';
import { createServices } from '../container.ts';
import { dealPrice, loadDemoDataset, type DemoDataset } from '../demo/dataset.ts';
import { DEMO_CITY_CENTER } from '../demo/location.ts';
import { isDessert } from '../domain/intent/dish.ts';
import { CONSENT_DOCUMENTS } from '../domain/consents.ts';
import { createRecognition } from '../recognition/index.ts';
import * as meals from '../repositories/meals.ts';
import * as users from '../repositories/users.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { addDays, formatLocalTime, localDate } from '../shared/time.ts';
import { createDemoService } from './demo.ts';

const pool = testPool();
const clock = fixedClock('2026-09-26T07:00:00Z');
const dataset = await loadDemoDataset();
const GUEST = DEMO_ACCOUNTS.guest.userId;
const DEMO_OWNER = DEMO_ACCOUNTS.venue.userId;
const REVIEWER = 501;
const OTHER = 502;
const ZERNO = 900001;
const MOSCOW = { lat: 55.7558, lon: 37.6173 };

function stack(demoDataset: DemoDataset | null = dataset) {
  const config = testConfig({ DEMO_MODE: 'true', DEMO_GUEST_TOKEN: 'demo-guest-token-demo-service-0123' });
  return createServices({
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
    background: createBackgroundTasks({ error: () => undefined }),
    demoDataset,
  });
}

const services = stack();
const { demo } = services;
const disabled = stack(null).demo;

async function rowCounts() {
  const { rows } = await pool.query<Record<string, number>>(
    `select (select count(*)::int from users) as users,
            (select count(*)::int from consents) as consents,
            (select count(*)::int from venues) as venues,
            (select count(*)::int from menu_items) as menu_items,
            (select count(*)::int from deals) as deals,
            (select count(*)::int from meals) as meals,
            (select count(*)::int from offers) as offers,
            (select count(*)::int from bookings) as bookings`,
  );
  return rows[0];
}

interface DealRow {
  venue_id: number;
  menu_item_id: number;
  price_rub: number;
  quantity_total: number;
  quantity_left: number;
  starts_at: Date;
  ends_at: Date;
}

async function dealsOf(venueId: number, since: Date): Promise<DealRow[]> {
  const { rows } = await pool.query<DealRow>(
    `select venue_id, menu_item_id, price_rub, quantity_total, quantity_left, starts_at, ends_at from deals
      where venue_id = $1 and starts_at >= $2
      order by starts_at, id`,
    [venueId, since],
  );
  return rows;
}

const moscow = (iso: string) => new Date(`${iso}+03:00`);

const HISTORY_WEEK = {
  offersShown: 57,
  offersAccepted: 21,
  bookingsCreated: 21,
  bookingsRedeemed: 16,
  bookingsExpired: 3,
  bookingsCancelled: 2,
  surplusUnitsSold: 11,
};

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-26T07:00:00Z');
});

afterAll(async () => {
  await closeTestPool();
});

describe('seed', () => {
  it('creates the demo accounts, venues, menus, deals of today, diary and history', async () => {
    const report = await demo.seed();

    expect(report).toEqual({
      venues: 6,
      menuItems: 64,
      dealsCreated: 15 + 21,
      mealsCreated: 26,
      historyDays: 7,
    });
    expect(await rowCounts()).toEqual({
      users: 2,
      consents: 2,
      venues: 6,
      menu_items: 64,
      deals: 36,
      meals: 26,
      offers: 57,
      bookings: 21,
    });
    const guest = await users.findById(pool, GUEST);
    expect(guest).toMatchObject({
      firstName: 'Демо-гость',
      kcalTarget: 1800,
      goal: 'maintain',
      timezone: 'Europe/Moscow',
      dislikedTags: ['fish'],
      location: { lat: 55.79, lon: 49.12 },
    });
    expect((await users.findById(pool, DEMO_OWNER))?.firstName).toBe('Демо-заведение');
    for (const userId of [GUEST, DEMO_OWNER]) {
      expect(await services.consents.status(userId)).toMatchObject({
        personalData: { granted: true, version: CONSENT_DOCUMENTS.personal_data.version },
        personalizedOffers: { granted: false },
      });
    }
    expect(await services.venues.get(DEMO_OWNER)).toMatchObject({
      id: ZERNO,
      name: 'Кофейня «Зерно»',
      address: 'Казань, ул. Баумана, 36',
      isDemo: true,
    });
    const menu = await services.menu.list(DEMO_OWNER);
    expect(menu).toHaveLength(12);
    expect(menu.every((item) => item.nutritionSource === 'venue' && item.isAvailable)).toBe(true);
  });

  it('creates the deals of every window that has not ended yet at the template prices', async () => {
    await demo.seed();
    const today = moscow('2026-09-26T00:00:00');
    expect(await dealsOf(ZERNO, today)).toEqual([
      {
        venue_id: ZERNO,
        menu_item_id: 910108,
        price_rub: dealPrice(150, 40),
        quantity_total: 6,
        quantity_left: 6,
        starts_at: moscow('2026-09-26T08:00:00'),
        ends_at: moscow('2026-09-26T12:00:00'),
      },
      {
        venue_id: ZERNO,
        menu_item_id: 910106,
        price_rub: 230,
        quantity_total: 5,
        quantity_left: 5,
        starts_at: moscow('2026-09-26T12:00:00'),
        ends_at: moscow('2026-09-26T17:00:00'),
      },
      {
        venue_id: ZERNO,
        menu_item_id: 910110,
        price_rub: 160,
        quantity_total: 4,
        quantity_left: 4,
        starts_at: moscow('2026-09-26T17:00:00'),
        ends_at: moscow('2026-09-26T22:00:00'),
      },
    ]);
    const canteen = await dealsOf(900004, today);
    expect(
      canteen.map((deal) => [deal.menu_item_id, formatLocalTime(deal.ends_at, 'Europe/Moscow')]),
    ).toEqual([
      [910404, '17:00'],
      [910406, '19:00'],
    ]);
  });

  it('is idempotent: a second seed keeps every row and adds no deals or history', async () => {
    await demo.seed();
    const before = await rowCounts();
    const { rows: venuesBefore } = await pool.query('select id, updated_at from venues order by id');
    expect(await demo.seed()).toEqual({
      venues: 6,
      menuItems: 64,
      dealsCreated: 0,
      mealsCreated: 26,
      historyDays: 0,
    });
    expect(await rowCounts()).toEqual(before);
    expect((await pool.query('select id, updated_at from venues order by id')).rows).toEqual(venuesBefore);
  });

  it('serializes concurrent seeds of several instances', async () => {
    await Promise.all([demo.seed(), stack().demo.seed()]);
    expect(await rowCounts()).toMatchObject({ venues: 6, menu_items: 64, deals: 36, meals: 26, offers: 57 });
  });

  it('replaces a venue the demo venue account created itself with «Зерно»', async () => {
    const own = await seedVenue(pool, DEMO_OWNER, { name: 'Своя кофейня' });
    const item = await seedMenuItem(pool, own.id);
    const deal = await seedDeal(pool, item, {
      startsAt: clock.now(),
      endsAt: moscow('2026-09-26T21:00:00'),
    });
    await seedGuest(pool, REVIEWER, clock.now());
    await services.bookings.create(REVIEWER, { menuItemId: item.id, dealId: deal.id });

    expect(await demo.seed()).toMatchObject({ venues: 6, menuItems: 64 });

    expect(await services.venues.get(DEMO_OWNER)).toMatchObject({ id: ZERNO, ownerId: DEMO_OWNER });
    const { rows } = await pool.query('select id from venues where id = $1', [own.id]);
    expect(rows).toEqual([]);
    expect(await rowCounts()).toMatchObject({ venues: 6, menu_items: 64, deals: 36, bookings: 21 });
    expect(await demo.seed()).toMatchObject({ dealsCreated: 0, historyDays: 0 });
  });

  it('restores seeded venues and menus changed through the demo venue account', async () => {
    await demo.seed();
    await services.venues.update(DEMO_OWNER, { name: 'Переименовано', opensAt: '11:00' });
    const croissant = 910108;
    await services.menu.update(DEMO_OWNER, 910101, { priceRub: 999 });
    await services.menu.archive(DEMO_OWNER, croissant);
    await demo.seed();
    expect(await services.venues.get(DEMO_OWNER)).toMatchObject({
      name: 'Кофейня «Зерно»',
      opensAt: '08:00',
    });
    const menu = await services.menu.list(DEMO_OWNER);
    expect(menu.find((item) => item.id === 910101)?.priceRub).toBe(220);
    expect(menu.map((item) => item.id)).toContain(croissant);
  });

  it('archives seeded items that are no longer in the dataset and stops their deals', async () => {
    await demo.seed();
    const [zerno, ...rest] = dataset.venues;
    const withoutCroissant: DemoDataset = {
      ...dataset,
      venues: [
        {
          ...zerno!,
          menu: zerno!.menu.filter((item) => item.id !== 910108),
          dealTemplates: zerno!.dealTemplates.filter((template) => template.menuItemId !== 910108),
        },
        ...rest,
      ],
    };
    clock.set('2026-09-26T07:30:00Z');
    expect(await stack(withoutCroissant).demo.seed()).toMatchObject({ menuItems: 63, dealsCreated: 0 });
    const menu = await services.menu.list(DEMO_OWNER);
    expect(menu.map((item) => item.id)).not.toContain(910108);
    const { rows } = await pool.query<{ cancelled_at: Date | null }>(
      'select cancelled_at from deals where menu_item_id = 910108 and ends_at > $1',
      [clock.now()],
    );
    expect(rows).toEqual([{ cancelled_at: clock.now() }]);

    await demo.seed();
    expect((await services.menu.list(DEMO_OWNER)).map((item) => item.id)).toContain(910108);
  });

  it('is refused when demo mode is off', async () => {
    for (const run of [() => disabled.seed(), () => disabled.refresh()]) {
      await expect(run()).rejects.toMatchObject({ status: 404, code: 'demo_mode_disabled' });
    }
    expect(disabled.enabled).toBe(false);
    expect(demo.enabled).toBe(true);
    expect(await rowCounts()).toMatchObject({ users: 0, venues: 0 });
  });
});

describe('refresh', () => {
  it('creates only windows that have not ended, nothing twice a day and the next day again', async () => {
    clock.set(moscow('2026-09-26T20:00:00'));
    expect(await demo.seed()).toMatchObject({ dealsCreated: 5 + 21, historyDays: 7 });
    const evening = await dealsOf(ZERNO, moscow('2026-09-26T00:00:00'));
    expect(evening.map((deal) => deal.menu_item_id)).toEqual([910110]);

    clock.set(moscow('2026-09-26T23:30:00'));
    expect(await demo.refresh()).toMatchObject({ dealsCreated: 0, historyDays: 0, mealsCreated: 26 });

    clock.set(moscow('2026-09-27T07:00:00'));
    expect(await demo.refresh()).toEqual({
      venues: 6,
      menuItems: 64,
      dealsCreated: 15 + 2,
      mealsCreated: 26,
      historyDays: 1,
    });
    expect((await dealsOf(ZERNO, moscow('2026-09-27T00:00:00'))).map((deal) => deal.menu_item_id)).toEqual([
      910108, 910106, 910110,
    ]);
    const yesterday = await dealsOf(ZERNO, moscow('2026-09-26T00:00:00'));
    expect(yesterday.filter((deal) => deal.starts_at < moscow('2026-09-27T00:00:00'))).toHaveLength(3);
    expect(await demo.refresh()).toMatchObject({ dealsCreated: 0, historyDays: 0 });
  });

  it('recreates the demo diary for the new day and keeps meals the reviewers added', async () => {
    await demo.seed();
    const manual = await services.diary.addManual(GUEST, { title: 'Борщ', kcal: 300 });

    clock.set(moscow('2026-09-27T10:00:00'));
    await demo.refresh();

    const recent = await meals.listSince(pool, GUEST, moscow('2026-09-01T00:00:00'));
    expect(recent.filter((meal) => meal.source === 'demo')).toHaveLength(26);
    expect(recent.filter((meal) => meal.source !== 'demo').map((meal) => meal.id)).toEqual([manual.id]);
    const demoDays = new Set(
      recent.filter((meal) => meal.source === 'demo').map((meal) => localDate(meal.eatenAt, 'Europe/Moscow')),
    );
    expect([...demoDays]).toEqual(['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
  });

  it('gives the demo guest a ready profile with the afternoon dessert habit', async () => {
    await demo.seed();
    const { profile } = await services.insights.get(GUEST);
    expect(profile).toMatchObject({
      readiness: 'ready',
      mealsCount: 26,
      daysTracked: 5,
      sweetTooth: { share: 0.8, typicalHour: 16 },
    });
  });

  it('suggests a dessert near the centre around 16:00 and labels the test venue', async () => {
    clock.set(moscow('2026-09-26T16:00:00'));
    await demo.seed();
    const result = await services.recommendations.recommend(GUEST, {
      location: DEMO_CITY_CENTER,
      limit: 5,
      channel: 'miniapp',
    });
    expect(result.status).toBe('ok');
    expect(result.demoCenterUsed).toBe(false);
    expect(isDessert(result.items[0]!.item)).toBe(true);
    expect(result.items[0]?.explanation.headline).toBe('Можно позволить десерт');
    expect(
      result.items.every((offer) => offer.explanation.assumptions.includes('Заведение и меню тестовые')),
    ).toBe(true);
    expect(result.items.some((offer) => offer.item.tags.includes('fish'))).toBe(false);

    const far = await services.recommendations.recommend(GUEST, {
      location: MOSCOW,
      limit: 5,
      channel: 'bot',
    });
    expect(far).toMatchObject({ status: 'ok', demoCenterUsed: true });
  });

  it('fills the analytics of «Зерно» for the last 7 days', async () => {
    await demo.seed();
    const analytics = await services.analytics.get(DEMO_OWNER, { from: '2026-09-19', to: '2026-09-25' });
    expect(analytics).toMatchObject({ ...HISTORY_WEEK, acceptRate: 0.37, redeemRate: 0.76 });
    expect(analytics.byDay.map((day) => [day.date, day.offersShown, day.bookingsRedeemed])).toEqual([
      ['2026-09-19', 9, 3],
      ['2026-09-20', 7, 2],
      ['2026-09-21', 10, 3],
      ['2026-09-22', 8, 2],
      ['2026-09-23', 9, 3],
      ['2026-09-24', 8, 2],
      ['2026-09-25', 6, 1],
    ]);
    expect(analytics.revenueRub).toBeGreaterThan(analytics.surplusRevenueRub);
    expect(analytics.topItems.length).toBeGreaterThan(0);

    const { rows } = await pool.query<{ sold: number; left: number; total: number }>(
      `select count(b.id) filter (where b.status = 'redeemed')::int as sold, d.quantity_left as left,
              d.quantity_total as total
         from deals d left join bookings b on b.deal_id = d.id
        where d.venue_id = $1 and d.ends_at <= $2
        group by d.id`,
      [ZERNO, clock.now()],
    );
    expect(rows).toHaveLength(21);
    expect(rows.every((row) => row.left === row.total - row.sold)).toBe(true);
    const history = await services.bookings.listForVenue(DEMO_OWNER, {
      status: 'history',
      date: '2026-09-25',
    });
    expect(history.every(({ booking }) => /^[A-HJ-NP-Z2-9]{6}$/.test(booking.code))).toBe(true);
  });

  it('keeps the weekly totals of «Зерно» for the last 7 days on every later day', async () => {
    await demo.seed();
    for (const today of ['2026-09-27', '2026-09-28', '2026-10-02']) {
      clock.set(moscow(`${today}T07:00:00`));
      await demo.refresh();
      const analytics = await services.analytics.get(DEMO_OWNER, {
        from: addDays(today, -7),
        to: addDays(today, -1),
      });
      expect(analytics, today).toMatchObject(HISTORY_WEEK);
      const { rows } = await pool.query<{ sold: number; left: number; total: number }>(
        `select count(b.id) filter (where b.status = 'redeemed')::int as sold, d.quantity_left as left,
                d.quantity_total as total
           from deals d left join bookings b on b.deal_id = d.id
          where d.venue_id = $1 and d.ends_at <= $2
          group by d.id`,
        [ZERNO, clock.now()],
      );
      expect(rows.every((row) => row.left === row.total - row.sold)).toBe(true);
    }
  });

  it('keeps a day with real offers of the demo guest out of the generated history', async () => {
    clock.set(moscow('2026-09-25T16:00:00'));
    await demo.seed();
    await services.recommendations.recommend(GUEST, {
      location: DEMO_CITY_CENTER,
      limit: 3,
      channel: 'miniapp',
    });
    clock.set(moscow('2026-09-26T10:00:00'));
    expect(await demo.refresh()).toMatchObject({ historyDays: 0 });
  });
});

describe('claimVenue', () => {
  it('copies «Зерно» with its available menu and the deals left for today', async () => {
    await demo.seed();
    await seedUser(pool, REVIEWER);
    clock.set(moscow('2026-09-26T13:00:00'));

    const copy = await demo.claimVenue(REVIEWER);

    expect(copy).toMatchObject({
      ownerId: REVIEWER,
      name: 'Кофейня «Зерно»',
      address: 'Казань, ул. Баумана, 36',
      opensAt: '08:00',
      closesAt: '22:00',
      isDemo: true,
      location: { lat: 55.7892, lon: 49.118 },
    });
    expect(copy.id).toBeLessThan(ZERNO);
    const menu = await services.menu.list(REVIEWER);
    expect(menu).toHaveLength(12);
    expect(menu.some((item) => item.id >= 910_000)).toBe(false);
    const live = await services.deals.list(REVIEWER, 'active');
    expect(live.map(({ item, deal }) => [item.name, deal.priceRub, deal.quantityLeft])).toEqual([
      ['Чизкейк Нью-Йорк', 230, 5],
      ['Сэндвич с курицей', 160, 4],
    ]);
    const { rows } = await pool.query<{ demo_source_id: number }>(
      'select demo_source_id from venues where id = $1',
      [copy.id],
    );
    expect(rows[0]?.demo_source_id).toBe(ZERNO);
  });

  it('copies another seeded venue and skips deals of items it no longer sells', async () => {
    await demo.seed();
    await seedUser(pool, REVIEWER);
    await services.menu.archive(DEMO_OWNER, 910110);
    expect((await demo.claimVenue(REVIEWER, ZERNO)).name).toBe('Кофейня «Зерно»');
    expect((await services.deals.list(REVIEWER, 'active')).map(({ item }) => item.name)).toEqual([
      'Круассан',
      'Чизкейк Нью-Йорк',
    ]);
    await seedUser(pool, OTHER);
    const bakery = await demo.claimVenue(OTHER, 900003);
    expect(bakery).toMatchObject({ name: 'Пекарня «Утренний хлеб»', opensAt: '07:30', ownerId: OTHER });
    expect(await services.menu.list(OTHER)).toHaveLength(11);
  });

  it('refuses a second venue, unknown sources, demo accounts and a server without demo mode', async () => {
    await demo.seed();
    await seedUser(pool, REVIEWER);
    const copy = await demo.claimVenue(REVIEWER);
    await expect(demo.claimVenue(REVIEWER)).rejects.toMatchObject({ status: 409, code: 'venue_exists' });
    await seedVenue(pool, OTHER, { name: 'Своё кафе' });
    await expect(demo.claimVenue(OTHER)).rejects.toMatchObject({ status: 409, code: 'venue_exists' });

    const regular = await services.venues.get(OTHER);
    for (const sourceId of [900099, regular.id, copy.id]) {
      await expect(demo.claimVenue(503, sourceId)).rejects.toMatchObject({
        status: 404,
        code: 'venue_not_found',
      });
    }
    for (const account of [GUEST, DEMO_OWNER]) {
      await expect(demo.claimVenue(account)).rejects.toMatchObject({ status: 403, code: 'demo_account' });
    }
    await expect(disabled.claimVenue(REVIEWER)).rejects.toMatchObject({
      status: 404,
      code: 'demo_mode_disabled',
    });
  });

  it('shows the copy only to its owner, instead of «Зерно», across catalog, offers and bookings', async () => {
    clock.set(moscow('2026-09-26T16:00:00'));
    await demo.seed();
    await seedGuest(pool, REVIEWER, clock.now());
    await seedGuest(pool, OTHER, clock.now());
    const copy = await demo.claimVenue(REVIEWER);
    const nearby = { point: DEMO_CITY_CENTER, radiusM: 3000 };
    const venueIds = async (userId: number) =>
      (await services.catalog.venues(userId, nearby)).items.map((card) => card.venue.id);

    expect(await venueIds(REVIEWER)).toContain(copy.id);
    expect(await venueIds(REVIEWER)).not.toContain(ZERNO);
    expect(await venueIds(OTHER)).toContain(ZERNO);
    expect(await venueIds(OTHER)).not.toContain(copy.id);
    const dealVenues = async (userId: number) =>
      new Set((await services.catalog.deals(userId, nearby)).items.map((card) => card.venue.id));
    expect((await dealVenues(REVIEWER)).has(copy.id)).toBe(true);
    expect((await dealVenues(OTHER)).has(copy.id)).toBe(false);
    await expect(services.catalog.venue(OTHER, copy.id)).rejects.toMatchObject({ code: 'venue_not_found' });
    await expect(services.catalog.venue(REVIEWER, ZERNO)).rejects.toMatchObject({ code: 'venue_not_found' });

    await services.demo.fillDiary(OTHER);
    const offers = await services.recommendations.recommend(OTHER, {
      location: DEMO_CITY_CENTER,
      limit: 10,
      channel: 'bot',
    });
    expect(offers.items.some((offer) => offer.venue.id === copy.id)).toBe(false);

    const [copyItem] = await services.menu.list(REVIEWER);
    await expect(services.bookings.create(OTHER, { menuItemId: copyItem!.id })).rejects.toMatchObject({
      status: 404,
      code: 'menu_item_not_found',
    });
    const zernoItem = (await services.catalog.venue(OTHER, ZERNO)).menu[0]!;
    await expect(services.bookings.create(REVIEWER, { menuItemId: zernoItem.id })).rejects.toMatchObject({
      status: 404,
      code: 'menu_item_not_found',
    });
  });

  it('lets one account book a dish of its copy and redeem the code', async () => {
    clock.set(moscow('2026-09-26T18:00:00'));
    await demo.seed();
    await seedGuest(pool, REVIEWER, clock.now());
    await demo.claimVenue(REVIEWER);
    const [sandwich] = await services.deals.list(REVIEWER, 'active');
    const booking = await services.bookings.create(REVIEWER, {
      menuItemId: sandwich!.item.id,
      dealId: sandwich!.deal.id,
    });
    expect(booking.venue.ownerId).toBe(REVIEWER);
    const redeemed = await services.bookings.redeem(REVIEWER, booking.booking.code);
    expect(redeemed.booking.status).toBe('redeemed');
    expect((await services.diary.day(REVIEWER)).meals.map((meal) => meal.title)).toEqual([
      'Сэндвич с курицей',
    ]);
  });
});

describe('fillDiary', () => {
  it('adds the 26 sample meals in the time zone of the user and makes the profile ready', async () => {
    await seedGuest(pool, REVIEWER, clock.now());
    await services.profile.update(REVIEWER, { timezone: 'Asia/Yekaterinburg', kcalTarget: 2100 });
    const before = await users.findById(pool, REVIEWER);

    expect(await demo.fillDiary(REVIEWER)).toEqual({
      mealsAdded: 26,
      fromDate: '2026-09-21',
      toDate: '2026-09-25',
    });

    const added = await meals.listSince(pool, REVIEWER, moscow('2026-09-01T00:00:00'));
    expect(added).toHaveLength(26);
    expect(added.every((meal) => meal.source === 'demo' && meal.confidence === null)).toBe(true);
    expect(formatLocalTime(added[0]!.eatenAt, 'Asia/Yekaterinburg')).toBe('08:30');
    expect(localDate(added[0]!.eatenAt, 'Asia/Yekaterinburg')).toBe('2026-09-21');
    expect(await users.findById(pool, REVIEWER)).toEqual(before);
    expect((await services.insights.get(REVIEWER)).profile).toMatchObject({
      readiness: 'ready',
      sweetTooth: { typicalHour: 16 },
    });
  });

  it('adds the sample only once, even after one of its meals is deleted', async () => {
    await seedGuest(pool, REVIEWER, clock.now());
    await demo.fillDiary(REVIEWER);
    const [first] = await meals.listSince(pool, REVIEWER, moscow('2026-09-01T00:00:00'));
    await services.diary.remove(REVIEWER, first!.id);
    await expect(demo.fillDiary(REVIEWER)).rejects.toMatchObject({ status: 409, code: 'demo_diary_exists' });
    expect(await meals.listSince(pool, REVIEWER, moscow('2026-09-01T00:00:00'))).toHaveLength(25);
  });

  it('needs the consent, a real account and demo mode', async () => {
    await seedUser(pool, REVIEWER);
    await expect(demo.fillDiary(REVIEWER)).rejects.toMatchObject({ status: 403, code: 'consent_required' });
    for (const account of [GUEST, DEMO_OWNER]) {
      await expect(demo.fillDiary(account)).rejects.toMatchObject({ status: 403, code: 'demo_account' });
    }
    await expect(disabled.fillDiary(REVIEWER)).rejects.toMatchObject({
      status: 404,
      code: 'demo_mode_disabled',
    });
    expect(await rowCounts()).toMatchObject({ meals: 0 });
  });

  it('fills diaries of two users independently', async () => {
    await seedGuest(pool, REVIEWER, clock.now());
    await seedGuest(pool, OTHER, clock.now());
    await Promise.all([demo.fillDiary(REVIEWER), demo.fillDiary(OTHER)]);
    expect(await rowCounts()).toMatchObject({ meals: 52 });
  });
});

describe('createDemoService', () => {
  it('rejects a second sample diary requested at the same time', async () => {
    await seedGuest(pool, REVIEWER, clock.now());
    const service = createDemoService({
      pool,
      clock,
      consents: { requirePersonalData: () => Promise.resolve() },
      dataset,
    });
    const results = await Promise.allSettled([service.fillDiary(REVIEWER), service.fillDiary(REVIEWER)]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await rowCounts()).toMatchObject({ meals: 26 });
  });
});

describe('fixed demo ids', () => {
  it('leave the id sequences of regular venues and menu items untouched', async () => {
    await demo.seed();
    const venue = await seedVenue(pool, REVIEWER);
    const item = await seedMenuItem(pool, venue.id);
    expect([venue.id, item.id]).toEqual([1, 1]);
  });
});
