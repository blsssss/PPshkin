import type { Pool } from '../db/pool.ts';
import { DEFAULT_MAX_DISTANCE_M, rankCandidates } from '../domain/intent/rank.ts';
import type { IntentContext, Recommendation } from '../domain/intent/types.ts';
import type { GeoPoint, MenuItem, Offer, OfferExplanation, Venue } from '../domain/models.ts';
import type { DeclineReason, MealSlot, OfferChannel } from '../domain/vocabulary.ts';
import { loadCandidates } from '../repositories/candidates.ts';
import * as offers from '../repositories/offers.ts';
import type { Clock } from '../shared/clock.ts';
import { badRequest, conflict, notFound, type ErrorDetail } from '../shared/errors.ts';
import { pointProblems } from '../shared/geo.ts';
import { boundingBox } from './catalog.ts';
import { dealStatus, type DealView } from './deals.ts';
import { loadEatingState } from './insights.ts';
import type { ConsentsService } from './consents.ts';

export const RECOMMENDATION_STATUSES = ['ok', 'budget_exhausted', 'nothing_fits', 'profile_empty'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const MAX_RECOMMENDATIONS = 10;

export interface RecommendationRequest {
  location: GeoPoint | null;
  limit: number;
  channel: OfferChannel;
  minScore?: number;
}

export interface RecommendedOffer {
  offerId: number;
  item: MenuItem;
  venue: Venue;
  deal: DealView | null;
  score: number;
  distanceM: number | null;
  priceRub: number;
  kcal: number;
  explanation: OfferExplanation;
}

export interface RecommendationsResult {
  status: RecommendationStatus;
  slot: MealSlot;
  remainingKcal: number;
  slotBudgetKcal: number;
  items: RecommendedOffer[];
}

export interface RecommendationsService {
  recommend(userId: number, request: RecommendationRequest): Promise<RecommendationsResult>;
  decline(userId: number, offerId: number, reason: DeclineReason): Promise<void>;
}

interface RecommendationsDependencies {
  pool: Pool;
  clock: Clock;
  consents: Pick<ConsentsService, 'requirePersonalData'>;
}

const DAY_MS = 86_400_000;
const HIDDEN_AFTER_DECLINE_DAYS: Record<DeclineReason, number> = { not_today: 3, dislike: 30 };

const within = (value: number, min: number, max: number) => value >= min && value <= max;

function requestProblems({ location, limit }: RecommendationRequest): ErrorDetail[] {
  const problems: ErrorDetail[] = [];
  if (!(Number.isInteger(limit) && within(limit, 1, MAX_RECOMMENDATIONS))) {
    problems.push({ path: 'limit', message: `must be an integer from 1 to ${MAX_RECOMMENDATIONS}` });
  }
  if (location) problems.push(...pointProblems(location));
  return problems;
}

function hiddenSince(now: Date): Record<DeclineReason, Date> {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return {
    not_today: daysAgo(HIDDEN_AFTER_DECLINE_DAYS.not_today),
    dislike: daysAgo(HIDDEN_AFTER_DECLINE_DAYS.dislike),
  };
}

function isBelow(minScore: number | undefined, [best]: readonly Recommendation[]): boolean {
  return minScore !== undefined && best !== undefined && best.score < minScore;
}

function toNewOffer({ candidate, score, explanation }: Recommendation): offers.NewOffer {
  return {
    venueId: candidate.venue.id,
    menuItemId: candidate.item.id,
    dealId: candidate.deal?.id ?? null,
    score,
    explanation,
  };
}

function toRecommendedOffer(
  recommendation: Recommendation,
  offer: Offer | undefined,
  now: Date,
): RecommendedOffer {
  if (!offer) throw new Error('Every recommendation must be stored as an offer');
  const { item, venue, deal } = recommendation.candidate;
  return {
    offerId: offer.id,
    item,
    venue,
    deal: deal ? { deal, item, status: dealStatus(deal, now) } : null,
    score: recommendation.score,
    distanceM: recommendation.distanceM,
    priceRub: recommendation.priceRub,
    kcal: recommendation.kcal,
    explanation: recommendation.explanation,
  };
}

export function createRecommendationsService({
  pool,
  clock,
  consents,
}: RecommendationsDependencies): RecommendationsService {
  return {
    async recommend(userId, request) {
      const problems = requestProblems(request);
      if (problems.length > 0) throw badRequest('validation_failed', 'Request validation failed', problems);
      await consents.requirePersonalData(userId);
      const { limit, channel } = request;
      const now = clock.now();
      const { user, profile, dayStart, today } = await loadEatingState(pool, userId, now);
      const location = request.location ?? user.location;
      const context: IntentContext = {
        now,
        user: {
          kcalTarget: user.kcalTarget,
          timezone: user.timezone,
          dislikedTags: user.dislikedTags,
          location,
        },
        today,
        profile,
        offeredTodayItemIds: new Set(),
        declinedItemIds: new Set(),
      };
      if (profile.readiness === 'empty') {
        const { slot, remainingKcal, slotBudgetKcal } = rankCandidates(context, [], { limit });
        return { status: 'profile_empty', slot, remainingKcal, slotBudgetKcal, items: [] };
      }
      const [offeredToday, declined, candidates] = await Promise.all([
        offers.listItemsShownSince(pool, user.id, dayStart),
        offers.listItemsDeclinedSince(pool, user.id, hiddenSince(now)),
        loadCandidates(pool, location ? boundingBox(location, DEFAULT_MAX_DISTANCE_M) : null, now),
      ]);
      const ranked = rankCandidates(
        { ...context, offeredTodayItemIds: new Set(offeredToday), declinedItemIds: new Set(declined) },
        candidates,
        { limit },
      );
      const { slot, remainingKcal, slotBudgetKcal } = ranked;
      if (isBelow(request.minScore, ranked.items)) {
        return { status: 'nothing_fits', slot, remainingKcal, slotBudgetKcal, items: [] };
      }
      const saved = await offers.insertShown(pool, {
        userId: user.id,
        channel,
        shownAt: now,
        offers: ranked.items.map(toNewOffer),
      });
      return {
        status: ranked.status,
        slot,
        remainingKcal,
        slotBudgetKcal,
        items: ranked.items.map((recommendation, index) =>
          toRecommendedOffer(recommendation, saved[index], now),
        ),
      };
    },

    async decline(userId, offerId, reason) {
      if (await offers.decline(pool, { id: offerId, userId, reason, at: clock.now() })) return;
      if ((await offers.findStatus(pool, userId, offerId)) === 'accepted') {
        throw conflict('offer_already_accepted', 'The offer is already booked and cannot be declined');
      }
      throw notFound('offer_not_found', 'Offer not found');
    },
  };
}
