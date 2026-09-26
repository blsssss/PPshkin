import type { Deal, FactorScore, GeoPoint, MenuItem, OfferExplanation, Venue } from '../models.ts';
import type { BehaviorProfile } from '../nutrition/profile.ts';
import type { DayTotals } from '../nutrition/totals.ts';
import type { MealSlot, Tag } from '../vocabulary.ts';

export interface IntentUser {
  kcalTarget: number;
  timezone: string;
  dislikedTags: Tag[];
  location: GeoPoint | null;
}

export interface IntentContext {
  now: Date;
  user: IntentUser;
  today: DayTotals;
  profile: BehaviorProfile;
  offeredTodayItemIds: ReadonlySet<number>;
  declinedItemIds: ReadonlySet<number>;
}

export interface Candidate {
  item: MenuItem;
  venue: Venue;
  deal: Deal | null;
}

export interface Recommendation {
  candidate: Candidate;
  score: number;
  distanceM: number | null;
  kcal: number;
  priceRub: number;
  factors: FactorScore[];
  explanation: OfferExplanation;
}

export type RankResult =
  | { status: 'ok'; slot: MealSlot; remainingKcal: number; slotBudgetKcal: number; items: Recommendation[] }
  | { status: 'budget_exhausted'; slot: MealSlot; remainingKcal: number; slotBudgetKcal: number; items: [] }
  | { status: 'nothing_fits'; slot: MealSlot; remainingKcal: number; slotBudgetKcal: number; items: [] };

export interface RankOptions {
  limit: number;
  maxDistanceM?: number;
}
