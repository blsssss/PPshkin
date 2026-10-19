import { COMPLAINT_REASON_TEXTS, COMPLAINT_REASONS, type ComplaintReason } from '../../domain/moderation.ts';
import { answerStale, byAction, parseId, payload } from '../callbacks.ts';
import type { BotContext, BotKit, BotModule } from '../context.ts';
import { describeFailure } from '../failures.ts';
import { callback } from '../keyboards.ts';
import { BUTTONS } from '../texts.ts';

export const COMPLAINT_TEXTS = {
  ask: 'Что случилось с бронью?',
  thanks: 'Спасибо, разберёмся. Итог пришлю сообщением.',
  cancelled: 'Хорошо, ничего не отправляю.',
} as const;

function isReason(value: string | undefined): value is ComplaintReason {
  return (COMPLAINT_REASONS as readonly string[]).includes(value ?? '');
}

export function createComplaintsModule({ services }: BotKit): BotModule {
  const { bookings, moderation } = services;

  async function ask(ctx: BotContext, [value]: string[]): Promise<void> {
    const bookingId = parseId(value);
    if (bookingId === null) {
      await answerStale(ctx);
      return;
    }
    await ctx.answer({
      message: {
        text: COMPLAINT_TEXTS.ask,
        buttons: [
          ...COMPLAINT_REASONS.map((reason) => [
            callback(COMPLAINT_REASON_TEXTS[reason], payload('cp', 'r', bookingId, reason)),
          ]),
          [callback(BUTTONS.cancel, payload('cp', 'x'))],
        ],
      },
    });
  }

  async function send(ctx: BotContext, [value, reason]: string[]): Promise<void> {
    const bookingId = parseId(value);
    if (bookingId === null || !isReason(reason)) {
      await answerStale(ctx);
      return;
    }
    try {
      const { booking } = await bookings.get(ctx.user.id, bookingId);
      await moderation.createComplaint(ctx.user.id, { venueId: booking.venueId, bookingId, reason });
      await ctx.answer({ message: { text: COMPLAINT_TEXTS.thanks } });
    } catch (error) {
      const failure = describeFailure(error);
      if (failure.kind !== 'known') throw error;
      await ctx.answer({ message: failure.message });
    }
  }

  async function dismiss(ctx: BotContext): Promise<void> {
    await ctx.answer({ message: { text: COMPLAINT_TEXTS.cancelled } });
  }

  return { callbacks: { cp: byAction({ new: ask, r: send, x: dismiss }) } };
}
