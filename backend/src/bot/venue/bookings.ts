import { normalizeBookingCode } from '../../domain/bookings.ts';
import type { Venue } from '../../domain/models.ts';
import { can } from '../../domain/roles.ts';
import type { OutgoingMessage } from '../../ports/messenger.ts';
import type { VenueActor, Workplace } from '../../services/access.ts';
import type { BookingView } from '../../services/bookings.ts';
import { answerStale, parseId } from '../callbacks.ts';
import type { BotContext, BotKit, StartLinkHandler } from '../context.ts';
import { helpMessage } from '../messages.ts';
import { BUTTONS, NOTICES } from '../texts.ts';
import { bookingsRow, homeRow, pairs, venueButton } from './keyboards.ts';
import { actorAt, clearFlow, knownFailure, saveFlow, venueCallback, venueFlow } from './owner.ts';
import {
  bookingNotListed,
  bookingsText,
  CODE_INVALID,
  CODE_PROMPT,
  CODE_RETRY,
  redeemedText,
  redeemingText,
  redeemQuestion,
  REDEEM_KEPT,
  STAFF_ONLY,
  VENUE_BUTTONS,
  VENUE_ERROR_TEXTS,
  whichVenueText,
  withNote,
} from './texts.ts';

const REDEEM_BUTTONS_LIMIT = 20;
const REDEEM_FAILURES = ['booking_not_found', 'booking_expired', 'booking_not_active'] as const;

type RedeemOutcome = { view: BookingView } | { failure: (typeof REDEEM_FAILURES)[number] };

function codePrompt(text: string): OutgoingMessage {
  return { text, buttons: [[venueButton(BUTTONS.cancel, 'rd_no')]] };
}

function nextRedeemRow() {
  return [venueButton(VENUE_BUTTONS.redeemMore, 'redeem'), venueButton(VENUE_BUTTONS.bookings, 'bk')];
}

function listScreen(views: readonly BookingView[], venue: Venue): OutgoingMessage {
  const redeemButtons = views
    .slice(0, REDEEM_BUTTONS_LIMIT)
    .map(({ booking }) =>
      venueButton(`${VENUE_BUTTONS.redeemBooking} ${booking.code}`, 'rd', booking.code, venue.id),
    );
  return {
    text: bookingsText(views),
    buttons: [...pairs(redeemButtons), [venueButton(VENUE_BUTTONS.redeem, 'redeem')], homeRow()],
  };
}

function outcomeScreen(outcome: RedeemOutcome): OutgoingMessage {
  if ('view' in outcome) return { text: redeemedText(outcome.view), buttons: [nextRedeemRow()] };
  return { text: VENUE_ERROR_TEXTS[outcome.failure], buttons: [bookingsRow()] };
}

function venueArg(args: string[]): number | undefined {
  return parseId(args[1]) ?? undefined;
}

export function createBookingScreens({ services }: BotKit) {
  const { companies, bookings } = services;

  async function activeBooking(actor: VenueActor, code: string): Promise<BookingView | undefined> {
    const active = await bookings.listForVenue(actor, { status: 'active' });
    return active.find(({ booking }) => booking.code === code);
  }

  async function confirmation(ctx: BotContext, venue: Venue, input: string): Promise<OutgoingMessage> {
    const code = normalizeBookingCode(input);
    const view = code === null ? undefined : await activeBooking(actorAt(ctx, venue), code);
    if (!view) return { text: bookingNotListed(code ?? input), buttons: [bookingsRow()] };
    return {
      text: redeemQuestion(view),
      buttons: [
        [
          venueButton(VENUE_BUTTONS.redeemBooking, 'rd_ok', view.booking.code, venue.id),
          venueButton(BUTTONS.cancel, 'rd_no'),
        ],
      ],
    };
  }

  async function redeem(ctx: BotContext, venue: Venue, code: string): Promise<RedeemOutcome> {
    try {
      return { view: await bookings.redeem(actorAt(ctx, venue), code, 'bot') };
    } catch (error) {
      return { failure: knownFailure(error, REDEEM_FAILURES) };
    }
  }

  const list = venueCallback(companies, 'booking.redeem', async (ctx, venue) => {
    const active = await bookings.listForVenue(actorAt(ctx, venue), { status: 'active' });
    await ctx.answer({ message: listScreen(active, venue) });
  });

  const askCode = venueCallback(companies, 'booking.redeem', async (ctx) => {
    await saveFlow(ctx, { name: 'redeem_input' });
    await ctx.answer({ notification: NOTICES.opening });
    await ctx.reply(codePrompt(CODE_PROMPT));
  });

  const confirm = venueCallback(
    companies,
    'booking.redeem',
    async (ctx, venue, [value = '']) => {
      if (normalizeBookingCode(value) === null) await answerStale(ctx);
      else await ctx.answer({ message: await confirmation(ctx, venue, value) });
    },
    venueArg,
  );

  const redeemPressed = venueCallback(
    companies,
    'booking.redeem',
    async (ctx, venue, [value = '']) => {
      const code = normalizeBookingCode(value);
      if (code === null) {
        await answerStale(ctx);
        return;
      }
      await ctx.answer({
        message: { text: redeemingText(code, await activeBooking(actorAt(ctx, venue), code)) },
      });
      await ctx.reply(outcomeScreen(await redeem(ctx, venue, code)));
    },
    venueArg,
  );

  async function keep(ctx: BotContext): Promise<void> {
    await clearFlow(ctx, 'redeem_input');
    await ctx.answer({ message: { text: REDEEM_KEPT, buttons: [bookingsRow()] } });
  }

  const onCode = venueFlow(
    companies,
    'booking.redeem',
    (flow, message) => flow.name === 'redeem_input' && (message.text !== null || message.photos.length > 0),
    async (ctx, venue, message) => {
      const code = message.text === null ? null : normalizeBookingCode(message.text);
      if (code === null) {
        await ctx.reply(codePrompt(message.text === null ? CODE_PROMPT : CODE_INVALID));
        return true;
      }
      const outcome = await redeem(ctx, venue, code);
      if ('failure' in outcome && outcome.failure === 'booking_not_found') {
        await ctx.reply(codePrompt(`${VENUE_ERROR_TEXTS.booking_not_found}. ${CODE_RETRY}`));
        return true;
      }
      await clearFlow(ctx, 'redeem_input');
      await ctx.reply(outcomeScreen(outcome));
      return true;
    },
  );

  const staffLink: StartLinkHandler = async (ctx, value) => {
    const places = (await companies.workplaces(ctx.user.id)).filter((place) =>
      can(place.role, 'booking.redeem'),
    );
    const code = normalizeBookingCode(value);
    if (places.length === 0) {
      const help = helpMessage();
      await ctx.reply({ ...help, text: withNote(STAFF_ONLY, help.text) });
      return;
    }
    const matches: Workplace[] = [];
    if (code !== null) {
      for (const place of places) {
        if (await activeBooking(actorAt(ctx, place.venue), code)) matches.push(place);
      }
    }
    const [only, second] = matches;
    if (only && !second) {
      await ctx.reply(await confirmation(ctx, only.venue, value));
      return;
    }
    if (only && code !== null) {
      await ctx.reply({
        text: whichVenueText(code),
        buttons: matches.map(({ venue }) => [
          venueButton(`${VENUE_BUTTONS.redeemBooking} ${code}: ${venue.name}`, 'rd', code, venue.id),
        ]),
      });
      return;
    }
    const [first, other] = places;
    if (first && !other) await ctx.reply(await confirmation(ctx, first.venue, value));
    else await ctx.reply({ text: bookingNotListed(code ?? value), buttons: [bookingsRow()] });
  };

  return {
    list,
    askCode,
    confirm,
    redeem: redeemPressed,
    keep,
    onCode,
    staffLink,
  };
}
