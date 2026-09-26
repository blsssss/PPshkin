import type { Candidate, IntentContext, IntentUser } from '../../src/domain/intent/types.ts';
import type { Deal, GeoPoint, Meal, MenuItem, Venue } from '../../src/domain/models.ts';
import type { BehaviorProfile, SlotHabit } from '../../src/domain/nutrition/profile.ts';
import { EMPTY_TOTALS } from '../../src/domain/nutrition/totals.ts';

export const NOW = new Date('2026-09-26T13:00:00Z');
export const KAZAN_CENTER: GeoPoint = { lat: 55.7887, lon: 49.1221 };

const CREATED_AT = new Date('2026-09-01T09:00:00Z');
const MINUTE_MS = 60_000;

export const minutesFromNow = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE_MS);

export function buildMeal(eatenAt: Date | string, overrides: Partial<Meal> = {}): Meal {
  return {
    id: 1,
    userId: 101,
    title: 'Блюдо',
    kcalMin: 400,
    kcalMax: 400,
    proteinG: null,
    fatG: null,
    carbsG: null,
    tags: [],
    source: 'photo',
    confidence: 0.8,
    eatenAt: new Date(eatenAt),
    createdAt: new Date(eatenAt),
    ...overrides,
  };
}

export function buildVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: 1,
    ownerId: 202,
    name: 'Зерно',
    address: 'Казань, улица Баумана, 1',
    category: 'coffee',
    location: KAZAN_CENTER,
    opensAt: '08:00:00',
    closesAt: '22:00:00',
    timezone: 'Europe/Moscow',
    isDemo: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

export function buildMenuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 10,
    venueId: 1,
    name: 'Паста с курицей',
    description: null,
    category: 'main',
    priceRub: 300,
    weightG: 250,
    kcal: 200,
    proteinG: null,
    fatG: null,
    carbsG: null,
    nutritionSource: 'estimate',
    tags: [],
    isAvailable: true,
    archivedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

export function buildDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: 100,
    venueId: 1,
    menuItemId: 10,
    priceRub: 150,
    quantityTotal: 5,
    quantityLeft: 3,
    startsAt: minutesFromNow(-60),
    endsAt: minutesFromNow(180),
    cancelledAt: null,
    createdAt: minutesFromNow(-60),
    ...overrides,
  };
}

export function buildCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return { item: buildMenuItem(), venue: buildVenue(), deal: null, ...overrides };
}

const quietSlot = (): SlotHabit => ({ share: 0, averageKcal: null, typicalHour: null });

export function buildProfile(overrides: Partial<BehaviorProfile> = {}): BehaviorProfile {
  return {
    mealsCount: 0,
    daysTracked: 0,
    readiness: 'empty',
    mealsUntilReady: 5,
    averageDailyKcal: null,
    tagAffinity: {},
    topTags: [],
    slots: { breakfast: quietSlot(), lunch: quietSlot(), snack: quietSlot(), dinner: quietSlot() },
    sweetTooth: { share: 0, typicalHour: null },
    proteinShare: null,
    ...overrides,
  };
}

export function buildContext(
  overrides: Partial<Omit<IntentContext, 'user'>> & { user?: Partial<IntentUser> } = {},
): IntentContext {
  const { user, ...rest } = overrides;
  return {
    now: NOW,
    user: { kcalTarget: 2000, timezone: 'Europe/Moscow', dislikedTags: [], location: null, ...user },
    today: { ...EMPTY_TOTALS },
    profile: buildProfile(),
    offeredTodayItemIds: new Set(),
    declinedItemIds: new Set(),
    ...rest,
  };
}
