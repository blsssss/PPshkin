import type { Venue } from '../../domain/models.ts';
import type { OutgoingMessage } from '../../ports/messenger.ts';
import type { VenuesService } from '../../services/venues.ts';
import { AppError } from '../../shared/errors.ts';
import { byAction } from '../callbacks.ts';
import type { BotContext, CallbackHandler, FlowHandler, MessageInput } from '../context.ts';
import { startFlow, type Flow } from '../state.ts';
import { NOTICES } from '../texts.ts';
import { VENUE_ERROR_TEXTS, type VenueErrorCode } from './texts.ts';

type VenueCallback = (ctx: BotContext, venue: Venue, args: string[]) => Promise<void>;
type VenueFlowHandler = (ctx: BotContext, venue: Venue, message: MessageInput) => Promise<boolean>;

interface WizardFlow {
  step: string;
  messageId: string | null;
}

export type WizardHandler<Current extends WizardFlow> = (
  ctx: BotContext,
  flow: Current,
  args: string[],
) => Promise<void>;

export function knownFailure<Code extends VenueErrorCode>(error: unknown, codes: readonly Code[]): Code {
  const code = error instanceof AppError ? codes.find((known) => known === error.code) : undefined;
  if (code === undefined) throw error;
  return code;
}

export async function findVenue(venues: VenuesService, ownerId: number): Promise<Venue | null> {
  try {
    return await venues.get(ownerId);
  } catch (error) {
    knownFailure(error, ['venue_not_found']);
    return null;
  }
}

export function withDefault(
  fallback: CallbackHandler,
  actions: Readonly<Record<string, CallbackHandler>>,
): CallbackHandler {
  const dispatch = byAction(actions);
  return (ctx, args) => (args.length === 0 ? fallback(ctx, args) : dispatch(ctx, args));
}

export function ownerCallback(venues: VenuesService, handler: VenueCallback): CallbackHandler {
  return async (ctx, args) => {
    const venue = await findVenue(venues, ctx.user.id);
    if (venue) await handler(ctx, venue, args);
    else await ctx.answer({ message: { text: VENUE_ERROR_TEXTS.venue_not_found } });
  };
}

export function ownerFlow(
  venues: VenuesService,
  accepts: (flow: Flow, message: MessageInput) => boolean,
  handler: VenueFlowHandler,
): FlowHandler {
  return async (ctx, message) => {
    const flow = ctx.state.flow;
    if (!flow || !accepts(flow, message)) return false;
    const venue = await findVenue(venues, ctx.user.id);
    if (venue) return handler(ctx, venue, message);
    await ctx.saveState({ ...ctx.state, flow: null });
    await ctx.reply({ text: VENUE_ERROR_TEXTS.venue_not_found });
    return true;
  };
}

export function wizardSteps<Current extends WizardFlow>(
  current: (ctx: BotContext) => Current | null,
  staleScreen: () => OutgoingMessage,
) {
  return (steps: readonly Current['step'][], handler: WizardHandler<Current>): CallbackHandler =>
    async (ctx, args) => {
      const flow = current(ctx);
      const shown = flow !== null && flow.messageId === ctx.callbackMessageId;
      if (shown && steps.includes(flow.step)) {
        await handler(ctx, flow, args);
      } else if (shown) {
        await ctx.answer({ notification: NOTICES.pressedButton });
      } else {
        await ctx.answer({ message: staleScreen() });
      }
    };
}

export async function saveFlow(ctx: BotContext, flow: Flow): Promise<void> {
  await ctx.saveState({ ...ctx.state, flow: startFlow(flow, ctx.now) });
}

export async function clearFlow(ctx: BotContext, name: Flow['name']): Promise<void> {
  if (ctx.state.flow?.name === name) await ctx.saveState({ ...ctx.state, flow: null });
}
