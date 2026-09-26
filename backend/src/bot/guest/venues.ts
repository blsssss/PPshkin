import { VENUE_CATEGORY_LABELS } from '../../domain/vocabulary.ts';
import { escapeMarkdown } from '../../integrations/max/messenger.ts';
import type { OutgoingMessage } from '../../ports/messenger.ts';
import type { DealCardView, VenueDetailsView } from '../../services/catalog.ts';
import type { DealView } from '../../services/deals.ts';
import { AppError } from '../../shared/errors.ts';
import { formatLocalTime, isOpenAt } from '../../shared/time.ts';
import { parseId } from '../callbacks.ts';
import type { BotContext, BotKit, BotModule } from '../context.ts';
import { helpButtons, placeButtons } from '../keyboards.ts';
import {
  bold,
  BUTTONS,
  capitalize,
  DEALS_TITLE,
  dealAvailability,
  dealPrice,
  DEMO_VENUE,
  limitedLines,
  NO_DEALS,
  OFFER_ENDED,
  OFFER_FORMS,
  openingStatus,
  TITLE_IN_LIST_LIMIT,
  truncate,
  venuePlace,
  venueSummary,
} from '../texts.ts';

const VENUE_DEALS_LIMIT = 5;

function missingAs(code: string) {
  return (error: unknown): null => {
    if (error instanceof AppError && error.code === code) return null;
    throw error;
  };
}

function offerEnded(): OutgoingMessage {
  return { text: OFFER_ENDED, buttons: helpButtons() };
}

function dealLine({ deal, item }: DealView, timeZone: string): string {
  const name = escapeMarkdown(truncate(item.name, TITLE_IN_LIST_LIMIT));
  const until = dealAvailability(formatLocalTime(deal.endsAt, timeZone), deal.quantityLeft);
  return `${name}: ${dealPrice(deal.priceRub, item.priceRub, item.kcal)}, ${until}`;
}

function venueCard({ venue, openNow, deals }: VenueDetailsView, ctx: BotContext): OutgoingMessage {
  const offers =
    deals.length > 0
      ? [
          DEALS_TITLE,
          ...limitedLines(
            deals.map((view) => dealLine(view, venue.timezone)),
            VENUE_DEALS_LIMIT,
            OFFER_FORMS,
          ),
        ]
      : [NO_DEALS];
  return {
    text: [
      bold(venue.name),
      venueSummary(VENUE_CATEGORY_LABELS[venue.category], venue.address),
      openingStatus(openNow, venue.opensAt, venue.closesAt),
      ...(venue.isDemo ? [DEMO_VENUE] : []),
      '',
      ...offers,
    ].join('\n'),
    buttons: placeButtons({
      location: venue.location,
      botUsername: ctx.botUsername,
      miniAppEnabled: ctx.miniAppEnabled,
      appLabel: BUTTONS.venueInApp,
      startParam: `venue_${venue.id}`,
    }),
  };
}

function dealCard(
  { deal: { deal, item }, venue, distanceM }: DealCardView,
  ctx: BotContext,
): OutgoingMessage {
  const openNow = isOpenAt(venue.opensAt, venue.closesAt, ctx.now, venue.timezone);
  return {
    text: [
      bold(item.name),
      dealPrice(deal.priceRub, item.priceRub, item.kcal),
      capitalize(dealAvailability(formatLocalTime(deal.endsAt, venue.timezone), deal.quantityLeft)),
      venuePlace(venue.name, venue.address, distanceM),
      ...(openNow ? [] : [openingStatus(false, venue.opensAt, venue.closesAt)]),
      ...(venue.isDemo ? [DEMO_VENUE] : []),
    ].join('\n'),
    buttons: placeButtons({
      location: venue.location,
      botUsername: ctx.botUsername,
      miniAppEnabled: ctx.miniAppEnabled,
      appLabel: BUTTONS.openInApp,
      startParam: `deal_${deal.id}`,
    }),
  };
}

export function createVenuesModule({ services }: BotKit): BotModule {
  const { catalog } = services;

  return {
    startLinks: {
      v: async (ctx, value) => {
        const venueId = parseId(value);
        const details =
          venueId === null
            ? null
            : await catalog.venue(ctx.user.id, venueId).catch(missingAs('venue_not_found'));
        await ctx.reply(details ? venueCard(details, ctx) : offerEnded());
      },
      d: async (ctx, value) => {
        const dealId = parseId(value);
        const card =
          dealId === null ? null : await catalog.deal(ctx.user.id, dealId).catch(missingAs('deal_not_found'));
        await ctx.reply(card ? dealCard(card, ctx) : offerEnded());
      },
    },
  };
}
