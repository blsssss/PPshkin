import type { User } from '../../domain/models.ts';
import { onlyKnownTags, TAG_LABELS, type DeclineReason, type Tag } from '../../domain/vocabulary.ts';
import { UserUnreachableError } from '../../integrations/max/errors.ts';
import { escapeMarkdown } from '../../integrations/max/messenger.ts';
import type { Button, OutgoingMessage } from '../../ports/messenger.ts';
import type {
  RecommendationRequest,
  RecommendationsResult,
  RecommendedOffer,
} from '../../services/recommendations.ts';
import { localDate } from '../../shared/time.ts';
import { answerStale, byAction, parseId } from '../callbacks.ts';
import type { BotContext, BotKit, BotModule } from '../context.ts';
import { command, eatButton, placeButtons } from '../keyboards.ts';
import { startFlow, type ActiveFlow, type ChatState } from '../state.ts';
import { bold, BUTTONS, NOTICES, venuePlace } from '../texts.ts';
import type { OfferCard, OfferQueue } from './offer-card.ts';
import {
  bookButton,
  demoDiaryButtons,
  dislikeButtons,
  eatLocationButtons,
  elsewhereButtons,
  nothingFitsButtons,
  offerActionButtons,
  splitTags,
  stopHintsButtons,
} from './offer-keyboards.ts';
import {
  budgetExhausted,
  DEMO_DIARY_ADDED,
  DISLIKE_ACCEPTED,
  dislikedNow,
  FAR_FROM_KAZAN,
  NOT_TODAY_ACCEPTED,
  nothingFits,
  OFFER_BUTTONS,
  OFFER_NOTICES,
  offerFacts,
  PROFILE_EMPTY,
  profileCollecting,
  WHERE_ARE_YOU,
  WHY,
} from './offer-texts.ts';

const CONTEXTUAL_MIN_SCORE = 0.5;

const RECOMMENDATION_REQUEST: RecommendationRequest = { location: null, limit: 3, channel: 'bot' };
const CONTEXTUAL_REQUEST: RecommendationRequest = {
  ...RECOMMENDATION_REQUEST,
  minScore: CONTEXTUAL_MIN_SCORE,
};
const QUEUE_TTL_MS = 30 * 60_000;
const LOCATION_STALE_MS = 12 * 3_600_000;

interface OfferCardOptions {
  miniAppEnabled: boolean;
  botUsername: string;
  locationStale: boolean;
}

type Whereabouts = Pick<User, 'location' | 'locationUpdatedAt'>;
type Deliver = (message: OutgoingMessage) => Promise<string | null>;

export function toOfferCard(offer: RecommendedOffer): OfferCard {
  const { item, venue, deal, explanation } = offer;
  return {
    offerId: offer.offerId,
    menuItemId: item.id,
    dealId: deal?.deal.id ?? null,
    venueId: venue.id,
    headline: explanation.headline,
    itemName: item.name,
    venueName: venue.name,
    venueAddress: venue.address,
    location: venue.location,
    priceRub: offer.priceRub,
    kcal: offer.kcal,
    distanceM: offer.distanceM,
    reasons: [...explanation.facts, ...explanation.calculations],
    assumptions: [...explanation.assumptions],
    tags: [...item.tags],
  };
}

export function offerCardText(card: OfferCard): string {
  const reasons = card.reasons.map((reason) => `- ${escapeMarkdown(reason)}`);
  return [
    bold(card.headline),
    escapeMarkdown(card.itemName),
    venuePlace(card.venueName, card.venueAddress, null),
    offerFacts(card.priceRub, card.kcal, card.distanceM),
    ...(reasons.length > 0 ? ['', WHY, ...reasons] : []),
    ...card.assumptions.map((note) => `*${escapeMarkdown(note)}*`),
  ].join('\n');
}

export function renderOfferCard(card: OfferCard, options: OfferCardOptions): OutgoingMessage {
  return {
    text: offerCardText(card),
    buttons: [
      [bookButton(OFFER_BUTTONS.book, card)],
      offerActionButtons(card.offerId, card.tags),
      ...placeButtons({
        location: card.location,
        botUsername: options.botUsername,
        miniAppEnabled: options.miniAppEnabled,
        appLabel: BUTTONS.openInApp,
        startParam: card.dealId === null ? `venue_${card.venueId}` : `deal_${card.dealId}`,
      }),
      ...(options.locationStale ? elsewhereButtons() : []),
    ],
  };
}

export function dislikeMessage(offered: readonly Tag[], disliked: readonly Tag[]): OutgoingMessage {
  const excluded = offered.filter((tag) => disliked.includes(tag)).map((tag) => TAG_LABELS[tag]);
  return {
    text: excluded.length > 0 ? `${DISLIKE_ACCEPTED}\n${dislikedNow(excluded)}` : DISLIKE_ACCEPTED,
    buttons: dislikeButtons(offered, disliked),
  };
}

export function isLocationStale({ location, locationUpdatedAt }: Whereabouts, now: Date): boolean {
  if (location === null) return false;
  return locationUpdatedAt === null || now.getTime() - locationUpdatedAt.getTime() > LOCATION_STALE_MS;
}

export function withoutTag(queue: OfferQueue, tag: Tag): OfferQueue {
  return { ...queue, cards: queue.cards.filter((card, index) => index === 0 || !card.tags.includes(tag)) };
}

export function shownCard(
  queue: OfferQueue | null,
  messageId: string | null,
  offerId: number | null,
): OfferCard | null {
  const [card] = queue?.cards ?? [];
  if (card === undefined || messageId === null || queue?.messageId !== messageId) return null;
  return card.offerId === offerId ? card : null;
}

function queueOf(messageId: string | null, cards: OfferCard[], now: Date): OfferQueue | null {
  if (messageId === null || cards.length === 0) return null;
  return { messageId, cards, expiresAt: new Date(now.getTime() + QUEUE_TTL_MS).toISOString() };
}

function liveQueue(ctx: BotContext): OfferQueue | null {
  const queue = ctx.state.offerQueue;
  if (queue?.messageId !== ctx.callbackMessageId) return null;
  return Date.parse(queue.expiresAt) > ctx.now.getTime() ? queue : null;
}

function locationFlow(ctx: BotContext): ActiveFlow | null {
  const flow = ctx.state.flow;
  return flow === null || flow.name === 'eat_location' ? startFlow({ name: 'eat_location' }, ctx.now) : flow;
}

function queuedState(ctx: BotContext, offerQueue: OfferQueue | null, options: OfferCardOptions): ChatState {
  return { ...ctx.state, offerQueue, flow: options.locationStale ? locationFlow(ctx) : ctx.state.flow };
}

function cardOptions(ctx: BotContext, whereabouts: Whereabouts): OfferCardOptions {
  return {
    miniAppEnabled: ctx.miniAppEnabled,
    botUsername: ctx.botUsername,
    locationStale: isLocationStale(whereabouts, ctx.now),
  };
}

function statusMessage(result: RecommendationsResult, nearby: boolean): OutgoingMessage {
  switch (result.status) {
    case 'profile_empty':
      return { text: PROFILE_EMPTY, buttons: [[command(OFFER_BUTTONS.howToLog, 'help')]] };
    case 'budget_exhausted':
      return {
        text: budgetExhausted(result.remainingKcal),
        buttons: [[command(BUTTONS.profile, 'profile')]],
      };
    case 'ok':
    case 'nothing_fits':
      return { text: nothingFits(result.remainingKcal, nearby), buttons: nothingFitsButtons(nearby) };
  }
}

export function createMealSuggestion({ services, logger }: BotKit): (ctx: BotContext) => Promise<void> {
  const { consents, insights, recommendations } = services;

  async function suggest(ctx: BotContext): Promise<void> {
    const today = localDate(ctx.now, ctx.user.timezone);
    if (ctx.state.contextualOfferOn === today) return;
    const { personalizedOffers } = await consents.status(ctx.user.id);
    if (!personalizedOffers.granted) return;
    const { profile } = await insights.get(ctx.user.id);
    if (profile.readiness !== 'ready') return;
    const result = await recommendations.recommend(ctx.user.id, CONTEXTUAL_REQUEST);
    if (result.status !== 'ok' || (result.items[0]?.score ?? 0) < CONTEXTUAL_MIN_SCORE) return;
    const cards = result.items.map(toOfferCard);
    const [first] = cards;
    if (first === undefined) return;
    const options = cardOptions(ctx, ctx.user);
    const card = renderOfferCard(first, options);
    const sent = await ctx.reply({ ...card, buttons: [...(card.buttons ?? []), ...stopHintsButtons()] });
    await ctx.saveState({
      ...queuedState(ctx, queueOf(sent.messageId, cards, ctx.now), options),
      contextualOfferOn: today,
    });
  }

  return async (ctx) => {
    try {
      await suggest(ctx);
    } catch (error) {
      if (error instanceof UserUnreachableError) throw error;
      logger.warn({ err: error, userId: ctx.user.id }, 'contextual offer failed');
    }
  };
}

function withLead(message: OutgoingMessage, notes: readonly string[], rows: Button[][]): OutgoingMessage {
  if (notes.length === 0 && rows.length === 0) return message;
  const text = [...notes, message.text].join('\n\n');
  return { ...message, text, buttons: [...(message.buttons ?? []), ...rows] };
}

export function createOffersModule({ services }: BotKit): BotModule {
  const { demo, insights, profile, recommendations } = services;

  const replyWith =
    (ctx: BotContext): Deliver =>
    async (message) =>
      (await ctx.reply(message)).messageId;

  const replaceWith =
    (ctx: BotContext): Deliver =>
    async (message) => {
      await ctx.answer({ message });
      return ctx.callbackMessageId;
    };

  async function showOffers(ctx: BotContext, deliver: Deliver, whereabouts: Whereabouts): Promise<void> {
    const [result, insight] = await Promise.all([
      recommendations.recommend(ctx.user.id, RECOMMENDATION_REQUEST),
      insights.get(ctx.user.id),
    ]);
    const cards = result.status === 'ok' ? result.items.map(toOfferCard) : [];
    const [first] = cards;
    const { readiness, mealsUntilReady } = insight.profile;
    const far = result.demoCenterUsed ? [FAR_FROM_KAZAN] : [];
    const sample = demo.enabled && readiness !== 'ready' ? demoDiaryButtons() : [];
    if (first === undefined) {
      const nearby = whereabouts.location !== null;
      await deliver(withLead(statusMessage(result, nearby), far, sample));
      if (result.status === 'nothing_fits') await ctx.saveState({ ...ctx.state, flow: locationFlow(ctx) });
      return;
    }
    const options = cardOptions(ctx, whereabouts);
    const card = renderOfferCard(first, options);
    const collecting = readiness === 'collecting' ? [profileCollecting(mealsUntilReady)] : [];
    const messageId = await deliver(withLead(card, [...far, ...collecting], sample));
    await ctx.saveState(queuedState(ctx, queueOf(messageId, cards, ctx.now), options));
  }

  async function eat(ctx: BotContext): Promise<void> {
    if (ctx.user.location === null) {
      await ctx.saveState({ ...ctx.state, flow: startFlow({ name: 'eat_location' }, ctx.now) });
      await ctx.reply({ text: WHERE_ARE_YOU, buttons: eatLocationButtons() });
      return;
    }
    await showOffers(ctx, replyWith(ctx), ctx.user);
  }

  async function searchAnywhere(ctx: BotContext): Promise<void> {
    if (ctx.user.location !== null) {
      await ctx.answer({ notification: NOTICES.staleButton });
      return;
    }
    const pressed = ctx.callbackMessageId;
    if (pressed !== null && ctx.state.offerQueue?.messageId === pressed) {
      await ctx.answer({ notification: NOTICES.pressedButton });
      return;
    }
    if (ctx.state.flow?.name === 'eat_location') await ctx.saveState({ ...ctx.state, flow: null });
    await showOffers(ctx, replaceWith(ctx), ctx.user);
  }

  async function showNext(ctx: BotContext, [value]: string[]): Promise<void> {
    const queue = liveQueue(ctx);
    if (queue !== null && shownCard(queue, ctx.callbackMessageId, parseId(value)) === null) {
      await ctx.answer({ notification: NOTICES.pressedButton });
      return;
    }
    const [, next, ...rest] = queue?.cards ?? [];
    if (queue === null || next === undefined) {
      await ctx.answer({ notification: OFFER_NOTICES.noMoreOffers });
      return;
    }
    const options = cardOptions(ctx, ctx.user);
    await ctx.saveState(queuedState(ctx, { ...queue, cards: [next, ...rest] }, options));
    await ctx.answer({ message: renderOfferCard(next, options) });
  }

  async function decline(
    ctx: BotContext,
    value: string | undefined,
    reason: DeclineReason,
    acknowledgement: OutgoingMessage,
  ): Promise<void> {
    const offerId = parseId(value);
    if (offerId === null) {
      await answerStale(ctx);
      return;
    }
    await recommendations.decline(ctx.user.id, offerId, reason);
    const queue = liveQueue(ctx);
    const declined = shownCard(queue, ctx.callbackMessageId, offerId);
    await ctx.answer({ message: acknowledgement });
    if (queue === null || declined === null) return;
    const [, next, ...rest] = queue.cards;
    if (next === undefined) {
      await ctx.saveState({ ...ctx.state, offerQueue: null });
      return;
    }
    const options = cardOptions(ctx, ctx.user);
    const sent = await ctx.reply(renderOfferCard(next, options));
    await ctx.saveState(
      queuedState(ctx, { ...queue, messageId: sent.messageId, cards: [next, ...rest] }, options),
    );
  }

  async function fillDemoDiary(ctx: BotContext): Promise<void> {
    await demo.fillDiary(ctx.user.id);
    await ctx.answer({ message: { text: DEMO_DIARY_ADDED, buttons: [[eatButton()]] } });
  }

  return {
    commands: { eat },
    callbacks: {
      of: byAction({
        demo: fillDemoDiary,
        next: showNext,
        any: searchAnywhere,
        nt: (ctx, [value]) => decline(ctx, value, 'not_today', { text: NOT_TODAY_ACCEPTED }),
        dl: (ctx, [value, tags]) =>
          decline(
            ctx,
            value,
            'dislike',
            dislikeMessage(onlyKnownTags(splitTags(tags)), ctx.user.dislikedTags),
          ),
      }),
    },
    flows: {
      eat_location: async (ctx, message) => {
        if (ctx.state.flow?.name !== 'eat_location') return false;
        await ctx.saveState({ ...ctx.state, flow: null });
        if (!message.location) return false;
        const saved = await profile.setLocation(ctx.user.id, message.location);
        await showOffers(ctx, replyWith(ctx), {
          location: saved.location,
          locationUpdatedAt: saved.updatedAt,
        });
        return true;
      },
    },
  };
}
