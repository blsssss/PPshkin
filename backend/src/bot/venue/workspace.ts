import type { Venue } from '../../domain/models.ts';
import { VENUE_CATEGORIES, VENUE_CATEGORY_LABELS, type VenueCategory } from '../../domain/vocabulary.ts';
import type { Button, OutgoingMessage } from '../../ports/messenger.ts';
import { isOpenAt } from '../../shared/time.ts';
import { answerStale } from '../callbacks.ts';
import type { BotContext, BotKit, MessageInput } from '../context.ts';
import { link, locationRequest, routeUrl } from '../keyboards.ts';
import type { ActiveFlow, Flow } from '../state.ts';
import { BUTTONS } from '../texts.ts';
import type { VenueDraft } from './flows.ts';
import { parseCoordinates, parseHours, parseTitle, VENUE_ADDRESS_LIMIT, VENUE_NAME_LIMIT } from './input.ts';
import { homeButtons, pairs, startLinkUrl, uploadRow, venueButton } from './keyboards.ts';
import { clearFlow, findVenue, knownFailure, saveFlow, withDefault, wizardSteps } from './owner.ts';
import {
  ADDRESS_INVALID,
  ADDRESS_QUESTION,
  CATEGORY_QUESTION,
  CHOOSE_BUTTON,
  CONNECT_VENUE,
  CREATE_CANCELLED,
  homeText,
  HOURS_INVALID,
  HOURS_PROMPT,
  HOURS_QUESTION,
  NAME_INVALID,
  NAME_QUESTION,
  POINT_INVALID,
  POINT_QUESTION,
  VENUE_BUTTONS,
  VENUE_CREATED,
  VENUE_ERROR_TEXTS,
  venueSummary,
  WIZARD_STALE,
  withNote,
} from './texts.ts';

type CreateFlow = Extract<Flow, { name: 'venue_create' }>;
type CreateState = Pick<CreateFlow, 'step' | 'draft'>;
type NewVenue = Required<VenueDraft>;

const HOURS_PRESETS: Readonly<Record<string, { label: string; opensAt: string; closesAt: string }>> = {
  '0800_2200': { label: '08:00-22:00', opensAt: '08:00', closesAt: '22:00' },
  '0900_2100': { label: '09:00-21:00', opensAt: '09:00', closesAt: '21:00' },
  '1000_2300': { label: '10:00-23:00', opensAt: '10:00', closesAt: '23:00' },
  '24h': { label: VENUE_BUTTONS.allDay, opensAt: '00:00', closesAt: '00:00' },
};
const CUSTOM_HOURS = 'custom';

function isVenueCategory(value: string | undefined): value is VenueCategory {
  return VENUE_CATEGORIES.some((category) => category === value);
}

function createFlowOf(ctx: BotContext): (ActiveFlow & CreateFlow) | null {
  const flow = ctx.state.flow;
  return flow?.name === 'venue_create' ? flow : null;
}

function completeVenue({
  name,
  address,
  location,
  category,
  opensAt,
  closesAt,
}: VenueDraft): NewVenue | null {
  if (name === undefined || address === undefined || location === undefined) return null;
  if (category === undefined || opensAt === undefined || closesAt === undefined) return null;
  return { name, address, location, category, opensAt, closesAt };
}

function cancelRow(): Button[] {
  return [venueButton(BUTTONS.cancel, 'new', 'cancel')];
}

function connectScreen(): OutgoingMessage {
  return { text: CONNECT_VENUE, buttons: [[venueButton(VENUE_BUTTONS.create, 'new')]] };
}

function staleScreen(): OutgoingMessage {
  return { text: WIZARD_STALE, buttons: [[venueButton(VENUE_BUTTONS.create, 'new')]] };
}

function confirmScreen(venue: NewVenue): OutgoingMessage {
  return {
    text: venueSummary(venue),
    buttons: [
      [
        venueButton(VENUE_BUTTONS.confirmCreate, 'new', 'ok'),
        venueButton(VENUE_BUTTONS.restart, 'new', 'restart'),
      ],
      [link(VENUE_BUTTONS.checkOnMap, routeUrl(venue.location))],
      cancelRow(),
    ],
  };
}

function stepScreen({ step, draft }: CreateState): OutgoingMessage {
  switch (step) {
    case 'name':
      return { text: NAME_QUESTION, buttons: [cancelRow()] };
    case 'address':
      return { text: ADDRESS_QUESTION, buttons: [cancelRow()] };
    case 'location':
      return { text: POINT_QUESTION, buttons: [[locationRequest(VENUE_BUTTONS.sendPoint)], cancelRow()] };
    case 'category': {
      const categories = VENUE_CATEGORIES.map((category) =>
        venueButton(VENUE_CATEGORY_LABELS[category], 'new', 'cat', category),
      );
      return { text: CATEGORY_QUESTION, buttons: [...pairs(categories), cancelRow()] };
    }
    case 'hours': {
      const presets = Object.entries(HOURS_PRESETS).map(([id, preset]) =>
        venueButton(preset.label, 'new', 'hours', id),
      );
      return {
        text: HOURS_QUESTION,
        buttons: [
          ...pairs(presets),
          [venueButton(VENUE_BUTTONS.otherHours, 'new', 'hours', CUSTOM_HOURS)],
          cancelRow(),
        ],
      };
    }
    case 'hours_input':
      return { text: HOURS_PROMPT, buttons: [cancelRow()] };
    case 'confirm': {
      const venue = completeVenue(draft);
      return venue ? confirmScreen(venue) : stepScreen({ step: 'name', draft: {} });
    }
  }
}

function acceptInput({ step, draft }: CreateState, { text, location }: MessageInput): CreateState | string {
  switch (step) {
    case 'name': {
      const name = text === null ? null : parseTitle(text, VENUE_NAME_LIMIT);
      return name === null ? NAME_INVALID : { step: 'address', draft: { ...draft, name } };
    }
    case 'address': {
      const address = text === null ? null : parseTitle(text, VENUE_ADDRESS_LIMIT);
      return address === null ? ADDRESS_INVALID : { step: 'location', draft: { ...draft, address } };
    }
    case 'location': {
      const point = location ?? (text === null ? null : parseCoordinates(text));
      return point === null ? POINT_INVALID : { step: 'category', draft: { ...draft, location: point } };
    }
    case 'hours_input': {
      const hours = text === null ? null : parseHours(text);
      return hours === null ? HOURS_INVALID : { step: 'confirm', draft: { ...draft, ...hours } };
    }
    case 'category':
    case 'hours':
    case 'confirm':
      return CHOOSE_BUTTON;
  }
}

function inputReply(
  current: CreateState,
  message: MessageInput,
): { next: CreateState; screen: OutgoingMessage } {
  const accepted = acceptInput(current, message);
  if (typeof accepted !== 'string') return { next: accepted, screen: stepScreen(accepted) };
  const screen = stepScreen(current);
  return {
    next: { step: current.step, draft: current.draft },
    screen: { ...screen, text: withNote(accepted, screen.text) },
  };
}

export function createWorkspace({ services }: BotKit) {
  const { venues, bookings, deals } = services;
  const onStep = wizardSteps(createFlowOf, staleScreen);

  async function homeScreen(ctx: BotContext, venue: Venue): Promise<OutgoingMessage> {
    const [active, live] = await Promise.all([
      bookings.listForVenue(ctx.user.id, { status: 'active' }),
      deals.list(ctx.user.id, 'active'),
    ]);
    return {
      text: homeText({
        venue,
        openNow: isOpenAt(venue.opensAt, venue.closesAt, ctx.now, venue.timezone),
        activeBookings: active.length,
        liveDeals: live.length,
        guestUrl: startLinkUrl(ctx.botUsername, { kind: 'v', value: String(venue.id) }),
      }),
      buttons: homeButtons(ctx.miniAppEnabled),
    };
  }

  async function workspaceScreen(ctx: BotContext): Promise<OutgoingMessage> {
    const venue = await findVenue(venues, ctx.user.id);
    return venue ? homeScreen(ctx, venue) : connectScreen();
  }

  async function existingScreen(ctx: BotContext, venue: Venue | null): Promise<OutgoingMessage> {
    if (!venue) return connectScreen();
    const home = await homeScreen(ctx, venue);
    return { ...home, text: withNote(VENUE_ERROR_TEXTS.venue_exists, home.text) };
  }

  async function showStep(ctx: BotContext, next: CreateState): Promise<void> {
    await saveFlow(ctx, { name: 'venue_create', ...next, messageId: ctx.callbackMessageId });
    await ctx.answer({ message: stepScreen(next) });
  }

  async function begin(ctx: BotContext): Promise<void> {
    const venue = await findVenue(venues, ctx.user.id);
    if (venue) await ctx.answer({ message: await existingScreen(ctx, venue) });
    else await showStep(ctx, { step: 'name', draft: {} });
  }

  const chooseCategory = onStep(['category'], async (ctx, flow, [value]) => {
    if (isVenueCategory(value))
      await showStep(ctx, { step: 'hours', draft: { ...flow.draft, category: value } });
    else await answerStale(ctx);
  });

  const chooseHours = onStep(['hours'], async (ctx, flow, [value = '']) => {
    const preset = Object.hasOwn(HOURS_PRESETS, value) ? HOURS_PRESETS[value] : undefined;
    if (preset) {
      const { opensAt, closesAt } = preset;
      await showStep(ctx, { step: 'confirm', draft: { ...flow.draft, opensAt, closesAt } });
    } else if (value === CUSTOM_HOURS) {
      await showStep(ctx, { step: 'hours_input', draft: flow.draft });
    } else {
      await answerStale(ctx);
    }
  });

  const restart = onStep(['confirm'], async (ctx) => {
    await showStep(ctx, { step: 'name', draft: {} });
  });

  const confirm = onStep(['confirm'], async (ctx, flow) => {
    const venue = completeVenue(flow.draft);
    if (!venue) {
      await showStep(ctx, { step: 'name', draft: {} });
      return;
    }
    await ctx.answer({ message: { text: venueSummary(venue) } });
    try {
      await venues.create(ctx.user.id, venue);
    } catch (error) {
      knownFailure(error, ['venue_exists']);
      await clearFlow(ctx, 'venue_create');
      await ctx.reply(await existingScreen(ctx, await findVenue(venues, ctx.user.id)));
      return;
    }
    await clearFlow(ctx, 'venue_create');
    await ctx.reply({
      text: VENUE_CREATED,
      buttons: [uploadRow(), [venueButton(VENUE_BUTTONS.later, 'home')]],
    });
  });

  async function cancel(ctx: BotContext): Promise<void> {
    await clearFlow(ctx, 'venue_create');
    await ctx.answer({ message: { text: CREATE_CANCELLED } });
  }

  return {
    open: async (ctx: BotContext) => {
      await ctx.reply(await workspaceScreen(ctx));
    },
    home: async (ctx: BotContext) => {
      await ctx.answer({ message: await workspaceScreen(ctx) });
    },
    create: withDefault(begin, { cat: chooseCategory, hours: chooseHours, restart, ok: confirm, cancel }),
    onInput: async (ctx: BotContext, message: MessageInput): Promise<boolean> => {
      const flow = createFlowOf(ctx);
      if (!flow || (message.text === null && !message.location)) return false;
      const { next, screen } = inputReply(flow, message);
      const sent = await ctx.reply(screen);
      await saveFlow(ctx, { name: 'venue_create', ...next, messageId: sent.messageId });
      return true;
    },
  };
}
