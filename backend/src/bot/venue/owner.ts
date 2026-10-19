import type { Venue } from '../../domain/models.ts';
import { can, type Permission, type Role } from '../../domain/roles.ts';
import type { OutgoingMessage } from '../../ports/messenger.ts';
import type { VenueActor, Workplace } from '../../services/access.ts';
import type { CompaniesService } from '../../services/companies.ts';
import { AppError } from '../../shared/errors.ts';
import { byAction } from '../callbacks.ts';
import type { BotContext, CallbackHandler, FlowHandler, MessageInput } from '../context.ts';
import { startFlow, type Flow } from '../state.ts';
import { NOTICES } from '../texts.ts';
import { venueButton } from './keyboards.ts';
import { PICK_VENUE, ROLE_LABELS, VENUE_ERROR_TEXTS, type VenueErrorCode } from './texts.ts';

type VenueCallback = (ctx: BotContext, venue: Venue, args: string[], role: Role) => Promise<void>;
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

export interface VenueScope {
  place: Workplace;
  actor: VenueActor;
}

type Resolution =
  | { kind: 'ok'; scope: VenueScope }
  | { kind: 'none' }
  | { kind: 'pick'; places: Workplace[] }
  | { kind: 'forbidden' };

export function actorAt(ctx: BotContext, venue: Venue): VenueActor {
  return { userId: ctx.user.id, venueId: venue.id };
}

export function activeVenueIn(
  places: readonly Workplace[],
  activeVenueId: number | null,
  explicitVenueId?: number,
): Workplace | 'pick' | null {
  if (explicitVenueId !== undefined)
    return places.find((place) => place.venue.id === explicitVenueId) ?? null;
  const [first, second] = places;
  if (!first) return null;
  if (!second) return first;
  return places.find((place) => place.venue.id === activeVenueId) ?? 'pick';
}

export async function resolveScope(
  companies: CompaniesService,
  ctx: BotContext,
  permission: Permission,
  explicitVenueId?: number,
): Promise<Resolution> {
  const places = await companies.workplaces(ctx.user.id);
  const found = activeVenueIn(places, ctx.state.activeVenueId, explicitVenueId);
  if (found === null) return { kind: 'none' };
  if (found === 'pick') return { kind: 'pick', places };
  if (!can(found.role, permission)) return { kind: 'forbidden' };
  return { kind: 'ok', scope: { place: found, actor: actorAt(ctx, found.venue) } };
}

export function pickScreen(places: readonly Workplace[]): OutgoingMessage {
  return {
    text: PICK_VENUE,
    buttons: places.map(({ venue, role }) => [
      venueButton(`${venue.name}, ${ROLE_LABELS[role]}`, 'pick', venue.id),
    ]),
  };
}

function refusal(resolution: Exclude<Resolution, { kind: 'ok' }>): OutgoingMessage {
  if (resolution.kind === 'pick') return pickScreen(resolution.places);
  return {
    text:
      resolution.kind === 'forbidden' ? VENUE_ERROR_TEXTS.venue_forbidden : VENUE_ERROR_TEXTS.venue_not_found,
  };
}

export function withDefault(
  fallback: CallbackHandler,
  actions: Readonly<Record<string, CallbackHandler>>,
): CallbackHandler {
  const dispatch = byAction(actions);
  return (ctx, args) => (args.length === 0 ? fallback(ctx, args) : dispatch(ctx, args));
}

export function venueCallback(
  companies: CompaniesService,
  permission: Permission,
  handler: VenueCallback,
  explicitVenue?: (args: string[]) => number | undefined,
): CallbackHandler {
  return async (ctx, args) => {
    const resolution = await resolveScope(companies, ctx, permission, explicitVenue?.(args));
    if (resolution.kind === 'ok') {
      await handler(ctx, resolution.scope.place.venue, args, resolution.scope.place.role);
    } else await ctx.answer({ message: refusal(resolution) });
  };
}

export function venueFlow(
  companies: CompaniesService,
  permission: Permission,
  accepts: (flow: Flow, message: MessageInput) => boolean,
  handler: VenueFlowHandler,
): FlowHandler {
  return async (ctx, message) => {
    const flow = ctx.state.flow;
    if (!flow || !accepts(flow, message)) return false;
    const resolution = await resolveScope(companies, ctx, permission);
    if (resolution.kind === 'ok') return handler(ctx, resolution.scope.place.venue, message);
    await ctx.saveState({ ...ctx.state, flow: null });
    await ctx.reply(refusal(resolution));
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
