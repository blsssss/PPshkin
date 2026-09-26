import { normalizeBookingCode } from '../../domain/bookings.ts';
import type { OutgoingMessage } from '../../ports/messenger.ts';
import type { BookingView } from '../../services/bookings.ts';
import { answerStale } from '../callbacks.ts';
import type { BotContext, BotKit, StartLinkHandler } from '../context.ts';
import { helpMessage } from '../messages.ts';
import { BUTTONS, NOTICES } from '../texts.ts';
import { bookingsRow, homeRow, pairs, venueButton } from './keyboards.ts';
import { clearFlow, findVenue, knownFailure, ownerCallback, ownerFlow, saveFlow } from './owner.ts';
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

function listScreen(views: readonly BookingView[]): OutgoingMessage {
  const redeemButtons = views
    .slice(0, REDEEM_BUTTONS_LIMIT)
    .map(({ booking }) => venueButton(`${VENUE_BUTTONS.redeemBooking} ${booking.code}`, 'rd', booking.code));
  return {
    text: bookingsText(views),
    buttons: [...pairs(redeemButtons), [venueButton(VENUE_BUTTONS.redeem, 'redeem')], homeRow()],
  };
}

function outcomeScreen(outcome: RedeemOutcome): OutgoingMessage {
  if ('view' in outcome) return { text: redeemedText(outcome.view), buttons: [nextRedeemRow()] };
  return { text: VENUE_ERROR_TEXTS[outcome.failure], buttons: [bookingsRow()] };
}

export function createBookingScreens({ services }: BotKit) {
  const { venues, bookings } = services;

  async function activeBooking(ownerId: number, code: string): Promise<BookingView | undefined> {
    const active = await bookings.listForVenue(ownerId, { status: 'active' });
    return active.find(({ booking }) => booking.code === code);
  }

  async function confirmation(ownerId: number, input: string): Promise<OutgoingMessage> {
    const code = normalizeBookingCode(input);
    const view = code === null ? undefined : await activeBooking(ownerId, code);
    if (!view) return { text: bookingNotListed(code ?? input), buttons: [bookingsRow()] };
    return {
      text: redeemQuestion(view),
      buttons: [
        [
          venueButton(VENUE_BUTTONS.redeemBooking, 'rd_ok', view.booking.code),
          venueButton(BUTTONS.cancel, 'rd_no'),
        ],
      ],
    };
  }

  async function redeem(ownerId: number, code: string): Promise<RedeemOutcome> {
    try {
      return { view: await bookings.redeem(ownerId, code) };
    } catch (error) {
      return { failure: knownFailure(error, REDEEM_FAILURES) };
    }
  }

  const list = ownerCallback(venues, async (ctx) => {
    await ctx.answer({ message: listScreen(await bookings.listForVenue(ctx.user.id, { status: 'active' })) });
  });

  const askCode = ownerCallback(venues, async (ctx) => {
    await saveFlow(ctx, { name: 'redeem_input' });
    await ctx.answer({ notification: NOTICES.opening });
    await ctx.reply(codePrompt(CODE_PROMPT));
  });

  const confirm = ownerCallback(venues, async (ctx, _venue, [value = '']) => {
    if (normalizeBookingCode(value) === null) await answerStale(ctx);
    else await ctx.answer({ message: await confirmation(ctx.user.id, value) });
  });

  const redeemPressed = ownerCallback(venues, async (ctx, _venue, [value = '']) => {
    const code = normalizeBookingCode(value);
    if (code === null) {
      await answerStale(ctx);
      return;
    }
    await ctx.answer({ message: { text: redeemingText(code, await activeBooking(ctx.user.id, code)) } });
    await ctx.reply(outcomeScreen(await redeem(ctx.user.id, code)));
  });

  async function keep(ctx: BotContext): Promise<void> {
    await clearFlow(ctx, 'redeem_input');
    await ctx.answer({ message: { text: REDEEM_KEPT, buttons: [bookingsRow()] } });
  }

  const onCode = ownerFlow(
    venues,
    (flow, message) => flow.name === 'redeem_input' && (message.text !== null || message.photos.length > 0),
    async (ctx, _venue, message) => {
      const code = message.text === null ? null : normalizeBookingCode(message.text);
      if (code === null) {
        await ctx.reply(codePrompt(message.text === null ? CODE_PROMPT : CODE_INVALID));
        return true;
      }
      const outcome = await redeem(ctx.user.id, code);
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
    if (await findVenue(venues, ctx.user.id)) {
      await ctx.reply(await confirmation(ctx.user.id, value));
      return;
    }
    const help = helpMessage();
    await ctx.reply({ ...help, text: withNote(STAFF_ONLY, help.text) });
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
