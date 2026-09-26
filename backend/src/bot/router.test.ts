import { describe, expect, it, vi } from 'vitest';
import {
  answers,
  BOT_IDENTITY,
  botChat,
  CHAT_ID,
  GUEST_ID,
  payloads,
  sent,
  texts,
  type BotChat,
} from '../../test/bot.ts';
import { UserUnreachableError } from '../integrations/max/errors.ts';
import { conflict, forbidden } from '../shared/errors.ts';
import { BOT_COMMANDS } from './commands.ts';
import type { BotDependencies } from './index.ts';
import type { BotModule } from './context.ts';
import { createRegistry } from './registry.ts';
import { createRouter } from './router.ts';
import { FLOW_TTL_MS } from './state.ts';

function consentedChat(options: Parameters<typeof botChat>[0] = {}): BotChat {
  const chat = botChat(options);
  chat.world.consent('personal_data');
  return chat;
}

function withModule(module: BotModule) {
  return (deps: BotDependencies) => {
    const registry = createRegistry();
    registry.add(module);
    return createRouter({
      db: deps.pool,
      services: deps.services,
      messenger: deps.messenger,
      states: deps.states,
      clock: deps.clock,
      logger: deps.logger,
      registry,
      bot: deps.bot,
      miniAppEnabled: deps.miniAppEnabled,
    });
  };
}

const CONSENT_REMINDER: unknown = expect.stringContaining('Чтобы вести дневник, нужно ваше согласие');

describe('bot router without the personal data consent', () => {
  it('never downloads or recognizes a photo', async () => {
    const chat = botChat();

    const replies = await chat.photo();

    expect(texts(replies)).toEqual([CONSENT_REMINDER]);
    expect(payloads(sent(replies)[0])).toEqual(['cs:pd:ok', 'cs:pd:more']);
    expect(chat.api.download).not.toHaveBeenCalled();
    expect(chat.world.recognizePhoto).not.toHaveBeenCalled();
  });

  it('never recognizes or logs text', async () => {
    const chat = botChat();
    expect(texts(await chat.send('съел борщ'))).toEqual([CONSENT_REMINDER]);
    expect(texts(await chat.send('Сырники 350'))).toEqual([CONSENT_REMINDER]);
    expect(texts(await chat.location({ lat: 55.79, lon: 49.12 }))).toEqual([CONSENT_REMINDER]);
    expect(chat.world.recognizeText).not.toHaveBeenCalled();
    expect(chat.world.meals).toHaveLength(0);
    expect(chat.world.user.location).toBeNull();
  });

  it('allows only /start, /help and /delete among the commands', async () => {
    const chat = botChat();
    expect(texts(await chat.send('/today'))).toEqual([CONSENT_REMINDER]);
    expect(texts(await chat.send('/profile'))).toEqual([CONSENT_REMINDER]);
    expect(texts(await chat.send('/help'))[0]).toContain('**Что я умею**');
    expect(texts(await chat.send('/delete'))[0]).toContain('Удалить аккаунт и все данные');
    expect(texts(await chat.send('/start'))).toHaveLength(2);
  });

  it('answers other buttons with a reminder and the consent buttons', async () => {
    const chat = botChat();

    const replies = await chat.press('ml:ok:1', 'mid.old');

    expect(replies).toEqual([
      {
        kind: 'answer',
        messageId: 'mid.old',
        notification: 'Сначала нужно согласие на обработку данных',
        message: null,
      },
      expect.objectContaining({ kind: 'send', text: CONSENT_REMINDER }),
    ]);
    expect(answers(await chat.press('cmd:today', 'mid.old'))[0]?.notification).toBe(
      'Сначала нужно согласие на обработку данных',
    );
    expect(answers(await chat.press('cmd:help', 'mid.old'))[0]?.notification).toBe('Открываю');
  });
});

describe('bot router', () => {
  it('runs every registered bot command', async () => {
    const chat = consentedChat();
    for (const { name } of BOT_COMMANDS.filter((command) => command.name !== 'help')) {
      const replies = await chat.send(`/${name}`);
      expect(texts(replies).join('\n')).not.toContain('Что я умею');
    }
  });

  it('accepts commands addressed to the bot by name', async () => {
    const chat = consentedChat();
    expect(texts(await chat.send('/today@ppshkin_bot'))[0]).toContain('**Сегодня, 26 сентября**');
    expect(texts(await chat.send('/TODAY'))[0]).toContain('**Сегодня, 26 сентября**');
  });

  it('answers unknown commands with help', async () => {
    const chat = consentedChat();
    expect(texts(await chat.send('/eat'))[0]).toContain('**Что я умею**');
    expect(texts(await chat.send('/unknown with args'))[0]).toContain('**Что я умею**');
  });

  it('answers stickers, files and other empty messages with a short help', async () => {
    const chat = consentedChat();
    expect(texts(await chat.empty())).toEqual([
      'Я понимаю фото еды и текст, например: Сырники 350. Все возможности: /help',
    ]);
  });

  it('answers unknown and malformed buttons as stale', async () => {
    const chat = consentedChat();
    for (const payload of ['zz:1', '', 'ml:ok:ё', ':ok', 'cmd:unknown', 'cmd']) {
      expect(await chat.press(payload, 'mid.old')).toEqual([
        { kind: 'answer', messageId: 'mid.old', notification: 'Кнопка устарела', message: null },
      ]);
    }
  });

  it('forgets an expired flow and handles the message as usual', async () => {
    const chat = consentedChat();
    await chat.press('ml:manual', 'mid.old');
    chat.world.clock.advance(FLOW_TTL_MS);

    const replies = await chat.send('Плов');

    expect(texts(replies)).toEqual(['Записать «Плов» в дневник?']);
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'meal_text_confirm' });
  });

  it('keeps a flow that is about to expire', async () => {
    const chat = consentedChat();
    await chat.press('ml:manual', 'mid.old');
    chat.world.clock.advance(FLOW_TTL_MS - 1);

    expect(texts(await chat.send('Плов'))).toEqual([
      'Не понял. Напишите название и калории числом, например: Сырники 350',
    ]);
  });

  it('starts over from a broken or outdated state', async () => {
    const chat = consentedChat();
    chat.states.put(GUEST_ID, { flow: { name: 'meal_fix', mealId: 'seven' }, pendingStart: 5 });

    expect(texts(await chat.send('Сырники 350'))[0]).toContain('Записал: **Сырники**');

    chat.states.put(GUEST_ID, 'garbage');
    expect(texts(await chat.send('/today'))[0]).toContain('**Сегодня');
  });

  it('clears the dialog when the guest stops the bot and sends nothing', async () => {
    const chat = consentedChat();
    await chat.send('что-то');
    expect(chat.states.peek(GUEST_ID).flow).not.toBeNull();

    expect(await chat.stop()).toEqual([]);
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
  });

  it('ignores events of the bot itself', async () => {
    const chat = consentedChat();
    const replies = await chat.deliver({
      type: 'message',
      key: 'message:bot',
      user: { id: BOT_IDENTITY.userId, firstName: 'ППшкин', username: BOT_IDENTITY.username },
      chatId: CHAT_ID,
      messageId: 'mid.bot',
      text: 'Сырники 350',
      photos: [],
      location: null,
    });
    expect(replies).toEqual([]);
    expect(chat.world.meals).toHaveLength(0);
  });

  it('shows the consent again when a service asks for it', async () => {
    const chat = consentedChat();
    chat.world.services.diary.day = () =>
      Promise.reject(forbidden('consent_required', 'Consent to personal data processing is required'));

    expect(texts(await chat.send('/today'))).toEqual([CONSENT_REMINDER]);

    const pressed = await chat.press('cmd:today', 'mid.menu');
    expect(answers(pressed)[0]?.notification).toBe('Открываю');
    expect(texts(pressed)).toEqual([CONSENT_REMINDER]);
  });

  it('answers a button with the consent reminder when the service refuses before answering', async () => {
    const chat = consentedChat();
    chat.world.services.consents.grant = () =>
      Promise.reject(conflict('consent_version_outdated', 'The consent text has changed'));

    const replies = await chat.press('cs:ad:yes:ob', 'mid.offers');

    expect(replies).toEqual([
      expect.objectContaining({ kind: 'answer', notification: 'Сначала нужно согласие на обработку данных' }),
      expect.objectContaining({ kind: 'send', text: CONSENT_REMINDER }),
    ]);
  });

  it('logs an unexpected failure without message texts and keeps working', async () => {
    const chat = consentedChat();
    chat.world.services.diary.addManual = () => Promise.reject(new Error('connection terminated'));

    expect(texts(await chat.send('Секретные сырники 350'))).toEqual([
      'Что-то пошло не так. Попробуйте ещё раз или отправьте /help',
    ]);
    expect(chat.logger.error).toHaveBeenCalledWith(
      { userId: GUEST_ID, event: 'message', err: expect.any(Error) as unknown },
      'bot handler failed',
    );
    expect(JSON.stringify(chat.logger.error.mock.calls)).not.toContain('Секретные');

    expect(texts(await chat.send('/today'))[0]).toContain('**Сегодня');
  });

  it('answers a failed button once with a short notice', async () => {
    const chat = consentedChat();
    chat.world.services.diary.remove = () => Promise.reject(new Error('connection terminated'));

    const replies = await chat.press('ml:del:1', 'mid.meal');

    expect(replies).toEqual([
      {
        kind: 'answer',
        messageId: 'mid.meal',
        notification: 'Не получилось, попробуйте ещё раз',
        message: null,
      },
    ]);
    expect(chat.api.answerCallback).toHaveBeenCalledTimes(1);
  });

  it('sends the failure as a message when the button was already answered', async () => {
    const chat = consentedChat();
    chat.world.services.diary.day = () => Promise.reject(new Error('connection terminated'));

    const replies = await chat.press('cmd:today', 'mid.menu');

    expect(answers(replies)).toHaveLength(1);
    expect(texts(replies)).toEqual(['Что-то пошло не так. Попробуйте ещё раз или отправьте /help']);
  });

  it('stays silent towards a guest who blocked the bot', async () => {
    const chat = consentedChat({
      api: { sendMessage: vi.fn(() => Promise.reject(new UserUnreachableError('chat.denied', 'blocked'))) },
    });

    await expect(chat.send('/today')).resolves.toEqual([]);

    expect(chat.logger.warn).toHaveBeenCalledWith(
      { userId: GUEST_ID, event: 'message' },
      'guest cannot be reached, the bot is probably blocked',
    );
    expect(chat.logger.error).not.toHaveBeenCalled();
    expect(chat.api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('logs a failure it could not report and does not throw', async () => {
    const chat = consentedChat({
      api: { sendMessage: vi.fn(() => Promise.reject(new Error('MAX is down'))) },
    });

    await expect(chat.send('/today')).resolves.toEqual([]);

    expect(chat.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: GUEST_ID, event: 'message' }),
      'failure reply was not delivered',
    );
  });

  it('answers a button whose handler forgot to answer', async () => {
    const chat = consentedChat({
      createHandler: withModule({ callbacks: { zz: () => Promise.resolve() } }),
    });

    const replies = await chat.press('zz:quiet', 'mid.old');

    expect(replies).toEqual([
      {
        kind: 'answer',
        messageId: 'mid.old',
        notification: 'Не получилось, попробуйте ещё раз',
        message: null,
      },
    ]);
    expect(chat.logger.warn).toHaveBeenCalledWith(
      { userId: GUEST_ID, event: 'callback' },
      'callback was left unanswered',
    );
  });

  it('logs a callback answer that could not be delivered', async () => {
    const chat = consentedChat({
      createHandler: withModule({ callbacks: { zz: () => Promise.resolve() } }),
      api: { answerCallback: vi.fn(() => Promise.reject(new Error('MAX is down'))) },
    });

    await expect(chat.press('zz:quiet', 'mid.old')).resolves.toEqual([]);

    expect(chat.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: GUEST_ID, event: 'callback' }),
      'callback answer failed',
    );
  });

  it('answers a callback at most once', async () => {
    const chat = consentedChat({
      createHandler: withModule({
        callbacks: {
          zz: async (ctx) => {
            await ctx.answer({ notification: 'Первый' });
            await ctx.answer({ notification: 'Второй' });
          },
        },
      }),
    });

    const replies = await chat.press('zz:twice', 'mid.old');

    expect(answers(replies).map((answer) => answer.notification)).toEqual(['Первый']);
  });

  it('ignores answers outside callbacks', async () => {
    const chat = consentedChat({
      createHandler: withModule({
        commands: {
          ping: async (ctx) => {
            await ctx.answer({ notification: 'Не для сообщений' });
            await ctx.reply({ text: 'pong' });
          },
        },
      }),
    });

    expect(await chat.send('/ping')).toEqual([expect.objectContaining({ kind: 'send', text: 'pong' })]);
  });

  it('shows a placeholder in place of a pressed message whose answer came first', async () => {
    const chat = consentedChat({
      createHandler: withModule({
        callbacks: {
          zz: async (ctx) => {
            await ctx.answer({ notification: 'Готово' });
            await ctx.placeholder('Жду...');
            await ctx.settle({ text: 'Результат' });
          },
        },
      }),
    });

    const replies = await chat.press('zz:slow', 'mid.old');

    expect(replies).toEqual([
      expect.objectContaining({ kind: 'answer', notification: 'Готово' }),
      expect.objectContaining({ kind: 'send', text: 'Жду...' }),
      expect.objectContaining({ kind: 'edit', text: 'Результат' }),
    ]);
  });

  it('settles without a placeholder by sending a new message', async () => {
    const chat = consentedChat({
      createHandler: withModule({
        commands: {
          ping: async (ctx) => {
            await ctx.settle({ text: 'pong' });
          },
        },
      }),
    });

    expect(await chat.send('/ping')).toEqual([expect.objectContaining({ kind: 'send', text: 'pong' })]);
  });
});
