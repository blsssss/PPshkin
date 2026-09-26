import type { Booking } from '../../domain/models.ts';
import type { OutgoingMessage } from '../../ports/messenger.ts';
import type { BookingInput, BookingView } from '../../services/bookings.ts';
import { AppError } from '../../shared/errors.ts';
import { formatLocalTime } from '../../shared/time.ts';
import { answerStale, byAction, parseId } from '../callbacks.ts';
import type { BotContext, BotKit, BotModule } from '../context.ts';
import { describeFailure } from '../failures.ts';
import { command, eatButton, placeButtons } from '../keyboards.ts';
import { BUTTONS, DEMO_VENUE, shortDate, venuePlace } from '../texts.ts';
import { bookingButtons, cancelBookingButtons } from './offer-keyboards.ts';
import {
  bookingCancelled,
  bookingInactive,
  bookingItem,
  bookingTitle,
  bookingValidUntil,
  cancelQuestion,
  HISTORY_TITLE,
  historyLine,
  NO_ACTIVE_BOOKINGS,
  OFFER_NOTICES,
} from './offer-texts.ts';
import { offerCardText, shownCard } from './offers.ts';

const HISTORY_LIMIT = 5;
const NONE = '0';
const TO_BOOKINGS = new Set(['too_many_bookings', 'booking_exists']);

interface BookRequest {
  menuItemId: number;
  dealId: number | null;
  offerId: number | null;
}

function optionalId(value: string): number | null | undefined {
  return value === NONE ? null : (parseId(value) ?? undefined);
}

function parseBookRequest([item, deal = NONE, offer = NONE]: string[]): BookRequest | null {
  const menuItemId = parseId(item);
  const dealId = optionalId(deal);
  const offerId = optionalId(offer);
  if (menuItemId === null || dealId === undefined || offerId === undefined) return null;
  return { menuItemId, dealId, offerId };
}

function bookingInput({ menuItemId, dealId, offerId }: BookRequest): BookingInput {
  return {
    menuItemId,
    ...(dealId === null ? {} : { dealId }),
    ...(offerId === null ? {} : { offerId }),
  };
}

function bookingFailure(error: unknown): OutgoingMessage | null {
  const failure = describeFailure(error);
  if (failure.kind !== 'known') return null;
  const toBookings = error instanceof AppError && TO_BOOKINGS.has(error.code);
  return {
    ...failure.message,
    buttons: [[toBookings ? command(BUTTONS.bookings, 'bookings') : eatButton()]],
  };
}

function historyText(views: readonly BookingView[]): string | null {
  const lines = views
    .flatMap(({ booking, venue }) =>
      booking.status === 'active'
        ? []
        : [
            historyLine(
              shortDate(booking.createdAt, venue.timezone),
              booking.itemName,
              venue.name,
              booking.status,
            ),
          ],
    )
    .slice(0, HISTORY_LIMIT);
  return lines.length > 0 ? [HISTORY_TITLE, ...lines].join('\n') : null;
}

function bookingCard({ booking, venue }: BookingView, ctx: BotContext, showQr: boolean): OutgoingMessage {
  return {
    text: [
      bookingTitle(booking.code),
      bookingItem(booking.itemName, booking.priceRub),
      venuePlace(venue.name, venue.address, null),
      bookingValidUntil(formatLocalTime(booking.expiresAt, venue.timezone)),
      ...(venue.isDemo ? [DEMO_VENUE] : []),
    ].join('\n'),
    buttons: bookingButtons({
      bookingId: booking.id,
      showQr,
      place: placeButtons({
        location: venue.location,
        botUsername: ctx.botUsername,
        miniAppEnabled: ctx.miniAppEnabled,
        appLabel: BUTTONS.openInApp,
        startParam: `booking_${booking.id}`,
      }),
    }),
  };
}

async function answerKnown<T>(ctx: BotContext, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    const failure = describeFailure(error);
    if (failure.kind !== 'known') throw error;
    await ctx.answer({ message: failure.message });
    return null;
  }
}

export function createBookingsModule({ services, messenger, logger }: BotKit): BotModule {
  const { bookings } = services;

  async function uploadQr(ctx: BotContext, booking: Booking): Promise<string | null> {
    try {
      const png = await bookings.qr(ctx.user.id, booking.id);
      return await messenger.uploadImage(png, `booking-${booking.code}.png`);
    } catch (error) {
      logger.warn({ err: error, userId: ctx.user.id, bookingId: booking.id }, 'booking qr was not uploaded');
      return null;
    }
  }

  async function withQr(ctx: BotContext, view: BookingView): Promise<OutgoingMessage | null> {
    const token = await uploadQr(ctx, view.booking);
    return token === null ? null : { ...bookingCard(view, ctx, false), imageTokens: [token] };
  }

  async function create(ctx: BotContext, request: BookRequest): Promise<BookingView | null> {
    try {
      return await bookings.create(ctx.user.id, bookingInput(request));
    } catch (error) {
      const failure = bookingFailure(error);
      if (failure === null) throw error;
      await ctx.reply(failure);
      return null;
    }
  }

  async function book(ctx: BotContext, args: string[]): Promise<void> {
    const request = parseBookRequest(args);
    if (request === null) {
      await answerStale(ctx);
      return;
    }
    const card = shownCard(ctx.state.offerQueue, ctx.callbackMessageId, request.offerId);
    if (card === null) {
      await ctx.answer({ notification: OFFER_NOTICES.booking });
    } else {
      await ctx.saveState({ ...ctx.state, offerQueue: null });
      await ctx.answer({ message: { text: offerCardText(card) } });
    }
    const view = await create(ctx, request);
    if (view === null) return;
    await ctx.reply((await withQr(ctx, view)) ?? bookingCard(view, ctx, true));
  }

  async function activeBooking(ctx: BotContext, value: string | undefined): Promise<BookingView | null> {
    const bookingId = parseId(value);
    if (bookingId === null) {
      await answerStale(ctx);
      return null;
    }
    const view = await answerKnown(ctx, () => bookings.get(ctx.user.id, bookingId));
    if (view === null || view.booking.status === 'active') return view;
    await ctx.answer({ message: { text: bookingInactive(view.booking.code) } });
    return null;
  }

  async function showQr(ctx: BotContext, [value]: string[]): Promise<void> {
    const view = await activeBooking(ctx, value);
    if (view === null) return;
    const message = await withQr(ctx, view);
    await ctx.answer(message === null ? { notification: OFFER_NOTICES.qrFailed } : { message });
  }

  async function askCancel(ctx: BotContext, [value]: string[]): Promise<void> {
    const view = await activeBooking(ctx, value);
    if (view === null) return;
    const { booking } = view;
    await ctx.answer({
      message: { text: cancelQuestion(booking.code), buttons: cancelBookingButtons(booking.id) },
    });
  }

  async function cancel(ctx: BotContext, [value]: string[]): Promise<void> {
    const bookingId = parseId(value);
    if (bookingId === null) {
      await answerStale(ctx);
      return;
    }
    const view = await answerKnown(ctx, () => bookings.cancel(ctx.user.id, bookingId));
    if (view !== null) await ctx.answer({ message: { text: bookingCancelled(view.booking.code) } });
  }

  async function keep(ctx: BotContext, [value]: string[]): Promise<void> {
    const view = await activeBooking(ctx, value);
    if (view !== null) await ctx.answer({ message: bookingCard(view, ctx, true) });
  }

  async function list(ctx: BotContext): Promise<void> {
    const active = await bookings.list(ctx.user.id, 'active');
    const history = historyText(await bookings.list(ctx.user.id, 'history'));
    if (active.length === 0) await ctx.reply({ text: NO_ACTIVE_BOOKINGS, buttons: [[eatButton()]] });
    for (const view of active) await ctx.reply(bookingCard(view, ctx, true));
    if (history !== null) await ctx.reply({ text: history });
  }

  return {
    commands: { bookings: list },
    callbacks: {
      bk: byAction({ new: book, qr: showQr, cancel: askCancel, cancel_ok: cancel, keep }),
    },
  };
}
