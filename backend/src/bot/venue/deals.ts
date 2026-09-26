import type { MenuItem, Venue } from '../../domain/models.ts';
import type { Button, OutgoingMessage } from '../../ports/messenger.ts';
import type { DealView } from '../../services/deals.ts';
import { formatLocalTime, isOpenAt, nextClosingAt } from '../../shared/time.ts';
import { answerStale, byAction, parseId } from '../callbacks.ts';
import type { BotContext, BotKit, MessageInput } from '../context.ts';
import type { ActiveFlow, Flow } from '../state.ts';
import { BUTTONS, TITLE_IN_BUTTON_LIMIT, truncate } from '../texts.ts';
import type { DealDraft } from './flows.ts';
import { parsePrice, parseQuantity } from './input.ts';
import { homeRow, newDealRow, pairs, startLinkUrl, uploadRow, venueButton } from './keyboards.ts';
import {
  clearFlow,
  findVenue,
  knownFailure,
  ownerCallback,
  ownerFlow,
  saveFlow,
  wizardSteps,
  type WizardHandler,
} from './owner.ts';
import {
  ALL_ITEMS_ON_DEAL,
  CHOOSE_BUTTON,
  DEAL_CANCELLED,
  DEAL_GONE,
  DEAL_STOPPED,
  dealOfferText,
  dealPublished,
  dealQuestion,
  dealsText,
  dealSummary,
  discountOption,
  DISCOUNT_QUESTION,
  dishHeader,
  ITEM_GONE,
  itemQuestion,
  menuItemOption,
  NO_DEALS,
  NO_ITEMS,
  priceInvalid,
  pricePrompt,
  QUANTITY_INVALID,
  QUANTITY_PROMPT,
  QUANTITY_QUESTION,
  stopQuestion,
  UNTIL_QUESTION,
  untilClosingOption,
  VENUE_BUTTONS,
  VENUE_CLOSED_WARNING,
  VENUE_ERROR_TEXTS,
  WIZARD_STALE,
  withNote,
  type DealOffer,
  type VenueErrorCode,
} from './texts.ts';

type DealFlow = Extract<Flow, { name: 'deal_wizard' }>;
type DealState = Pick<DealFlow, 'step' | 'page' | 'draft'>;
type DealStepHandler = (ctx: BotContext, venue: Venue, flow: DealState, args: string[]) => Promise<void>;

interface ChosenItem {
  menuItemId: number;
  itemName: string;
  itemPriceRub: number;
}

type ChosenOffer = ChosenItem & DealOffer;

interface Rendered {
  state: DealState | null;
  screen: OutgoingMessage;
}

interface Presentation {
  via: 'answer' | 'reply';
  error?: string;
}

const ITEMS_PER_PAGE = 8;
const STOP_BUTTONS_LIMIT = 10;
const QUANTITY_CHOICES = [1, 3, 5, 10];
const DISCOUNT_CHOICES = [20, 30, 40, 50];
const MINUTE_MS = 60_000;
const DURATION_CHOICES: readonly { id: string; label: string; minutes: number }[] = [
  { id: '60', label: VENUE_BUTTONS.oneHour, minutes: 60 },
  { id: '120', label: VENUE_BUTTONS.twoHours, minutes: 120 },
];
const CLOSING_MARGIN_MS = 15 * MINUTE_MS;
const CUSTOM = 'custom';
const UNTIL_CLOSING = 'close';
const PUBLISH_FAILURES = [
  'deal_exists',
  'deal_price_not_lower',
  'deal_window_invalid',
  'menu_item_unavailable',
  'menu_item_not_found',
] as const satisfies readonly VenueErrorCode[];

const FIRST_PAGE: DealState = { step: 'item', page: 1, draft: {} };

function dealFlowOf(ctx: BotContext): (ActiveFlow & DealFlow) | null {
  const flow = ctx.state.flow;
  return flow?.name === 'deal_wizard' ? flow : null;
}

function chosenItem({ menuItemId, itemName, itemPriceRub }: DealDraft): ChosenItem | null {
  if (menuItemId === undefined || itemName === undefined || itemPriceRub === undefined) return null;
  return { menuItemId, itemName, itemPriceRub };
}

function chosenOffer(draft: DealDraft): ChosenOffer | null {
  const item = chosenItem(draft);
  const { quantity, priceRub } = draft;
  return item && quantity !== undefined && priceRub !== undefined ? { ...item, quantity, priceRub } : null;
}

function discountOptions(regularRub: number): { percent: number; priceRub: number }[] {
  return DISCOUNT_CHOICES.map((percent) => ({
    percent,
    priceRub: Math.round(regularRub * (1 - percent / 100)),
  })).filter(({ priceRub }) => priceRub >= 1 && priceRub < regularRub);
}

function closingTime(venue: Venue, now: Date): Date | null {
  const closing = nextClosingAt(venue.opensAt, venue.closesAt, now, venue.timezone);
  return closing && closing.getTime() - now.getTime() >= CLOSING_MARGIN_MS ? closing : null;
}

function cancelRow(): Button[] {
  return [venueButton(BUTTONS.cancel, 'dl', 'cancel')];
}

function dealsRow(): Button[] {
  return [venueButton(VENUE_BUTTONS.deals, 'deals')];
}

function staleScreen(): OutgoingMessage {
  return { text: WIZARD_STALE, buttons: [newDealRow()] };
}

function itemsScreen(items: readonly MenuItem[], page: number): OutgoingMessage {
  const pages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const shown = items.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
  const navigation = [
    ...(page > 1 ? [venueButton(VENUE_BUTTONS.back, 'dl', 'page', page - 1)] : []),
    ...(page < pages ? [venueButton(VENUE_BUTTONS.more, 'dl', 'page', page + 1)] : []),
  ];
  return {
    text: itemQuestion(page, pages),
    buttons: [
      ...shown.map((item) => [venueButton(menuItemOption(item.name, item.priceRub), 'dl', 'item', item.id)]),
      ...(navigation.length > 0 ? [navigation] : []),
      cancelRow(),
    ],
  };
}

function quantityScreen(item: ChosenItem): OutgoingMessage {
  return {
    text: `${dishHeader(item.itemName, item.itemPriceRub)}\n${QUANTITY_QUESTION}`,
    buttons: [
      QUANTITY_CHOICES.map((quantity) => venueButton(String(quantity), 'dl', 'qty', quantity)),
      [venueButton(VENUE_BUTTONS.otherQuantity, 'dl', 'qty', CUSTOM)],
      cancelRow(),
    ],
  };
}

function discountScreen(item: ChosenItem, quantity: number): OutgoingMessage {
  const options = discountOptions(item.itemPriceRub).map(({ percent, priceRub }) =>
    venueButton(discountOption(percent, priceRub), 'dl', 'disc', percent),
  );
  return {
    text: `${dishHeader(item.itemName, item.itemPriceRub, quantity)}\n${DISCOUNT_QUESTION}`,
    buttons: [...pairs(options), [venueButton(VENUE_BUTTONS.customPrice, 'dl', 'disc', CUSTOM)], cancelRow()],
  };
}

function endsAtChoice(value: string | undefined, venue: Venue, now: Date): Date | null {
  if (value === UNTIL_CLOSING) return closingTime(venue, now);
  const duration = DURATION_CHOICES.find(({ id }) => id === value);
  return duration ? new Date(now.getTime() + duration.minutes * MINUTE_MS) : null;
}

function untilScreen(offer: ChosenOffer, venue: Venue, now: Date): OutgoingMessage {
  const closing = closingTime(venue, now);
  const closed = !isOpenAt(venue.opensAt, venue.closesAt, now, venue.timezone);
  const closingLabel = closing ? untilClosingOption(formatLocalTime(closing, venue.timezone)) : null;
  return {
    text: [...(closed ? [VENUE_CLOSED_WARNING, ''] : []), dealOfferText(offer), UNTIL_QUESTION].join('\n'),
    buttons: [
      DURATION_CHOICES.map(({ id, label }) => venueButton(label, 'dl', 'until', id)),
      ...(closingLabel ? [[venueButton(closingLabel, 'dl', 'until', UNTIL_CLOSING)]] : []),
      cancelRow(),
    ],
  };
}

function confirmScreen(offer: ChosenOffer, endsAt: Date, venue: Venue): OutgoingMessage {
  return {
    text: dealQuestion(offer, endsAt, venue.timezone),
    buttons: [[venueButton(VENUE_BUTTONS.publish, 'dl', 'ok'), venueButton(BUTTONS.cancel, 'dl', 'cancel')]],
  };
}

function inputScreen(text: string): OutgoingMessage {
  return { text, buttons: [cancelRow()] };
}

function stepScreen({ step, draft }: DealState, venue: Venue, now: Date): OutgoingMessage | null {
  const item = chosenItem(draft);
  const offer = chosenOffer(draft);
  switch (step) {
    case 'item':
      return null;
    case 'quantity':
      return item ? quantityScreen(item) : null;
    case 'quantity_input':
      return item ? inputScreen(QUANTITY_PROMPT) : null;
    case 'discount':
      return item && draft.quantity !== undefined ? discountScreen(item, draft.quantity) : null;
    case 'price_input':
      return item ? inputScreen(pricePrompt(item.itemPriceRub - 1)) : null;
    case 'until':
      return offer ? untilScreen(offer, venue, now) : null;
    case 'confirm':
      return offer && draft.endsAt !== undefined ? confirmScreen(offer, new Date(draft.endsAt), venue) : null;
  }
}

function acceptText(state: DealState, text: string): { next: DealState; error?: string } {
  const item = chosenItem(state.draft);
  switch (state.step) {
    case 'quantity':
    case 'quantity_input': {
      const quantity = parseQuantity(text);
      if (quantity === null) return { next: state, error: QUANTITY_INVALID };
      return { next: { ...state, step: 'discount', draft: { ...state.draft, quantity } } };
    }
    case 'price_input': {
      if (!item) return { next: FIRST_PAGE };
      const maxRub = item.itemPriceRub - 1;
      const priceRub = parsePrice(text, maxRub);
      if (priceRub === null) return { next: state, error: priceInvalid(maxRub) };
      return { next: { ...state, step: 'until', draft: { ...state.draft, priceRub } } };
    }
    case 'item':
    case 'discount':
    case 'until':
    case 'confirm':
      return { next: state, error: CHOOSE_BUTTON };
  }
}

export function createDealScreens({ services }: BotKit) {
  const { venues, menu, deals } = services;
  const onStep = wizardSteps(dealFlowOf, staleScreen);

  async function pickableItems(ownerId: number): Promise<{ items: MenuItem[]; available: number }> {
    const [items, live] = await Promise.all([menu.list(ownerId), deals.list(ownerId, 'active')]);
    const onDeal = new Set(live.map(({ deal }) => deal.menuItemId));
    const available = items.filter((item) => item.isAvailable && item.priceRub > 1);
    return { items: available.filter((item) => !onDeal.has(item.id)), available: available.length };
  }

  async function renderItems(ctx: BotContext, page: number): Promise<Rendered> {
    const { items, available } = await pickableItems(ctx.user.id);
    if (items.length === 0) {
      return {
        state: null,
        screen:
          available > 0
            ? { text: ALL_ITEMS_ON_DEAL, buttons: [dealsRow()] }
            : { text: NO_ITEMS, buttons: [uploadRow()] },
      };
    }
    const shown = Math.min(Math.max(page, 1), Math.ceil(items.length / ITEMS_PER_PAGE));
    return { state: { step: 'item', page: shown, draft: {} }, screen: itemsScreen(items, shown) };
  }

  async function render(ctx: BotContext, venue: Venue, state: DealState): Promise<Rendered> {
    const screen = stepScreen(state, venue, ctx.now);
    if (screen) return { state, screen };
    return renderItems(ctx, state.step === 'item' ? state.page : 1);
  }

  async function present(ctx: BotContext, venue: Venue, next: DealState, how: Presentation): Promise<void> {
    const { state, screen } = await render(ctx, venue, next);
    const message = how.error === undefined ? screen : { ...screen, text: withNote(how.error, screen.text) };
    if (how.via === 'answer') {
      if (state) await saveFlow(ctx, { name: 'deal_wizard', ...state, messageId: ctx.callbackMessageId });
      else await clearFlow(ctx, 'deal_wizard');
      await ctx.answer({ message });
      return;
    }
    const sent = await ctx.reply(message);
    if (state) await saveFlow(ctx, { name: 'deal_wizard', ...state, messageId: sent.messageId });
    else await clearFlow(ctx, 'deal_wizard');
  }

  function step(steps: readonly DealState['step'][], handler: DealStepHandler) {
    const withVenue: WizardHandler<ActiveFlow & DealFlow> = async (ctx, flow, args) => {
      const venue = await findVenue(venues, ctx.user.id);
      if (venue) {
        await handler(ctx, venue, { step: flow.step, page: flow.page, draft: flow.draft }, args);
        return;
      }
      await clearFlow(ctx, 'deal_wizard');
      await ctx.answer({ message: { text: VENUE_ERROR_TEXTS.venue_not_found } });
    };
    return onStep(steps, withVenue);
  }

  function dealsScreen(live: readonly DealView[], venue: Venue, note?: string): OutgoingMessage {
    const text = live.length === 0 ? NO_DEALS : dealsText(live, venue.timezone);
    const stops = live
      .slice(0, STOP_BUTTONS_LIMIT)
      .map(({ deal, item }) => [
        venueButton(
          `${VENUE_BUTTONS.stopDeal}: ${truncate(item.name, TITLE_IN_BUTTON_LIMIT)}`,
          'dl',
          'stop',
          deal.id,
        ),
      ]);
    return {
      text: note === undefined ? text : withNote(note, text),
      buttons: [...stops, newDealRow(), homeRow()],
    };
  }

  const list = ownerCallback(venues, async (ctx, venue) => {
    await ctx.answer({ message: dealsScreen(await deals.list(ctx.user.id, 'active'), venue) });
  });

  const begin = ownerCallback(venues, async (ctx, venue) => {
    await present(ctx, venue, FIRST_PAGE, { via: 'answer' });
  });

  const choosePage = step(['item'], async (ctx, venue, state, [value]) => {
    const page = parseId(value);
    if (page === null) await answerStale(ctx);
    else await present(ctx, venue, { ...state, page }, { via: 'answer' });
  });

  const chooseItem = step(['item'], async (ctx, venue, state, [value]) => {
    const itemId = parseId(value);
    if (itemId === null) {
      await answerStale(ctx);
      return;
    }
    const { items } = await pickableItems(ctx.user.id);
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) {
      await present(ctx, venue, state, { via: 'answer', error: ITEM_GONE });
      return;
    }
    const draft = { menuItemId: item.id, itemName: item.name, itemPriceRub: item.priceRub };
    await present(ctx, venue, { step: 'quantity', page: state.page, draft }, { via: 'answer' });
  });

  const chooseQuantity = step(['quantity'], async (ctx, venue, state, [value]) => {
    const quantity = QUANTITY_CHOICES.find((choice) => String(choice) === value);
    if (value === CUSTOM) {
      await present(ctx, venue, { ...state, step: 'quantity_input' }, { via: 'answer' });
    } else if (quantity === undefined) {
      await answerStale(ctx);
    } else {
      const draft = { ...state.draft, quantity };
      await present(ctx, venue, { ...state, step: 'discount', draft }, { via: 'answer' });
    }
  });

  const chooseDiscount = step(['discount'], async (ctx, venue, state, [value]) => {
    const item = chosenItem(state.draft);
    const option =
      item && discountOptions(item.itemPriceRub).find(({ percent }) => String(percent) === value);
    if (value === CUSTOM) {
      await present(ctx, venue, { ...state, step: 'price_input' }, { via: 'answer' });
    } else if (!option) {
      await answerStale(ctx);
    } else {
      const draft = { ...state.draft, priceRub: option.priceRub };
      await present(ctx, venue, { ...state, step: 'until', draft }, { via: 'answer' });
    }
  });

  const chooseEnd = step(['until'], async (ctx, venue, state, [value]) => {
    const endsAt = endsAtChoice(value, venue, ctx.now);
    if (endsAt === null) {
      await answerStale(ctx);
      return;
    }
    const draft = { ...state.draft, endsAt: endsAt.toISOString() };
    await present(ctx, venue, { ...state, step: 'confirm', draft }, { via: 'answer' });
  });

  async function recover(
    ctx: BotContext,
    venue: Venue,
    state: DealState,
    code: (typeof PUBLISH_FAILURES)[number],
  ): Promise<void> {
    const error = VENUE_ERROR_TEXTS[code];
    if (code === 'deal_window_invalid') {
      const draft = { ...state.draft, endsAt: undefined };
      await present(ctx, venue, { ...state, step: 'until', draft }, { via: 'reply', error });
      return;
    }
    if (code === 'deal_price_not_lower') {
      const item = (await menu.list(ctx.user.id)).find(
        (candidate) => candidate.id === state.draft.menuItemId && candidate.isAvailable,
      );
      if (item) {
        const draft = {
          menuItemId: item.id,
          itemName: item.name,
          itemPriceRub: item.priceRub,
          quantity: state.draft.quantity,
        };
        await present(ctx, venue, { ...state, step: 'discount', draft }, { via: 'reply', error });
        return;
      }
    }
    await clearFlow(ctx, 'deal_wizard');
    await ctx.reply({ text: error, buttons: [dealsRow(), newDealRow()] });
  }

  const publish = step(['confirm'], async (ctx, venue, state) => {
    const offer = chosenOffer(state.draft);
    const { endsAt } = state.draft;
    if (!offer || endsAt === undefined) {
      await present(ctx, venue, FIRST_PAGE, { via: 'answer' });
      return;
    }
    const end = new Date(endsAt);
    await ctx.answer({ message: { text: `${dealSummary(offer, end, venue.timezone)}.` } });
    let created: DealView;
    try {
      created = await deals.create(ctx.user.id, {
        menuItemId: offer.menuItemId,
        priceRub: offer.priceRub,
        quantity: offer.quantity,
        endsAt: end,
      });
    } catch (error) {
      await recover(ctx, venue, state, knownFailure(error, PUBLISH_FAILURES));
      return;
    }
    await clearFlow(ctx, 'deal_wizard');
    const guestUrl = startLinkUrl(ctx.botUsername, { kind: 'd', value: String(created.deal.id) });
    await ctx.reply({
      text: dealPublished(guestUrl),
      buttons: [
        [venueButton(VENUE_BUTTONS.deals, 'deals'), venueButton(VENUE_BUTTONS.anotherDeal, 'dl', 'new')],
      ],
    });
  });

  async function cancel(ctx: BotContext): Promise<void> {
    await clearFlow(ctx, 'deal_wizard');
    await ctx.answer({ message: { text: DEAL_CANCELLED, buttons: [dealsRow()] } });
  }

  const askStop = ownerCallback(venues, async (ctx, venue, [value]) => {
    const dealId = parseId(value);
    if (dealId === null) {
      await answerStale(ctx);
      return;
    }
    const live = await deals.list(ctx.user.id, 'active');
    const view = live.find(({ deal }) => deal.id === dealId);
    if (!view) {
      await ctx.answer({ message: dealsScreen(live, venue, DEAL_GONE) });
      return;
    }
    await ctx.answer({
      message: {
        text: stopQuestion(view.item.name),
        buttons: [
          [
            venueButton(VENUE_BUTTONS.confirmStop, 'dl', 'stop_ok', dealId),
            venueButton(BUTTONS.no, 'dl', 'keep'),
          ],
        ],
      },
    });
  });

  const confirmStop = ownerCallback(venues, async (ctx, _venue, [value]) => {
    const dealId = parseId(value);
    if (dealId === null) {
      await answerStale(ctx);
      return;
    }
    try {
      await deals.cancel(ctx.user.id, dealId);
    } catch (error) {
      knownFailure(error, ['deal_not_found']);
      await ctx.answer({ message: { text: VENUE_ERROR_TEXTS.deal_not_found, buttons: [dealsRow()] } });
      return;
    }
    await ctx.answer({ message: { text: DEAL_STOPPED, buttons: [dealsRow()] } });
  });

  const onInput = ownerFlow(
    venues,
    (flow, message) => flow.name === 'deal_wizard' && message.text !== null,
    async (ctx, venue, message: MessageInput) => {
      const flow = dealFlowOf(ctx);
      if (!flow || message.text === null) return false;
      const current = { step: flow.step, page: flow.page, draft: flow.draft };
      const { next, error } = acceptText(current, message.text);
      await present(ctx, venue, next, { via: 'reply', error });
      return true;
    },
  );

  return {
    list,
    wizard: byAction({
      new: begin,
      page: choosePage,
      item: chooseItem,
      qty: chooseQuantity,
      disc: chooseDiscount,
      until: chooseEnd,
      ok: publish,
      cancel,
      stop: askStop,
      stop_ok: confirmStop,
      keep: list,
    }),
    onInput,
  };
}
