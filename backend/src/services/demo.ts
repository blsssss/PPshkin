import { DEMO_ACCOUNTS } from '../auth/demo.ts';
import { withTransaction, type Pool, type Queryable } from '../db/pool.ts';
import {
  dealPrice,
  demoAccountVenue,
  type DealTemplate,
  type DemoDataset,
  type DemoVenue,
} from '../demo/dataset.ts';
import { planDiary, type DiaryPlan } from '../demo/diary.ts';
import { ANALYTICS_HISTORY, historySlot, planHistoryDay, type HistorySlot } from '../demo/history.ts';
import {
  dealWindows,
  openingPeriod,
  remainingDealWindows,
  type DealWindow,
  type DealWindowName,
} from '../demo/windows.ts';
import { generateBookingCode } from '../domain/bookings.ts';
import { CONSENT_DOCUMENTS } from '../domain/consents.ts';
import type { Deal, OfferExplanation, User, Venue } from '../domain/models.ts';
import type { DayWindow } from '../repositories/analytics.ts';
import * as consentRecords from '../repositories/consents.ts';
import * as deals from '../repositories/deals.ts';
import * as demo from '../repositories/demo.ts';
import * as meals from '../repositories/meals.ts';
import * as menuItems from '../repositories/menu-items.ts';
import * as users from '../repositories/users.ts';
import * as venues from '../repositories/venues.ts';
import type { Clock } from '../shared/clock.ts';
import { conflict, forbidden, notFound } from '../shared/errors.ts';
import { addDays, dayRange, localDate } from '../shared/time.ts';
import type { ConsentsService } from './consents.ts';

export const DEFAULT_DEMO_SOURCE_VENUE_ID = 900_001;

export interface DemoSeedReport {
  venues: number;
  menuItems: number;
  dealsCreated: number;
  mealsCreated: number;
  historyDays: number;
}

export interface DemoDiaryResult {
  mealsAdded: number;
  fromDate: string;
  toDate: string;
}

export interface DemoService {
  readonly enabled: boolean;
  seed(): Promise<DemoSeedReport>;
  refresh(): Promise<DemoSeedReport>;
  claimVenue(userId: number, sourceVenueId?: number): Promise<Venue>;
  fillDiary(userId: number): Promise<DemoDiaryResult>;
}

export interface DemoDependencies {
  pool: Pool;
  clock: Clock;
  consents: Pick<ConsentsService, 'requirePersonalData'>;
  dataset: DemoDataset | null;
}

interface PricedItem {
  id: number;
  priceRub: number;
}

interface DealPlan {
  menuItemId: number;
  priceRub: number;
  quantity: number;
  window: DealWindow;
}

type HistoryDay = DayWindow & HistorySlot;

const HISTORY_EXPLANATION: OfferExplanation = {
  headline: 'Тестовая история',
  facts: [],
  calculations: [],
  assumptions: [],
  factors: [],
};

const isDemoAccount = (userId: number) => userId < 0;
const demoModeDisabled = () => notFound('demo_mode_disabled', 'Demo mode is turned off on this server');
const demoAccount = () =>
  forbidden('demo_account', 'Shared demo accounts cannot do this, sign in with your MAX account');

function dealPlans(
  templates: readonly DealTemplate[],
  windows: readonly DealWindow[],
  itemFor: (template: DealTemplate) => PricedItem | undefined,
): DealPlan[] {
  return templates.flatMap((template) => {
    const window = windows.find((candidate) => candidate.name === template.window);
    const item = itemFor(template);
    if (!window || !item) return [];
    return [
      {
        menuItemId: item.id,
        priceRub: dealPrice(item.priceRub, template.discountPercent),
        quantity: template.quantity,
        window,
      },
    ];
  });
}

function datasetItem(venue: DemoVenue): (template: DealTemplate) => PricedItem | undefined {
  return (template) => venue.menu.find((item) => item.id === template.menuItemId);
}

function insertDeal(
  db: Queryable,
  venueId: number,
  plan: DealPlan,
  createdAt: Date,
  sold = 0,
): Promise<Deal> {
  return deals.insertScheduled(
    db,
    {
      venueId,
      menuItemId: plan.menuItemId,
      priceRub: plan.priceRub,
      quantity: plan.quantity,
      quantityLeft: Math.max(0, plan.quantity - sold),
      startsAt: plan.window.startsAt,
      endsAt: plan.window.endsAt,
    },
    createdAt,
  );
}

async function createTodayDeals(db: Queryable, venue: DemoVenue, now: Date): Promise<number> {
  const { from, to } = dayRange(localDate(now, venue.timezone), venue.timezone);
  const started = new Set(
    (await deals.listStartingBetween(db, venue.id, from, to)).map((deal) => deal.menuItemId),
  );
  const plans = dealPlans(venue.dealTemplates, remainingDealWindows(venue, now), datasetItem(venue)).filter(
    (plan) => !started.has(plan.menuItemId),
  );
  for (const plan of plans) await insertDeal(db, venue.id, plan, now);
  return plans.length;
}

async function insertDiary(db: Queryable, user: User, dataset: DemoDataset, now: Date): Promise<DiaryPlan> {
  const plan = planDiary(dataset.guest.diary, localDate(now, user.timezone), user.timezone);
  for (const meal of plan.meals) {
    await meals.insert(db, { ...meal, userId: user.id, source: 'demo', confidence: null });
  }
  return plan;
}

async function refreshGuestDiary(db: Queryable, dataset: DemoDataset, now: Date): Promise<number> {
  const guest = await users.findById(db, DEMO_ACCOUNTS.guest.userId);
  if (!guest) return 0;
  await meals.removeBySource(db, guest.id, 'demo');
  return (await insertDiary(db, guest, dataset, now)).meals.length;
}

async function historyDeals(
  db: Queryable,
  venue: DemoVenue,
  day: HistoryDay,
  windows: readonly DealWindow[],
  sold: ReadonlyMap<DealWindowName, number>,
): Promise<{ byWindow: Map<DealWindowName, Deal>; created: number }> {
  const existing = await deals.listStartingBetween(db, venue.id, day.from, day.to);
  const byWindow = new Map<DealWindowName, Deal>();
  let created = 0;
  for (const plan of dealPlans(venue.dealTemplates, windows, datasetItem(venue))) {
    const units = sold.get(plan.window.name) ?? 0;
    const found = existing.find((deal) => deal.menuItemId === plan.menuItemId);
    if (found) {
      const left = Math.max(0, found.quantityLeft - units);
      byWindow.set(
        plan.window.name,
        left === found.quantityLeft
          ? found
          : await deals.update(db, found.id, { quantityLeft: left, endsAt: found.endsAt }),
      );
    } else {
      byWindow.set(plan.window.name, await insertDeal(db, venue.id, plan, plan.window.startsAt, units));
      created += 1;
    }
  }
  return { byWindow, created };
}

async function writeHistoryDay(db: Queryable, venue: DemoVenue, day: HistoryDay): Promise<number> {
  const guestId = DEMO_ACCOUNTS.guest.userId;
  const windows = dealWindows(venue, day.date);
  const offers = planHistoryDay({
    counts: day.counts,
    dayIndex: day.dayIndex,
    menuItemIds: venue.menu.map((item) => item.id),
    templates: venue.dealTemplates,
    windows,
    opening: openingPeriod(venue, day.date),
  });
  const sold = new Map<DealWindowName, number>();
  for (const { deal, booking } of offers) {
    if (deal && booking?.status === 'redeemed') sold.set(deal, (sold.get(deal) ?? 0) + 1);
  }
  const { byWindow, created } = await historyDeals(db, venue, day, windows, sold);
  const items = new Map(venue.menu.map((item) => [item.id, item]));
  for (const offer of offers) {
    const deal = offer.deal ? (byWindow.get(offer.deal) ?? null) : null;
    const offerId = await demo.insertHistoryOffer(db, {
      userId: guestId,
      venueId: venue.id,
      menuItemId: offer.menuItemId,
      dealId: deal?.id ?? null,
      channel: offer.channel,
      score: offer.score,
      explanation: HISTORY_EXPLANATION,
      status: offer.booking ? 'accepted' : 'shown',
      createdAt: offer.createdAt,
      respondedAt: offer.booking?.createdAt ?? null,
    });
    const item = items.get(offer.menuItemId);
    if (!offer.booking || !item) continue;
    await demo.insertHistoryBooking(db, {
      userId: guestId,
      venueId: venue.id,
      menuItemId: item.id,
      dealId: deal?.id ?? null,
      offerId,
      code: generateBookingCode(),
      itemName: item.name,
      priceRub: deal?.priceRub ?? item.priceRub,
      kcal: item.kcal,
      ...offer.booking,
    });
  }
  return created;
}

async function writeHistory(
  db: Queryable,
  dataset: DemoDataset,
  now: Date,
): Promise<{ days: number; dealsCreated: number }> {
  const venue = demoAccountVenue(dataset);
  const today = localDate(now, venue.timezone);
  const days = ANALYTICS_HISTORY.map((_, offset): HistoryDay => {
    const date = addDays(today, offset - ANALYTICS_HISTORY.length);
    return { date, ...dayRange(date, venue.timezone), ...historySlot(date) };
  });
  const filled = await demo.daysWithOffers(db, DEMO_ACCOUNTS.guest.userId, venue.id, days);
  const pending = days.filter((day) => !filled.has(day.date));
  let dealsCreated = 0;
  for (const day of pending) dealsCreated += await writeHistoryDay(db, venue, day);
  return { days: pending.length, dealsCreated };
}

async function refreshWithin(db: Queryable, dataset: DemoDataset, now: Date): Promise<DemoSeedReport> {
  let dealsCreated = 0;
  for (const venue of dataset.venues) dealsCreated += await createTodayDeals(db, venue, now);
  const mealsCreated = await refreshGuestDiary(db, dataset, now);
  const history = await writeHistory(db, dataset, now);
  return {
    venues: dataset.venues.length,
    menuItems: dataset.venues.reduce((total, venue) => total + venue.menu.length, 0),
    dealsCreated: dealsCreated + history.dealsCreated,
    mealsCreated,
    historyDays: history.days,
  };
}

async function seedAccounts(db: Queryable, dataset: DemoDataset, now: Date): Promise<void> {
  const version = CONSENT_DOCUMENTS.personal_data.version;
  for (const account of Object.values(DEMO_ACCOUNTS)) {
    await users.upsert(db, { id: account.userId, firstName: account.firstName, username: null });
    await consentRecords.grant(db, account.userId, 'personal_data', version, 'miniapp', now);
  }
  const { location, ...profile } = dataset.guest.profile;
  await users.updateProfile(db, DEMO_ACCOUNTS.guest.userId, profile);
  await users.setLocation(db, DEMO_ACCOUNTS.guest.userId, location, now);
}

async function seedCatalog(db: Queryable, dataset: DemoDataset, now: Date): Promise<void> {
  const items = dataset.venues.flatMap((venue) => venue.menu.map((item) => ({ ...item, venueId: venue.id })));
  const venueIds = dataset.venues.map((venue) => venue.id);
  const ownerIds = dataset.venues.flatMap((venue) => (venue.ownerId === null ? [] : [venue.ownerId]));
  await demo.removeOwnedVenuesOutside(db, ownerIds, venueIds);
  await demo.upsertVenues(db, dataset.venues, now);
  await demo.upsertMenuItems(db, items, now);
  await demo.archiveMenuItemsOutside(
    db,
    venueIds,
    items.map((item) => item.id),
    now,
  );
}

export function createDemoService({ pool, clock, consents, dataset }: DemoDependencies): DemoService {
  function requireDataset(): DemoDataset {
    if (!dataset) throw demoModeDisabled();
    return dataset;
  }

  async function lockedTransaction<T>(
    work: (db: Queryable, data: DemoDataset, now: Date) => Promise<T>,
  ): Promise<T> {
    const data = requireDataset();
    return withTransaction(pool, async (client) => {
      await demo.lockDemoData(client);
      return work(client, data, clock.now());
    });
  }

  return {
    enabled: dataset !== null,

    seed: () =>
      lockedTransaction(async (db, data, now) => {
        await seedAccounts(db, data, now);
        await seedCatalog(db, data, now);
        return refreshWithin(db, data, now);
      }),

    refresh: () => lockedTransaction(refreshWithin),

    async claimVenue(userId, sourceVenueId = DEFAULT_DEMO_SOURCE_VENUE_ID) {
      const data = requireDataset();
      if (isDemoAccount(userId)) throw demoAccount();
      const template = data.venues.find((venue) => venue.id === sourceVenueId);
      return withTransaction(pool, async (client) => {
        const source = template ? await venues.findSeededDemo(client, template.id) : null;
        if (!template || !source) throw notFound('venue_not_found', 'There is no demo venue with this id');
        const now = clock.now();
        const copy = await venues.insertDemoCopy(client, source.id, userId, now);
        if (!copy) throw conflict('venue_exists', 'You already have a venue, open it instead');
        const copied = new Map(
          (await menuItems.copyAvailable(client, source.id, copy.id, now)).map((item) => [item.name, item]),
        );
        const names = new Map(template.menu.map((item) => [item.id, item.name]));
        const plans = dealPlans(template.dealTemplates, remainingDealWindows(copy, now), (dealTemplate) =>
          copied.get(names.get(dealTemplate.menuItemId) ?? ''),
        );
        for (const plan of plans) await insertDeal(client, copy.id, plan, now);
        return copy;
      });
    },

    async fillDiary(userId) {
      const data = requireDataset();
      if (isDemoAccount(userId)) throw demoAccount();
      await consents.requirePersonalData(userId);
      return withTransaction(pool, async (client) => {
        const user = (await users.lock(client, userId)) ? await users.findById(client, userId) : null;
        if (!user) throw notFound('user_not_found', 'User not found');
        if (await meals.hasSource(client, userId, 'demo')) {
          throw conflict('demo_diary_exists', 'The sample diary has already been added');
        }
        const { meals: added, fromDate, toDate } = await insertDiary(client, user, data, clock.now());
        return { mealsAdded: added.length, fromDate, toDate };
      });
    },
  };
}
