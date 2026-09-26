import type { Queryable } from '../db/pool.ts';
import type { User } from '../domain/models.ts';
import { UserUnreachableError } from '../integrations/max/errors.ts';
import type { MaxLogger } from '../integrations/max/poller.ts';
import type { IncomingEvent, Messenger, OutgoingMessage, UpdateHandler } from '../ports/messenger.ts';
import * as users from '../repositories/users.ts';
import type { Services } from '../services/index.ts';
import type { Clock } from '../shared/clock.ts';
import { parsePayload } from './callbacks.ts';
import type { BotContext, MessageInput } from './context.ts';
import { describeFailure } from './failures.ts';
import { consentRequest, helpMessage, shortHelpMessage } from './messages.ts';
import { COMMAND_PREFIX, type Registry } from './registry.ts';
import { isExpired, type ChatState, type ChatStateStore } from './state.ts';
import { NOTICES } from './texts.ts';

export interface RouterOptions {
  db: Queryable;
  services: Services;
  messenger: Messenger;
  states: ChatStateStore;
  clock: Clock;
  logger: MaxLogger;
  registry: Registry;
  bot: { username: string; userId: number };
  miniAppEnabled: boolean;
}

type RoutedEvent = Exclude<IncomingEvent, { type: 'stopped' }>;
type CallbackEvent = Extract<IncomingEvent, { type: 'callback' }>;

interface Session {
  ctx: BotContext;
  event: RoutedEvent;
  answered(): boolean;
  hasPlaceholder(): boolean;
  consented(): Promise<boolean>;
}

const OPEN_COMMANDS = new Set(['start', 'help', 'delete']);
const OPEN_CALLBACKS = ['cs:pd', 'ac', `${COMMAND_PREFIX}:help`];
const COMMAND = /^\/([a-z_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/i;
const RETIRED_KEYBOARDS_LIMIT = 10_000;

function parseCommand(text: string | null): { name: string; args: string } | null {
  const match = text === null ? null : COMMAND.exec(text);
  if (!match) return null;
  return { name: (match[1] ?? '').toLowerCase(), args: (match[2] ?? '').trim() };
}

function isOpenCallback(payload: string): boolean {
  return OPEN_CALLBACKS.some((open) => payload === open || payload.startsWith(`${open}:`));
}

function createRecentSet(limit: number) {
  const items = new Set<string>();
  return {
    add(item: string) {
      items.delete(item);
      items.add(item);
      if (items.size <= limit) return;
      const [oldest] = items;
      if (oldest !== undefined) items.delete(oldest);
    },
    delete: (item: string) => items.delete(item),
    has: (item: string) => items.has(item),
  };
}

function hasButtons(message: OutgoingMessage): boolean {
  return (message.buttons ?? []).length > 0;
}

export function createRouter(options: RouterOptions): UpdateHandler {
  const { db, services, messenger, states, clock, logger, registry } = options;
  const retiredKeyboards = createRecentSet(RETIRED_KEYBOARDS_LIMIT);

  function openSession(event: RoutedEvent, user: User, state: ChatState): Session {
    let answered = false;
    let placeholderId: string | null = null;
    let consent: Promise<boolean> | undefined;
    const pressed = event.type === 'callback' ? event.messageId : null;

    const ctx: BotContext = {
      user,
      chatId: event.chatId,
      now: clock.now(),
      botUsername: options.bot.username,
      miniAppEnabled: options.miniAppEnabled,
      state,
      callbackMessageId: pressed,
      async saveState(next) {
        await states.save(user.id, next);
        ctx.state = next;
      },
      reply: (message) => messenger.sendToUser(user.id, message),
      async answer(answer) {
        if (event.type !== 'callback' || answered) return;
        await messenger.answerCallback(event.callbackId, answer);
        answered = true;
        if (pressed !== null && answer.message && !hasButtons(answer.message)) {
          retiredKeyboards.add(pressed);
        }
      },
      async placeholder(text) {
        if (event.type === 'callback' && !answered && pressed !== null) {
          await ctx.answer({ message: { text } });
          placeholderId = pressed;
          return;
        }
        placeholderId = (await ctx.reply({ text })).messageId;
      },
      async settle(message) {
        const target = placeholderId;
        placeholderId = null;
        if (target !== null) {
          try {
            await messenger.editMessage(target, message);
            if (hasButtons(message)) retiredKeyboards.delete(target);
            return { messageId: target };
          } catch (error) {
            if (error instanceof UserUnreachableError) throw error;
            logger.warn({ err: error, userId: user.id }, 'placeholder could not be replaced, sending anew');
          }
        }
        return ctx.reply(message);
      },
    };

    return {
      ctx,
      event,
      answered: () => answered,
      hasPlaceholder: () => placeholderId !== null,
      consented() {
        consent ??= services.consents.status(user.id).then(({ personalData }) => personalData.granted);
        return consent;
      },
    };
  }

  async function passesConsent(session: Session): Promise<boolean> {
    if (await session.consented()) return true;
    await session.ctx.answer({ notification: NOTICES.consentFirst });
    await session.ctx.reply(consentRequest());
    return false;
  }

  async function runCommand(session: Session, name: string, args: string): Promise<void> {
    const handler = registry.command(name);
    if (!handler) {
      await session.ctx.reply(helpMessage());
      return;
    }
    if (!OPEN_COMMANDS.has(name) && !(await passesConsent(session))) return;
    await handler(session.ctx, args);
  }

  async function onMessage(session: Session, message: MessageInput): Promise<void> {
    const { ctx } = session;
    const command = parseCommand(message.text);
    if (command) {
      await runCommand(session, command.name, command.args);
      return;
    }
    if (!(await passesConsent(session))) return;
    const flow = ctx.state.flow;
    const flowHandler = flow ? registry.flow(flow.name) : undefined;
    if (flowHandler && (await flowHandler(ctx, message))) return;
    const { location, photos, text } = registry.messages();
    if (message.location && location) await location(ctx, message.location);
    else if (message.photos.length > 0 && photos) await photos(ctx, message);
    else if (message.text !== null && text) await text(ctx, message.text);
    else await ctx.reply(shortHelpMessage());
  }

  async function onCallback(session: Session, event: CallbackEvent): Promise<void> {
    const { ctx } = session;
    if (event.messageId !== null && retiredKeyboards.has(event.messageId)) {
      await ctx.answer({ notification: NOTICES.pressedButton });
      return;
    }
    const route = parsePayload(event.payload);
    if (!route) {
      await ctx.answer({ notification: NOTICES.staleButton });
      return;
    }
    if (!isOpenCallback(event.payload) && !(await passesConsent(session))) return;
    if (route.prefix === COMMAND_PREFIX) {
      const command = registry.command(route.args[0] ?? '');
      if (!command) {
        await ctx.answer({ notification: NOTICES.staleButton });
        return;
      }
      await ctx.answer({ notification: NOTICES.opening });
      await command(ctx, '');
      return;
    }
    const handler = registry.callback(route.prefix);
    if (handler) await handler(ctx, route.args);
    else await ctx.answer({ notification: NOTICES.staleButton });
  }

  async function route(session: Session): Promise<void> {
    const { ctx, event } = session;
    const flow = ctx.state.flow;
    if (flow && isExpired(flow, ctx.now)) await ctx.saveState({ ...ctx.state, flow: null });
    switch (event.type) {
      case 'started':
        await runCommand(session, 'start', event.payload ?? '');
        return;
      case 'message':
        await onMessage(session, event);
        return;
      case 'callback':
        await onCallback(session, event);
    }
  }

  async function report(session: Session, error: unknown): Promise<void> {
    const { ctx, event } = session;
    const context = { userId: ctx.user.id, event: event.type };
    const failure = describeFailure(error);
    if (failure.kind === 'unreachable') {
      logger.warn(context, 'guest cannot be reached, the bot is probably blocked');
      return;
    }
    if (failure.kind === 'unexpected') logger.error({ ...context, err: error }, 'bot handler failed');
    try {
      if (session.hasPlaceholder()) {
        await ctx.settle(failure.message);
      } else if (event.type === 'callback' && !session.answered()) {
        await ctx.answer({ notification: failure.notice });
        if (failure.kind === 'consent') await ctx.reply(failure.message);
      } else {
        await ctx.reply(failure.message);
      }
    } catch (replyError) {
      logger.warn({ ...context, err: replyError }, 'failure reply was not delivered');
    }
  }

  async function ensureAnswered(session: Session, event: CallbackEvent): Promise<void> {
    if (session.answered()) return;
    const context = { userId: event.user.id, event: event.type };
    logger.warn(context, 'callback was left unanswered');
    try {
      await messenger.answerCallback(event.callbackId, { notification: NOTICES.tryAgain });
    } catch (error) {
      logger.warn({ ...context, err: error }, 'callback answer failed');
    }
  }

  return async (event) => {
    if (event.user.id === options.bot.userId) return;
    if (event.type === 'stopped') {
      await states.clear(event.user.id);
      return;
    }
    const user = await users.upsert(db, event.user);
    const session = openSession(event, user, await states.load(user.id));
    try {
      await route(session);
    } catch (error) {
      await report(session, error);
    }
    if (event.type === 'callback') await ensureAnswered(session, event);
  };
}
