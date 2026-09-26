import { describe, expect, it, vi } from 'vitest';
import { botChat, GUEST_ID, texts } from '../../test/bot.ts';
import { fakeLogger } from '../../test/max-api.ts';
import type { Queryable } from '../db/pool.ts';
import { createDedupingHandler } from '../integrations/max/dedupe.ts';
import { UserUnreachableError } from '../integrations/max/errors.ts';
import type { IncomingEvent, Messenger } from '../ports/messenger.ts';
import { badRequest, conflict, forbidden, notFound } from '../shared/errors.ts';
import { describeFailure, withFallbackReply } from './failures.ts';
import { createBot } from './index.ts';

const guest = { id: GUEST_ID, firstName: null, username: null };

const events: Record<IncomingEvent['type'], IncomingEvent> = {
  started: { type: 'started', key: 'k1', user: guest, chatId: 1, payload: null },
  message: {
    type: 'message',
    key: 'k2',
    user: guest,
    chatId: 1,
    messageId: 'mid.1',
    text: 'Сырники 350',
    photos: [],
    location: null,
  },
  callback: {
    type: 'callback',
    key: 'k3',
    user: guest,
    chatId: 1,
    callbackId: 'cb.1',
    payload: 'ml:ok:1',
    messageId: 'mid.2',
  },
  stopped: { type: 'stopped', key: 'k4', user: guest },
};

function fakeMessenger(): Messenger & {
  sendToUser: ReturnType<typeof vi.fn>;
  answerCallback: ReturnType<typeof vi.fn>;
} {
  return {
    sendToUser: vi.fn(() => Promise.resolve({ messageId: 'mid.sent' })),
    editMessage: vi.fn(() => Promise.resolve()),
    answerCallback: vi.fn(() => Promise.resolve()),
    uploadImage: vi.fn(() => Promise.resolve('token')),
    sendTyping: vi.fn(() => Promise.resolve()),
    downloadFile: vi.fn(() => Promise.resolve(Buffer.alloc(0))),
  };
}

const failingDatabase: Queryable = {
  query: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
};

describe('describeFailure', () => {
  it('stays silent for guests who blocked the bot', () => {
    expect(describeFailure(new UserUnreachableError('chat.denied', 'blocked'))).toEqual({
      kind: 'unreachable',
    });
  });

  it('asks for the consent again when a service requires it', () => {
    for (const error of [
      forbidden('consent_required', 'Consent is required'),
      conflict('consent_version_outdated', 'The consent text has changed'),
    ]) {
      const failure = describeFailure(error);
      expect(failure).toMatchObject({
        kind: 'consent',
        notice: 'Сначала нужно согласие на обработку данных',
      });
      expect(failure.kind !== 'unreachable' && failure.message.buttons).toEqual([
        [
          { kind: 'callback', text: 'Согласен', payload: 'cs:pd:ok' },
          { kind: 'callback', text: 'Подробнее', payload: 'cs:pd:more' },
        ],
      ]);
    }
  });

  it('explains known error codes', () => {
    expect(describeFailure(notFound('meal_not_found', 'Meal not found'))).toEqual({
      kind: 'known',
      message: { text: 'Не нашёл: запись уже удалена или устарела.' },
      notice: 'Не нашёл: запись уже удалена или устарела.',
    });
    expect(describeFailure(badRequest('validation_failed', 'Bad input'))).toMatchObject({ kind: 'known' });
  });

  it('apologizes for anything else', () => {
    for (const error of [new Error('boom'), conflict('delete_account_instead', 'Nope'), 'string']) {
      expect(describeFailure(error)).toEqual({
        kind: 'unexpected',
        message: { text: 'Что-то пошло не так. Попробуйте ещё раз или отправьте /help' },
        notice: 'Не получилось, попробуйте ещё раз',
      });
    }
  });
});

describe('withFallbackReply', () => {
  it('passes successful updates through', async () => {
    const messenger = fakeMessenger();
    const handler = vi.fn(() => Promise.resolve());
    await withFallbackReply(handler, { messenger, logger: fakeLogger() })(events.message);
    expect(handler).toHaveBeenCalledWith(events.message);
    expect(messenger.sendToUser).not.toHaveBeenCalled();
  });

  it.each(['message', 'started'] as const)('apologizes for a failed %s and logs it', async (type) => {
    const messenger = fakeMessenger();
    const logger = fakeLogger();
    const failed = withFallbackReply(() => Promise.reject(new Error('database is down')), {
      messenger,
      logger,
    });

    await failed(events[type]);

    expect(messenger.sendToUser).toHaveBeenCalledWith(GUEST_ID, {
      text: 'Что-то пошло не так. Попробуйте ещё раз или отправьте /help',
    });
    expect(logger.error).toHaveBeenCalledWith(
      { userId: GUEST_ID, event: type, err: expect.any(Error) as unknown },
      'bot update failed before routing',
    );
  });

  it('answers a failed callback with a notice', async () => {
    const messenger = fakeMessenger();
    const failed = withFallbackReply(() => Promise.reject(new Error('database is down')), {
      messenger,
      logger: fakeLogger(),
    });

    await failed(events.callback);

    expect(messenger.answerCallback).toHaveBeenCalledWith('cb.1', {
      notification: 'Не получилось, попробуйте ещё раз',
    });
    expect(messenger.sendToUser).not.toHaveBeenCalled();
  });

  it('only logs a failed stop event', async () => {
    const messenger = fakeMessenger();
    const logger = fakeLogger();
    await withFallbackReply(() => Promise.reject(new Error('database is down')), { messenger, logger })(
      events.stopped,
    );
    expect(logger.error).toHaveBeenCalled();
    expect(messenger.sendToUser).not.toHaveBeenCalled();
    expect(messenger.answerCallback).not.toHaveBeenCalled();
  });

  it('does not write to a guest who blocked the bot', async () => {
    const messenger = fakeMessenger();
    const logger = fakeLogger();
    await withFallbackReply(() => Promise.reject(new UserUnreachableError('chat.denied', 'blocked')), {
      messenger,
      logger,
    })(events.message);
    expect(messenger.sendToUser).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { userId: GUEST_ID, event: 'message' },
      'guest cannot be reached, the bot is probably blocked',
    );
  });

  it('never throws when the apology cannot be delivered', async () => {
    const messenger = fakeMessenger();
    messenger.sendToUser.mockRejectedValue(new Error('MAX is down'));
    const logger = fakeLogger();
    const failed = withFallbackReply(() => Promise.reject(new Error('database is down')), {
      messenger,
      logger,
    });

    await expect(failed(events.message)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: GUEST_ID, event: 'message' }),
      'failure reply was not delivered',
    );
  });

  it('covers a failure of the deduplication before the router runs', async () => {
    const chat = botChat({
      createHandler: (deps) =>
        withFallbackReply(createDedupingHandler(failingDatabase, createBot(deps)), deps),
    });

    expect(texts(await chat.send('Сырники 350'))).toEqual([
      'Что-то пошло не так. Попробуйте ещё раз или отправьте /help',
    ]);
    expect(await chat.press('ml:ok:1', 'mid.old')).toEqual([
      {
        kind: 'answer',
        messageId: 'mid.old',
        notification: 'Не получилось, попробуйте ещё раз',
        message: null,
      },
    ]);
    expect(chat.logger.error).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(chat.logger.error.mock.calls)).not.toContain('Сырники');
  });
});
