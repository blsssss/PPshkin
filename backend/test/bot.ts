import type { QueryResult, QueryResultRow } from 'pg';
import { vi } from 'vitest';
import { createBot, type BotDependencies } from '../src/bot/index.ts';
import { parseChatState, type ChatState, type ChatStateStore } from '../src/bot/state.ts';
import type { Queryable } from '../src/db/pool.ts';
import { CONSENT_DOCUMENTS } from '../src/domain/consents.ts';
import { kcalRange } from '../src/domain/meals.ts';
import type { GeoPoint, User } from '../src/domain/models.ts';
import { mealSlotAt } from '../src/domain/nutrition/slots.ts';
import { dayTotals, remainingKcal } from '../src/domain/nutrition/totals.ts';
import { onlyKnownTags, type ConsentKind } from '../src/domain/vocabulary.ts';
import type { MaxApi } from '../src/integrations/max/api.ts';
import { createMaxMessenger } from '../src/integrations/max/messenger.ts';
import type { MaxButton, MaxNewMessageBody } from '../src/integrations/max/types.ts';
import type { IncomingEvent, UpdateHandler } from '../src/ports/messenger.ts';
import type { DishEstimate } from '../src/ports/recognition.ts';
import type { ConsentState, ConsentStatus } from '../src/services/consents.ts';
import type { DiaryDay, DiaryMeal, MealLogResult } from '../src/services/diary.ts';
import type { Services } from '../src/services/index.ts';
import { conflict, forbidden, notFound } from '../src/shared/errors.ts';
import { coarsePoint } from '../src/shared/geo.ts';
import { localDate } from '../src/shared/time.ts';
import { fixedClock, type ControlledClock } from './clock.ts';
import { fakeLogger, fakeMaxApi } from './max-api.ts';
import { fakeServices } from './services.ts';

export const BOT_IDENTITY = { username: 'ppshkin_bot', userId: 700 };
export const GUEST_ID = 101;
export const CHAT_ID = 5101;
export const NOON = '2026-09-26T09:00:00Z';

export interface MemoryStates extends ChatStateStore {
  put(userId: number, raw: unknown): void;
  peek(userId: number): ChatState;
}

export function memoryStates(): MemoryStates {
  const stored = new Map<number, string>();
  return {
    load: (userId) => {
      const raw = stored.get(userId);
      return Promise.resolve(parseChatState(raw === undefined ? null : JSON.parse(raw)));
    },
    save: (userId, state) => {
      stored.set(userId, JSON.stringify(state));
      return Promise.resolve();
    },
    clear: (userId) => {
      stored.delete(userId);
      return Promise.resolve();
    },
    put: (userId, raw) => {
      stored.set(userId, JSON.stringify(raw));
    },
    peek: (userId) => {
      const raw = stored.get(userId);
      return parseChatState(raw === undefined ? null : JSON.parse(raw));
    },
  };
}

export interface GuestWorld {
  services: Services;
  clock: ControlledClock;
  user: User;
  meals: DiaryMeal[];
  consents: Map<ConsentKind, string>;
  recognizePhoto: ReturnType<typeof vi.fn<(image: Buffer) => Promise<MealLogResult>>>;
  recognizeText: ReturnType<typeof vi.fn<(text: string) => Promise<MealLogResult>>>;
  consent(...kinds: ConsentKind[]): void;
  logged(...estimates: Partial<DishEstimate>[]): Promise<MealLogResult>;
  addMeal(title: string, kcalMin: number, kcalMax?: number, eatenAt?: Date): DiaryMeal;
}

export function estimate(overrides: Partial<DishEstimate> = {}): DishEstimate {
  return {
    title: 'Борщ со сметаной',
    portionG: 350,
    kcalMin: 300,
    kcalMax: 360,
    proteinG: 12,
    fatG: 15,
    carbsG: 25,
    tags: ['soup'],
    confidence: 0.8,
    ...overrides,
  };
}

export function guestWorld(options: { now?: string; services?: Partial<Services> } = {}): GuestWorld {
  const clock = fixedClock(options.now ?? NOON);
  const created = new Date('2026-09-01T09:00:00Z');
  const consents = new Map<ConsentKind, string>();
  const meals: DiaryMeal[] = [];
  let nextMealId = 1;
  const user: User = {
    id: GUEST_ID,
    firstName: 'Анна',
    username: null,
    timezone: 'Europe/Moscow',
    kcalTarget: 2000,
    goal: null,
    dislikedTags: [],
    location: null,
    locationUpdatedAt: null,
    createdAt: created,
    updatedAt: created,
  };

  const stateOf = (kind: ConsentKind): ConsentState => {
    const version = consents.get(kind) ?? null;
    return {
      granted: version === CONSENT_DOCUMENTS[kind].version,
      version,
      grantedAt: version === null ? null : created,
    };
  };
  const status = (): ConsentStatus => ({
    personalData: stateOf('personal_data'),
    personalizedOffers: stateOf('personalized_offers'),
  });
  const requirePersonalData = () => {
    if (!stateOf('personal_data').granted) {
      throw forbidden('consent_required', 'Consent to personal data processing is required');
    }
  };
  const profile = () => ({ user: { ...user }, consents: status() });

  const addMeal = (title: string, kcalMin: number, kcalMax = kcalMin, eatenAt = clock.now()): DiaryMeal => {
    const meal: DiaryMeal = {
      id: nextMealId,
      userId: GUEST_ID,
      title,
      kcalMin,
      kcalMax,
      proteinG: null,
      fatG: null,
      carbsG: null,
      tags: [],
      source: 'manual',
      confidence: null,
      eatenAt,
      createdAt: clock.now(),
      slot: mealSlotAt(eatenAt, user.timezone),
    };
    nextMealId += 1;
    meals.push(meal);
    return meal;
  };

  const day = (): DiaryDay => {
    const date = localDate(clock.now(), user.timezone);
    const eaten = meals.filter((meal) => localDate(meal.eatenAt, user.timezone) === date);
    const totals = dayTotals(eaten);
    return {
      date,
      timezone: user.timezone,
      targetKcal: user.kcalTarget,
      totals,
      remainingKcal: remainingKcal(user.kcalTarget, totals),
      meals: [...eaten],
    };
  };

  const findMeal = (mealId: number) => {
    const meal = meals.find((candidate) => candidate.id === mealId);
    if (!meal) throw notFound('meal_not_found', 'Meal not found');
    return meal;
  };

  const services = fakeServices({
    consents: {
      status: () => Promise.resolve(status()),
      list: () => Promise.reject(new Error('consents.list is not stubbed')),
      grant: (_userId, kind, version) => {
        if (version !== CONSENT_DOCUMENTS[kind].version) {
          return Promise.reject(conflict('consent_version_outdated', 'The consent text has changed'));
        }
        consents.set(kind, version);
        return Promise.resolve(stateOf(kind));
      },
      revoke: (_userId, kind) => {
        consents.delete(kind);
        return Promise.resolve();
      },
      requirePersonalData: () => Promise.resolve().then(requirePersonalData),
    },
    profile: {
      get: () => Promise.resolve(profile()),
      update: async (_userId, patch) => {
        requirePersonalData();
        await Promise.resolve();
        Object.assign(user, {
          ...(patch.kcalTarget === undefined ? {} : { kcalTarget: patch.kcalTarget }),
          ...(patch.goal === undefined ? {} : { goal: patch.goal }),
          ...(patch.dislikedTags === undefined ? {} : { dislikedTags: onlyKnownTags(patch.dislikedTags) }),
        });
        return profile();
      },
      setLocation: async (_userId, point: GeoPoint) => {
        requirePersonalData();
        await Promise.resolve();
        user.location = coarsePoint(point);
        user.locationUpdatedAt = clock.now();
        return { location: user.location, updatedAt: user.locationUpdatedAt };
      },
      clearLocation: () => Promise.reject(new Error('profile.clearLocation is not stubbed')),
    },
    diary: {
      day: () => Promise.resolve(day()),
      summary: () => Promise.reject(new Error('diary.summary is not stubbed')),
      addManual: async (_userId, input) => {
        requirePersonalData();
        await Promise.resolve();
        const range = kcalRange(input);
        if (!range) throw new Error('addManual needs kcal');
        const meal = addMeal(input.title, range.kcalMin, range.kcalMax);
        Object.assign(meal, {
          proteinG: input.proteinG ?? null,
          fatG: input.fatG ?? null,
          carbsG: input.carbsG ?? null,
          tags: input.tags ?? [],
        });
        return { ...meal };
      },
      logFromPhoto: (_userId, image) => world.recognizePhoto(image),
      logFromText: (_userId, text) => world.recognizeText(text),
      update: async (_userId, mealId, patch) => {
        await Promise.resolve();
        const meal = findMeal(mealId);
        const range = kcalRange(patch);
        Object.assign(meal, { ...(patch.title === undefined ? {} : { title: patch.title }), ...range });
        return { ...meal };
      },
      remove: async (_userId, mealId) => {
        await Promise.resolve();
        meals.splice(meals.indexOf(findMeal(mealId)), 1);
      },
    },
    account: {
      deleteAccount: vi.fn(() => {
        meals.splice(0);
        consents.clear();
        return Promise.resolve();
      }),
    },
    ...options.services,
  });

  const world: GuestWorld = {
    services,
    clock,
    user,
    meals,
    consents,
    recognizePhoto: vi.fn(() =>
      Promise.resolve<MealLogResult>({ status: 'unavailable', reason: 'disabled' }),
    ),
    recognizeText: vi.fn(() => Promise.resolve<MealLogResult>({ status: 'unavailable', reason: 'disabled' })),
    consent: (...kinds) => {
      for (const kind of kinds) consents.set(kind, CONSENT_DOCUMENTS[kind].version);
    },
    logged: (...estimates) => {
      const saved = estimates.map((overrides) => {
        const dish = estimate(overrides);
        const meal = addMeal(dish.title, dish.kcalMin, dish.kcalMax);
        Object.assign(meal, {
          proteinG: dish.proteinG,
          fatG: dish.fatG,
          carbsG: dish.carbsG,
          tags: dish.tags,
          source: 'photo',
          confidence: dish.confidence,
        });
        return { ...meal };
      });
      return Promise.resolve({ status: 'logged', meals: saved, basis: 'Оценка по фото', day: day() });
    },
    addMeal,
  };
  return world;
}

export function worldDatabase(world: GuestWorld): Queryable {
  return {
    query<Row extends QueryResultRow>(text: string) {
      if (!text.includes('insert into users')) {
        return Promise.reject(new Error(`Unexpected query: ${text.slice(0, 40)}`));
      }
      const { user } = world;
      const row = {
        id: user.id,
        first_name: user.firstName,
        username: user.username,
        timezone: user.timezone,
        kcal_target: user.kcalTarget,
        goal: user.goal,
        disliked_tags: user.dislikedTags,
        location_lat: user.location?.lat ?? null,
        location_lon: user.location?.lon ?? null,
        location_updated_at: user.locationUpdatedAt,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      };
      return Promise.resolve({ rows: [row], rowCount: 1 } as unknown as QueryResult<Row>);
    },
  };
}

export interface ButtonView {
  type: MaxButton['type'];
  text: string;
  payload?: string;
  url?: string;
}

export interface Screen {
  text: string;
  buttons: ButtonView[][];
  images: string[];
}

export type Outgoing =
  | ({ kind: 'send' | 'edit'; messageId: string } & Screen)
  | { kind: 'answer'; messageId: string | null; notification: string | null; message: Screen | null };

function toScreen(body: MaxNewMessageBody): Screen {
  const attachments = body.attachments ?? [];
  const buttons = attachments.flatMap((attachment) =>
    attachment.type === 'inline_keyboard' ? attachment.payload.buttons : [],
  );
  return {
    text: body.text,
    buttons: buttons.map((row) =>
      row.map((button): ButtonView => {
        switch (button.type) {
          case 'callback':
            return { type: button.type, text: button.text, payload: button.payload };
          case 'link':
            return { type: button.type, text: button.text, url: button.url };
          default:
            return { type: button.type, text: button.text };
        }
      }),
    ),
    images: attachments.flatMap((attachment) =>
      attachment.type === 'image' ? [attachment.payload.token] : [],
    ),
  };
}

export function payloads(screen: Screen | null | undefined): string[] {
  return (screen?.buttons ?? [])
    .flat()
    .flatMap((button) => (button.payload === undefined ? [] : [button.payload]));
}

export function labels(screen: Screen | null | undefined): string[] {
  return (screen?.buttons ?? []).flat().map((button) => button.text);
}

export interface ChatOptions {
  world?: GuestWorld;
  states?: MemoryStates;
  miniAppEnabled?: boolean;
  api?: Partial<MaxApi>;
  pool?: Queryable;
  createHandler?: (deps: BotDependencies) => UpdateHandler;
}

export function botChat(options: ChatOptions = {}) {
  const world = options.world ?? guestWorld();
  const states = options.states ?? memoryStates();
  const logger = fakeLogger();
  const screens = new Map<string, Screen>();
  const pressed = new Map<string, string | null>();
  let outbox: Outgoing[] = [];
  let sequence = 0;
  const next = () => {
    sequence += 1;
    return sequence;
  };

  const api = fakeMaxApi({
    sendMessage: vi.fn((_to, body: MaxNewMessageBody) => {
      const messageId = `mid.${next()}`;
      const screen = toScreen(body);
      screens.set(messageId, screen);
      outbox.push({ kind: 'send', messageId, ...screen });
      return Promise.resolve({ mid: messageId });
    }),
    editMessage: vi.fn((messageId: string, body: MaxNewMessageBody) => {
      const screen = toScreen(body);
      screens.set(messageId, screen);
      outbox.push({ kind: 'edit', messageId, ...screen });
      return Promise.resolve();
    }),
    answerCallback: vi.fn(
      (callbackId: string, answer: { notification?: string; message?: MaxNewMessageBody }) => {
        const messageId = pressed.get(callbackId) ?? null;
        const message = answer.message ? toScreen(answer.message) : null;
        if (message && messageId !== null) screens.set(messageId, message);
        outbox.push({ kind: 'answer', messageId, notification: answer.notification ?? null, message });
        return Promise.resolve();
      },
    ),
    sendAction: vi.fn(() => Promise.resolve()),
    download: vi.fn(() => Promise.resolve(Buffer.from('jpeg bytes'))),
    ...options.api,
  });

  const messenger = createMaxMessenger(api, {
    botUsername: BOT_IDENTITY.username,
    botUserId: BOT_IDENTITY.userId,
  });
  const handler = (options.createHandler ?? createBot)({
    pool: options.pool ?? worldDatabase(world),
    services: world.services,
    messenger,
    states,
    clock: world.clock,
    logger,
    bot: BOT_IDENTITY,
    miniAppEnabled: options.miniAppEnabled ?? false,
  });

  const guest = { id: GUEST_ID, firstName: 'Анна', username: null };

  async function run(event: IncomingEvent): Promise<Outgoing[]> {
    await handler(event);
    const sent = outbox;
    outbox = [];
    return sent;
  }

  const message = (fields: Partial<Extract<IncomingEvent, { type: 'message' }>>) =>
    run({
      type: 'message',
      key: `message:${next()}`,
      user: guest,
      chatId: CHAT_ID,
      messageId: `guest.${next()}`,
      text: null,
      photos: [],
      location: null,
      ...fields,
    });

  function findButton(payload: string): string {
    const found = [...screens.entries()].reverse().find(([, screen]) => payloads(screen).includes(payload));
    if (!found) throw new Error(`No message has a button with payload ${payload}`);
    return found[0];
  }

  return {
    world,
    states,
    logger,
    api,
    messenger,
    handler,
    deliver: run,
    screen: (messageId: string) => screens.get(messageId),
    send: (text: string) => message({ text }),
    photo: (count = 1) =>
      message({
        photos: Array.from({ length: count }, (_, index) => ({
          url: `https://files.max.example/photo-${index}.jpg`,
          token: null,
        })),
      }),
    location: (point: GeoPoint) => message({ location: point }),
    empty: () => message({}),
    start: (payload: string | null = null) =>
      run({ type: 'started', key: `started:${next()}`, user: guest, chatId: CHAT_ID, payload }),
    stop: () => run({ type: 'stopped', key: `stopped:${next()}`, user: guest }),
    press(payload: string, messageId: string | null = findButton(payload)) {
      const callbackId = `callback.${next()}`;
      pressed.set(callbackId, messageId);
      return run({
        type: 'callback',
        key: `callback:${callbackId}`,
        user: guest,
        chatId: CHAT_ID,
        callbackId,
        payload,
        messageId,
      });
    },
  };
}

export type BotChat = ReturnType<typeof botChat>;

export type SentScreen = Extract<Outgoing, { messageId: string }>;

export function sent(outgoing: readonly Outgoing[]): SentScreen[] {
  return outgoing.flatMap((item) => (item.kind === 'send' ? [item] : []));
}

export function answers(outgoing: readonly Outgoing[]) {
  return outgoing.flatMap((item) => (item.kind === 'answer' ? [item] : []));
}

export function texts(outgoing: readonly Outgoing[]): string[] {
  return outgoing.flatMap((item) => {
    if (item.kind === 'answer') return item.message ? [item.message.text] : [];
    return [item.text];
  });
}
