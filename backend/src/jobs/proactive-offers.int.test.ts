import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { fakeLogger, fakeMessenger } from '../../test/max-api.ts';
import { BAUMANA, seedDeal, seedMenuItem, seedVenue } from '../../test/venues.ts';
import { CONSENT_DOCUMENTS } from '../domain/consents.ts';
import type { MenuItem, OfferExplanation, Venue } from '../domain/models.ts';
import type { BehaviorProfile, SlotHabit } from '../domain/nutrition/profile.ts';
import { EMPTY_TOTALS } from '../domain/nutrition/totals.ts';
import { UserUnreachableError } from '../integrations/max/errors.ts';
import type { Messenger, OutgoingMessage } from '../ports/messenger.ts';
import * as consents from '../repositories/consents.ts';
import * as meals from '../repositories/meals.ts';
import * as offers from '../repositories/offers.ts';
import * as users from '../repositories/users.ts';
import { createConsentsService } from '../services/consents.ts';
import { createInsightsService, type InsightsService } from '../services/insights.ts';
import {
  createRecommendationsService,
  type RecommendationsResult,
  type RecommendationsService,
  type RecommendationStatus,
} from '../services/recommendations.ts';
import { proactiveOffersJob } from './proactive-offers.ts';

const pool = testPool();
const MOSCOW_16_10 = '2026-09-26T13:10:00Z';
const clock = fixedClock(MOSCOW_16_10);
const HOUR = 3_600_000;
const GUEST = 101;

const explanation: OfferExplanation = {
  headline: 'Можно позволить десерт',
  facts: ['Сегодня записано 2 приёма пищи, примерно 900 ккал'],
  calculations: ['До ориентира 2000 ккал остаётся около 1100 ккал'],
  assumptions: ['Калорийность приблизительная, это не медицинская рекомендация'],
  factors: [],
};

const noHabit: SlotHabit = { share: 0, averageKcal: null, typicalHour: null };

function profileWith(overrides: Partial<BehaviorProfile> = {}): BehaviorProfile {
  return {
    mealsCount: 12,
    daysTracked: 4,
    readiness: 'ready',
    mealsUntilReady: 0,
    averageDailyKcal: 1900,
    tagAffinity: { sweet: 0.5 },
    topTags: ['sweet'],
    slots: { breakfast: noHabit, lunch: noHabit, snack: noHabit, dinner: noHabit },
    sweetTooth: { share: 0.75, typicalHour: 16 },
    proteinShare: null,
    ...overrides,
  };
}

interface World {
  profile: BehaviorProfile;
  status: RecommendationStatus;
  score: number;
  venue: Venue;
  eclair: MenuItem;
}

let world: World;
let insights: { get: ReturnType<typeof vi.fn<InsightsService['get']>> };
let recommendations: { recommend: ReturnType<typeof vi.fn<RecommendationsService['recommend']>> };
let sendToUser: ReturnType<typeof vi.fn<Messenger['sendToUser']>>;
let messenger: Messenger | null;
let logger: ReturnType<typeof fakeLogger>;

function job() {
  return proactiveOffersJob({ db: pool, insights, recommendations, messenger: () => messenger, logger });
}

async function seedGuest(id: number, locatedAt = new Date(clock.now().getTime() - HOUR), timezone?: string) {
  await users.upsert(pool, { id, firstName: null, username: null });
  if (timezone) await users.updateProfile(pool, id, { timezone });
  await users.setLocation(pool, id, BAUMANA, locatedAt);
  for (const kind of ['personal_data', 'personalized_offers'] as const) {
    await consents.grant(
      pool,
      id,
      kind,
      CONSENT_DOCUMENTS[kind].version,
      'bot',
      new Date('2026-09-20T09:00:00Z'),
    );
  }
}

async function recommend(userId: number, channel: 'push'): Promise<RecommendationsResult> {
  const { status, score, venue, eclair } = world;
  if (status !== 'ok') {
    return {
      status,
      slot: 'snack',
      remainingKcal: 1100,
      slotBudgetKcal: 300,
      demoCenterUsed: false,
      items: [],
    };
  }
  const [offer] = await offers.insertShown(pool, {
    userId,
    channel,
    shownAt: clock.now(),
    offers: [{ venueId: venue.id, menuItemId: eclair.id, dealId: null, score, explanation }],
  });
  if (!offer) throw new Error('offer was not stored');
  return {
    status,
    slot: 'snack',
    remainingKcal: 1100,
    slotBudgetKcal: 300,
    demoCenterUsed: false,
    items: [
      {
        offerId: offer.id,
        item: eclair,
        venue,
        deal: null,
        score,
        distanceM: 350,
        priceRub: eclair.priceRub,
        kcal: eclair.kcal,
        explanation,
      },
    ],
  };
}

async function storedOffers() {
  const { rows } = await pool.query<{ id: number; user_id: number; channel: string }>(
    'select id, user_id, channel from offers order by id',
  );
  return rows;
}

const payloadsOf = (message: OutgoingMessage | undefined) =>
  (message?.buttons ?? []).map((row) =>
    row.map((button) => (button.kind === 'callback' ? button.payload : '')),
  );

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set(MOSCOW_16_10);
  const venue = await seedVenue(pool, 1);
  const eclair = await seedMenuItem(pool, venue.id);
  world = { profile: profileWith(), status: 'ok', score: 0.8, venue, eclair };
  insights = {
    get: vi.fn<InsightsService['get']>(() =>
      Promise.resolve({
        profile: world.profile,
        today: {
          date: '2026-09-26',
          slot: 'snack',
          targetKcal: 2000,
          totals: EMPTY_TOTALS,
          remainingKcal: 2000,
        },
      }),
    ),
  };
  recommendations = {
    recommend: vi.fn<RecommendationsService['recommend']>((userId, request) => {
      if (request.channel !== 'push') throw new Error('proactive offers must use the push channel');
      return recommend(userId, request.channel);
    }),
  };
  sendToUser = vi.fn<Messenger['sendToUser']>(() => Promise.resolve({ messageId: 'mid.1' }));
  messenger = fakeMessenger({ sendToUser });
  logger = fakeLogger();
  await seedGuest(GUEST);
});

afterAll(async () => {
  await closeTestPool();
});

describe('proactive_offers job', () => {
  it('sends one offer in the habitual hour and stores it as a push offer', async () => {
    await job().run(clock.now());

    const [offer] = await storedOffers();
    expect(offer).toMatchObject({ user_id: GUEST, channel: 'push' });
    expect(recommendations.recommend).toHaveBeenCalledWith(GUEST, {
      location: null,
      limit: 1,
      channel: 'push',
    });
    expect(sendToUser).toHaveBeenCalledTimes(1);
    const [userId, message] = sendToUser.mock.calls[0] ?? [];
    expect(userId).toBe(GUEST);
    expect(message?.text.split('\n').slice(0, 4)).toEqual([
      'Подсказка по вашему дневнику',
      '',
      '**Можно позволить десерт**',
      'Эклер',
    ]);
    expect(payloadsOf(message)).toEqual([
      [`bk:new:${world.eclair.id}:0:${offer?.id}`],
      [`of:nt:${offer?.id}`, 'cs:ad:off'],
    ]);
    expect(message).toMatchObject({ format: 'markdown', notify: true });
    expect(logger.info).toHaveBeenCalledWith({ userId: GUEST, offerId: offer?.id }, 'proactive offer sent');

    clock.advance(15 * 60_000);
    await job().run(clock.now());
    expect(sendToUser).toHaveBeenCalledTimes(1);
  });

  it('falls back to the snack habit when there is no sweet tooth', async () => {
    world.profile = profileWith({
      sweetTooth: { share: 0.3, typicalHour: 16 },
      slots: { ...profileWith().slots, snack: { share: 0.5, averageKcal: 250, typicalHour: 16 } },
    });

    await job().run(clock.now());

    expect(sendToUser).toHaveBeenCalledTimes(1);
  });

  it('uses the local hour of the guest', async () => {
    await resetDatabase(pool);
    const venue = await seedVenue(pool, 1);
    world = { ...world, venue, eclair: await seedMenuItem(pool, venue.id) };
    await seedGuest(GUEST, new Date(clock.now().getTime() - HOUR), 'Asia/Yekaterinburg');
    world.profile = profileWith({ sweetTooth: { share: 0.75, typicalHour: 18 } });

    await job().run(clock.now());

    expect(sendToUser).toHaveBeenCalledTimes(1);
  });

  describe('sends nothing', () => {
    it.each<[string, () => Promise<void>]>([
      [
        'after the guest unsubscribed',
        () => consents.revoke(pool, GUEST, 'personalized_offers', clock.now()).then(() => undefined),
      ],
      ['to a demo account', () => seedGuest(-1001).then(() => users.remove(pool, GUEST))],
      [
        'with a location older than 12 hours',
        () =>
          users
            .setLocation(pool, GUEST, BAUMANA, new Date(clock.now().getTime() - 13 * HOUR))
            .then(() => undefined),
      ],
      ['within 24 hours of the last proactive offer', () => recommend(GUEST, 'push').then(() => undefined)],
    ])('%s', async (_case, arrange) => {
      await arrange();
      const before = await storedOffers();

      await job().run(clock.now());

      expect(insights.get).not.toHaveBeenCalled();
      expect(recommendations.recommend).not.toHaveBeenCalled();
      expect(sendToUser).not.toHaveBeenCalled();
      expect(await storedOffers()).toEqual(before);
    });

    it.each<[string, Partial<BehaviorProfile>]>([
      ['while the profile is still collecting', { readiness: 'collecting', mealsUntilReady: 2 }],
      ['outside the habitual hour', { sweetTooth: { share: 0.75, typicalHour: 15 } }],
      [
        'without a sweet tooth or a snack habit',
        {
          sweetTooth: { share: 0.3, typicalHour: 16 },
          slots: { ...profileWith().slots, snack: { share: 0.4, averageKcal: 250, typicalHour: 16 } },
        },
      ],
    ])('%s', async (_case, overrides) => {
      world.profile = profileWith(overrides);

      await job().run(clock.now());

      expect(insights.get).toHaveBeenCalledWith(GUEST);
      expect(recommendations.recommend).not.toHaveBeenCalled();
      expect(sendToUser).not.toHaveBeenCalled();
    });

    it.each<[string, RecommendationStatus, number]>([
      ['when nothing fits', 'nothing_fits', 0.8],
      ['when the budget is used up', 'budget_exhausted', 0.8],
      ['when the best match is weak', 'ok', 0.49],
    ])('%s and forgets the unsent offer', async (_case, status, score) => {
      Object.assign(world, { status, score });

      await job().run(clock.now());

      expect(recommendations.recommend).toHaveBeenCalledTimes(1);
      expect(sendToUser).not.toHaveBeenCalled();
      expect(await storedOffers()).toEqual([]);
    });

    it('when the guest is far away and the demo center was used', async () => {
      recommendations.recommend.mockImplementation(async (userId, request) => ({
        ...(await recommend(userId, 'push')),
        demoCenterUsed: request.channel === 'push',
      }));

      await job().run(clock.now());

      expect(sendToUser).not.toHaveBeenCalled();
      expect(await storedOffers()).toEqual([]);
    });

    it('while the bot is not running yet', async () => {
      messenger = null;

      await job().run(clock.now());

      expect(insights.get).not.toHaveBeenCalled();
      expect(recommendations.recommend).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        { job: 'proactive_offers' },
        'proactive offers skipped: the bot is not running yet',
      );
    });
  });

  describe('quiet hours', () => {
    it.each([
      ['21:59', '2026-09-26T18:59:00Z', 21, 1],
      ['22:00', '2026-09-26T19:00:00Z', 22, 0],
      ['08:59', '2026-09-26T05:59:00Z', 8, 0],
      ['09:00', '2026-09-26T06:00:00Z', 9, 1],
    ])('at %s local time', async (_time, now, hour, sent) => {
      clock.set(now);
      await users.setLocation(pool, GUEST, BAUMANA, new Date(clock.now().getTime() - HOUR));
      world.profile = profileWith({ sweetTooth: { share: 0.75, typicalHour: hour } });

      await job().run(clock.now());

      expect(sendToUser).toHaveBeenCalledTimes(sent);
    });
  });

  describe('failed delivery', () => {
    it('forgets the offer when the guest blocked the bot and moves on', async () => {
      await seedGuest(102);
      sendToUser.mockRejectedValueOnce(new UserUnreachableError('chat.denied', 'chat.denied'));

      await job().run(clock.now());

      expect(sendToUser.mock.calls.map(([userId]) => userId)).toEqual([GUEST, 102]);
      expect((await storedOffers()).map((offer) => offer.user_id)).toEqual([102]);
      expect(logger.warn).toHaveBeenCalledWith(
        { userId: GUEST, event: 'proactiveOffer' },
        'notification not delivered: the user blocked the bot or never started it',
      );
    });

    it('forgets the offer and logs any other error', async () => {
      const failure = new Error('socket hang up');
      sendToUser.mockRejectedValueOnce(failure);

      await job().run(clock.now());

      expect(await storedOffers()).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        { err: failure, userId: GUEST, event: 'proactiveOffer' },
        'notification failed',
      );
    });

    it('logs a guest that fails and keeps going', async () => {
      await seedGuest(102);
      const failure = new Error('profile query failed');
      insights.get.mockRejectedValueOnce(failure);

      await job().run(clock.now());

      expect(logger.error).toHaveBeenCalledWith(
        { err: failure, userId: GUEST, job: 'proactive_offers' },
        'proactive offer failed',
      );
      expect(sendToUser.mock.calls.map(([userId]) => userId)).toEqual([102]);
    });
  });

  it('walks through every page of candidates', async () => {
    const located = new Date(clock.now().getTime() - HOUR);
    await pool.query(
      `insert into users (id, location_lat, location_lon, location_updated_at)
       select id, $2, $3, $1 from generate_series(1001, 1060) as id`,
      [located, BAUMANA.lat, BAUMANA.lon],
    );
    await pool.query(
      `insert into consents (user_id, kind, version, channel, granted_at)
       select id, kind.name, kind.version, 'bot', $1
         from generate_series(1001, 1060) as id
        cross join (values ('personal_data', $2), ('personalized_offers', $3)) as kind (name, version)`,
      [located, CONSENT_DOCUMENTS.personal_data.version, CONSENT_DOCUMENTS.personalized_offers.version],
    );
    insights.get.mockImplementation((userId) =>
      Promise.resolve({
        profile: profileWith(userId === 1060 ? {} : { readiness: 'collecting' }),
        today: {
          date: '2026-09-26',
          slot: 'snack',
          targetKcal: 2000,
          totals: EMPTY_TOTALS,
          remainingKcal: 2000,
        },
      }),
    );

    await job().run(clock.now());

    expect(insights.get).toHaveBeenCalledTimes(61);
    expect(sendToUser.mock.calls.map(([userId]) => userId)).toEqual([1060]);
  });
});

describe('proactive_offers job with the real services', () => {
  async function logMeal(
    eatenAt: string,
    title: string,
    kcal: number,
    tags: ('dessert' | 'sweet' | 'soup')[],
  ) {
    await meals.insert(pool, {
      userId: GUEST,
      title,
      kcalMin: kcal,
      kcalMax: kcal,
      proteinG: null,
      fatG: null,
      carbsG: null,
      tags,
      source: 'manual',
      confidence: null,
      eatenAt: new Date(eatenAt),
    });
  }

  it('offers a dessert deal at the afternoon sweet hour', async () => {
    const cheesecake = await seedMenuItem(pool, world.venue.id, {
      name: 'Чизкейк',
      priceRub: 250,
      kcal: 320,
    });
    const deal = await seedDeal(pool, cheesecake, {
      priceRub: 160,
      startsAt: new Date('2026-09-26T12:00:00Z'),
      endsAt: new Date('2026-09-26T16:00:00Z'),
    });
    await logMeal('2026-09-24T09:00:00Z', 'Суп', 400, ['soup']);
    await logMeal('2026-09-24T13:00:00Z', 'Эклер', 300, ['dessert', 'sweet']);
    await logMeal('2026-09-25T09:30:00Z', 'Суп', 400, ['soup']);
    await logMeal('2026-09-25T13:20:00Z', 'Чизкейк', 350, ['dessert', 'sweet']);
    await logMeal('2026-09-26T09:00:00Z', 'Суп', 400, ['soup']);
    const consentsService = createConsentsService({ pool, clock });

    await proactiveOffersJob({
      db: pool,
      insights: createInsightsService({ pool, clock, consents: consentsService }),
      recommendations: createRecommendationsService({
        pool,
        clock,
        consents: consentsService,
        demoMode: false,
      }),
      messenger: () => messenger,
      logger,
    }).run(clock.now());

    const [offer] = await storedOffers();
    expect(offer).toMatchObject({ user_id: GUEST, channel: 'push' });
    const [, message] = sendToUser.mock.calls[0] ?? [];
    expect(payloadsOf(message)[0]).toEqual([`bk:new:${cheesecake.id}:${deal.id}:${offer?.id}`]);
    expect(message?.text).toContain('Можно позволить десерт');
  });
});
