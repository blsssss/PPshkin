import { distanceMeters } from '../../shared/geo.ts';
import { isOpenAt, localParts } from '../../shared/time.ts';
import { INTENT_FACTORS } from '../models.ts';
import type { Deal, FactorScore, GeoPoint, IntentFactor, MenuItem, Venue } from '../models.ts';
import type { BehaviorProfile } from '../nutrition/profile.ts';
import { mealSlotAt, SLOT_BUDGET_SHARES } from '../nutrition/slots.ts';
import { remainingKcal } from '../nutrition/totals.ts';
import type { DayTotals } from '../nutrition/totals.ts';
import type { MealSlot, MenuCategory, Tag } from '../vocabulary.ts';
import { explainRecommendation } from './explain.ts';
import type { Candidate, IntentContext, RankOptions, RankResult, Recommendation } from './types.ts';

export const INTENT_WEIGHTS: Record<IntentFactor, number> = {
  fit: 0.3,
  taste: 0.25,
  habit: 0.1,
  macros: 0.05,
  proximity: 0.15,
  deal: 0.15,
  novelty: 0.2,
};

export const DEFAULT_MAX_DISTANCE_M = 5000;

interface Scene {
  context: IntentContext;
  slot: MealSlot;
  localHour: number;
  remainingKcal: number;
  slotBudgetKcal: number;
  toleranceKcal: number;
  maxDistanceM: number;
}

interface Placement {
  candidate: Candidate;
  distanceM: number | null;
}

interface Scored extends Placement {
  score: number;
  factors: FactorScore[];
}

const EXHAUSTED_BELOW_KCAL = 100;
const MIN_SLOT_BUDGET_KCAL = 120;
const MIN_TOLERANCE_KCAL = 50;
const TOLERANCE_SHARE = 0.05;
const UNKNOWN_DISTANCE_M = Number.MAX_SAFE_INTEGER;
const UNKNOWN_PROXIMITY = 0.5;
const EMPTY_PROFILE_TASTE = 0.5;
const NEUTRAL_TASTE = 0.3;
const SWEET_TOOTH_MIN_SHARE = 0.4;
const SWEET_TOOTH_HOUR_SPREAD = 2;
const SLOT_HABIT_MIN_SHARE = 0.5;
const LOW_PROTEIN_MIN_MEALS = 2;
const LOW_PROTEIN_DAY_SHARE = 0.15;
const PROTEIN_RICH_SHARE = 0.25;
const PROTEIN_KCAL_PER_G = 4;
const FULL_DISCOUNT = 0.5;
const DISCOUNT_PART = 0.7;
const URGENCY_PART = 0.3;
const URGENT_MINUTES = 120;
const MINUTE_MS = 60_000;
const DESSERT_TAGS: readonly Tag[] = ['sweet', 'dessert'];

const SLOT_CATEGORIES: Record<MealSlot, readonly MenuCategory[]> = {
  breakfast: ['breakfast', 'bakery', 'drink'],
  lunch: ['main', 'soup', 'salad', 'side'],
  snack: ['bakery', 'dessert', 'snack', 'drink'],
  dinner: ['main', 'salad', 'soup', 'side'],
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

function isDessert(item: MenuItem): boolean {
  return item.category === 'dessert' || item.tags.some((tag) => DESSERT_TAGS.includes(tag));
}

function isProteinRich(item: MenuItem): boolean {
  return (
    item.tags.includes('high_protein') ||
    (item.proteinG !== null &&
      item.kcal > 0 &&
      (item.proteinG * PROTEIN_KCAL_PER_G) / item.kcal >= PROTEIN_RICH_SHARE)
  );
}

function hoursApart(left: number, right: number): number {
  const difference = Math.abs(left - right);
  return Math.min(difference, 24 - difference);
}

function distanceTo(location: GeoPoint | null, venue: Venue): number | null {
  return location === null ? null : Math.round(distanceMeters(location, venue.location));
}

function isDealActive(deal: Deal, now: Date): boolean {
  return (
    deal.cancelledAt === null &&
    deal.quantityLeft > 0 &&
    now.getTime() >= deal.startsAt.getTime() &&
    now.getTime() < deal.endsAt.getTime()
  );
}

function isConsistent({ item, venue, deal }: Candidate): boolean {
  return (
    item.venueId === venue.id && (deal === null || (deal.venueId === venue.id && deal.menuItemId === item.id))
  );
}

function isEligible({ candidate, distanceM }: Placement, scene: Scene): boolean {
  const { item, venue, deal } = candidate;
  const { now, user, declinedItemIds } = scene.context;
  return (
    item.archivedAt === null &&
    item.isAvailable &&
    isConsistent(candidate) &&
    isOpenAt(venue.opensAt, venue.closesAt, now, venue.timezone) &&
    (deal === null || isDealActive(deal, now)) &&
    !item.tags.some((tag) => user.dislikedTags.includes(tag)) &&
    !declinedItemIds.has(item.id) &&
    item.kcal <= scene.remainingKcal + scene.toleranceKcal &&
    (distanceM === null || distanceM <= scene.maxDistanceM)
  );
}

function tasteScore(item: MenuItem, profile: BehaviorProfile): number {
  if (profile.readiness === 'empty') return EMPTY_PROFILE_TASTE;
  const affinities = Object.values(profile.tagAffinity);
  const maxAffinity = Math.max(0, ...affinities);
  if (item.tags.length === 0 || maxAffinity === 0) return NEUTRAL_TASTE;
  const relative = item.tags.map((tag) => (profile.tagAffinity[tag] ?? 0) / maxAffinity);
  return relative.reduce((total, value) => total + value, 0) / relative.length;
}

function habitScore(item: MenuItem, scene: Scene): number {
  const { sweetTooth, slots } = scene.context.profile;
  const sweetHabit =
    isDessert(item) &&
    sweetTooth.share >= SWEET_TOOTH_MIN_SHARE &&
    sweetTooth.typicalHour !== null &&
    hoursApart(sweetTooth.typicalHour, scene.localHour) <= SWEET_TOOTH_HOUR_SPREAD;
  const slotHabit =
    slots[scene.slot].share >= SLOT_HABIT_MIN_SHARE && SLOT_CATEGORIES[scene.slot].includes(item.category);
  return sweetHabit || slotHabit ? 1 : 0;
}

function macrosScore(item: MenuItem, today: DayTotals): number {
  const lowProteinDay =
    today.meals >= LOW_PROTEIN_MIN_MEALS &&
    today.kcal > 0 &&
    (today.proteinG * PROTEIN_KCAL_PER_G) / today.kcal < LOW_PROTEIN_DAY_SHARE;
  return lowProteinDay && isProteinRich(item) ? 1 : 0;
}

function dealScore(item: MenuItem, deal: Deal, now: Date): number {
  const discount = item.priceRub > 0 ? Math.max(0, 1 - deal.priceRub / item.priceRub) : 0;
  const minutesLeft = (deal.endsAt.getTime() - now.getTime()) / MINUTE_MS;
  const urgency = minutesLeft <= URGENT_MINUTES ? 1 - minutesLeft / URGENT_MINUTES : 0;
  return Math.min(1, discount / FULL_DISCOUNT) * DISCOUNT_PART + urgency * URGENCY_PART;
}

const FACTOR_RULES: Record<IntentFactor, (placement: Placement, scene: Scene) => number> = {
  fit: ({ candidate }, { slotBudgetKcal }) =>
    Math.max(0, 1 - Math.abs(candidate.item.kcal - slotBudgetKcal) / slotBudgetKcal),
  taste: ({ candidate }, { context }) => tasteScore(candidate.item, context.profile),
  habit: ({ candidate }, scene) => habitScore(candidate.item, scene),
  macros: ({ candidate }, { context }) => macrosScore(candidate.item, context.today),
  proximity: ({ distanceM }, { maxDistanceM }) =>
    distanceM === null ? UNKNOWN_PROXIMITY : Math.max(0, 1 - distanceM / maxDistanceM),
  deal: ({ candidate }, { context }) =>
    candidate.deal === null ? 0 : dealScore(candidate.item, candidate.deal, context.now),
  novelty: ({ candidate }, { context }) => (context.offeredTodayItemIds.has(candidate.item.id) ? -1 : 0),
};

function score(placement: Placement, scene: Scene): Scored {
  const values = INTENT_FACTORS.map((factor) => ({ factor, value: FACTOR_RULES[factor](placement, scene) }));
  return {
    ...placement,
    score: round4(values.reduce((total, { factor, value }) => total + value * INTENT_WEIGHTS[factor], 0)),
    factors: values.map(({ factor, value }) => ({
      factor,
      value: round2(value),
      weight: INTENT_WEIGHTS[factor],
    })),
  };
}

function compareScored(left: Scored, right: Scored): number {
  return (
    right.score - left.score ||
    Number(right.candidate.deal !== null) - Number(left.candidate.deal !== null) ||
    (left.distanceM ?? UNKNOWN_DISTANCE_M) - (right.distanceM ?? UNKNOWN_DISTANCE_M) ||
    left.candidate.item.id - right.candidate.item.id
  );
}

function pickDiverse(sorted: readonly Scored[], limit: number): Scored[] {
  const picked = new Set<Scored>();
  const venues = new Set<number>();
  for (const entry of sorted) {
    if (picked.size >= limit) break;
    if (!venues.has(entry.candidate.venue.id)) {
      venues.add(entry.candidate.venue.id);
      picked.add(entry);
    }
  }
  for (const entry of sorted) {
    if (picked.size >= limit) break;
    picked.add(entry);
  }
  return [...picked];
}

function toRecommendation({ candidate, distanceM, score, factors }: Scored, scene: Scene): Recommendation {
  const { item, deal } = candidate;
  return {
    candidate,
    score,
    distanceM,
    kcal: item.kcal,
    priceRub: deal === null ? item.priceRub : deal.priceRub,
    factors,
    explanation: explainRecommendation({
      context: scene.context,
      candidate,
      slot: scene.slot,
      remainingKcal: scene.remainingKcal,
      slotBudgetKcal: scene.slotBudgetKcal,
      distanceM,
      factors,
    }),
  };
}

export function rankCandidates(
  context: IntentContext,
  candidates: readonly Candidate[],
  options: RankOptions,
): RankResult {
  const { limit, maxDistanceM = DEFAULT_MAX_DISTANCE_M } = options;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('limit must be an integer of at least 1');
  }
  if (!(maxDistanceM > 0) || !Number.isFinite(maxDistanceM)) {
    throw new RangeError('maxDistanceM must be a positive finite number');
  }
  const { now, user, today } = context;
  const slot = mealSlotAt(now, user.timezone);
  const remaining = remainingKcal(user.kcalTarget, today);
  if (remaining < EXHAUSTED_BELOW_KCAL) {
    return {
      status: 'budget_exhausted',
      slot,
      remainingKcal: remaining,
      slotBudgetKcal: remaining,
      items: [],
    };
  }
  const slotBudgetKcal = Math.min(
    remaining,
    Math.max(MIN_SLOT_BUDGET_KCAL, Math.round(SLOT_BUDGET_SHARES[slot] * user.kcalTarget)),
  );
  const scene: Scene = {
    context,
    slot,
    localHour: localParts(now, user.timezone).hour,
    remainingKcal: remaining,
    slotBudgetKcal,
    toleranceKcal: Math.max(MIN_TOLERANCE_KCAL, Math.round(TOLERANCE_SHARE * user.kcalTarget)),
    maxDistanceM,
  };
  const ranked = candidates
    .map((candidate) => ({ candidate, distanceM: distanceTo(user.location, candidate.venue) }))
    .filter((placement) => isEligible(placement, scene))
    .map((placement) => score(placement, scene))
    .sort(compareScored);
  if (ranked.length === 0) {
    return { status: 'nothing_fits', slot, remainingKcal: remaining, slotBudgetKcal, items: [] };
  }
  return {
    status: 'ok',
    slot,
    remainingKcal: remaining,
    slotBudgetKcal,
    items: pickDiverse(ranked, limit).map((entry) => toRecommendation(entry, scene)),
  };
}
