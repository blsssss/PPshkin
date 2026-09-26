import { describe, expect, it } from 'vitest';
import { MAX_UPDATE_TYPES, parseUpdate } from './updates.ts';

const TIMESTAMP = 1_790_000_000_123;

const sender = {
  user_id: 396272693,
  first_name: 'Ирина',
  last_name: null,
  username: 'irina_k',
  is_bot: false,
  last_activity_time: 1_790_000_000_000,
};

function message(body: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    sender,
    recipient: { chat_id: 555, chat_type: 'dialog', user_id: 700 },
    timestamp: TIMESTAMP - 5,
    link: null,
    body: { mid: 'mid.0001', seq: 1, text: null, attachments: [], markup: [], ...body },
    stat: null,
    url: null,
    ...overrides,
  };
}

function messageCreated(body: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    update_type: 'message_created',
    timestamp: TIMESTAMP,
    user_locale: 'ru',
    message: message(body, overrides),
  };
}

const photo = (id: number, token: string | null = `token-${id}`) => ({
  type: 'image',
  payload: { photo_id: id, url: `https://i.oneme.test/i?r=${id}`, ...(token === null ? {} : { token }) },
});

describe('parseUpdate', () => {
  it('lists the update types the bot subscribes to', () => {
    expect(MAX_UPDATE_TYPES).toEqual(['bot_started', 'message_created', 'message_callback', 'bot_stopped']);
  });

  it('maps bot_started with its deep link payload', () => {
    const update = {
      update_type: 'bot_started',
      timestamp: TIMESTAMP,
      chat_id: 555,
      user: sender,
      payload: 'venue_42',
      user_locale: 'ru',
    };
    expect(parseUpdate(update)).toEqual({
      type: 'started',
      key: `bot_started:555:${TIMESTAMP}`,
      user: { id: 396272693, firstName: 'Ирина', username: 'irina_k' },
      chatId: 555,
      payload: 'venue_42',
    });
    expect(parseUpdate({ ...update, payload: null })).toMatchObject({ payload: null });
    expect(parseUpdate({ ...update, payload: undefined })).toMatchObject({ payload: null });
  });

  it('maps a text message and trims the text', () => {
    expect(parseUpdate(messageCreated({ text: '  Съела сырники  ' }))).toEqual({
      type: 'message',
      key: `message_created:mid.0001:${TIMESTAMP}`,
      user: { id: 396272693, firstName: 'Ирина', username: 'irina_k' },
      chatId: 555,
      messageId: 'mid.0001',
      text: 'Съела сырники',
      photos: [],
      location: null,
    });
  });

  it('collects every photo in order and ignores other attachments', () => {
    const update = messageCreated({
      text: 'Обед',
      attachments: [
        photo(1),
        { type: 'sticker', payload: { url: 'https://i.oneme.test/s', code: 'x' }, width: 1, height: 1 },
        photo(2, null),
        { type: 'file', payload: { url: 'https://f.test/a.pdf', token: 't' }, filename: 'a.pdf', size: 1 },
        { type: 'image', payload: { photo_id: 3 } },
        photo(4),
      ],
    });
    expect(parseUpdate(update)).toMatchObject({
      photos: [
        { url: 'https://i.oneme.test/i?r=1', token: 'token-1' },
        { url: 'https://i.oneme.test/i?r=2', token: null },
        { url: 'https://i.oneme.test/i?r=4', token: 'token-4' },
      ],
      location: null,
    });
  });

  it('takes the first location with valid coordinates', () => {
    const update = messageCreated({
      attachments: [
        { type: 'location', payload: { latitude: 55.79, longitude: 49.12 } },
        { type: 'location', latitude: 123, longitude: 49.12 },
        { type: 'location', latitude: 55.7963, longitude: 49.1088 },
        { type: 'location', latitude: 1, longitude: 2 },
      ],
    });
    expect(parseUpdate(update)).toMatchObject({
      text: null,
      photos: [],
      location: { lat: 55.7963, lon: 49.1088 },
    });
  });

  it('keeps messages without text, photos or location so the bot can answer with a hint', () => {
    for (const body of [
      { text: '   ' },
      { text: '' },
      { text: undefined, attachments: null },
      { attachments: [{ type: 'sticker', payload: { url: 'https://i.oneme.test/s', code: 'x' } }] },
    ]) {
      expect(parseUpdate(messageCreated(body))).toMatchObject({
        type: 'message',
        text: null,
        photos: [],
        location: null,
      });
    }
  });

  it('ignores message_created without a message, a sender or a chat', () => {
    expect(
      parseUpdate({ update_type: 'message_created', timestamp: TIMESTAMP, user_locale: 'ru' }),
    ).toBeNull();
    expect(parseUpdate({ update_type: 'message_created', timestamp: TIMESTAMP, message: null })).toBeNull();
    expect(parseUpdate(messageCreated({ text: 'x' }, { sender: null }))).toBeNull();
    expect(parseUpdate(messageCreated({ text: 'x' }, { sender: undefined }))).toBeNull();
    expect(
      parseUpdate(messageCreated({ text: 'x' }, { recipient: { chat_id: null, chat_type: 'dialog' } })),
    ).toBeNull();
  });

  it('maps a button press with the message that holds the keyboard', () => {
    const update = {
      update_type: 'message_callback',
      timestamp: TIMESTAMP,
      callback: { timestamp: TIMESTAMP, callback_id: 'cb.77', payload: 'offer:accept:42', user: sender },
      message: message({ text: 'Чизкейк рядом' }),
      user_locale: 'ru',
    };
    expect(parseUpdate(update)).toEqual({
      type: 'callback',
      key: `message_callback:cb.77:${TIMESTAMP}`,
      user: { id: 396272693, firstName: 'Ирина', username: 'irina_k' },
      chatId: 555,
      callbackId: 'cb.77',
      payload: 'offer:accept:42',
      messageId: 'mid.0001',
    });
  });

  it('maps a button press on a deleted or unreadable message', () => {
    const callback = { timestamp: TIMESTAMP, callback_id: 'cb.78', user: sender };
    const expected = { type: 'callback', callbackId: 'cb.78', payload: '', chatId: null, messageId: null };
    const base = { update_type: 'message_callback', timestamp: TIMESTAMP, callback };
    expect(parseUpdate({ ...base, message: null })).toMatchObject(expected);
    expect(parseUpdate(base)).toMatchObject(expected);
    expect(parseUpdate({ ...base, message: { body: null } })).toMatchObject(expected);
  });

  it('maps bot_stopped', () => {
    const update = { update_type: 'bot_stopped', timestamp: TIMESTAMP, chat_id: 555, user: sender };
    expect(parseUpdate(update)).toEqual({
      type: 'stopped',
      key: `bot_stopped:555:${TIMESTAMP}`,
      user: { id: 396272693, firstName: 'Ирина', username: 'irina_k' },
    });
  });

  it('fills missing names with null', () => {
    const update = {
      update_type: 'bot_stopped',
      timestamp: TIMESTAMP,
      chat_id: 555,
      user: { user_id: 1, username: null },
    };
    expect(parseUpdate(update)).toMatchObject({ user: { id: 1, firstName: null, username: null } });
  });

  it('ignores update types the bot does not handle', () => {
    for (const updateType of [
      'message_edited',
      'message_removed',
      'dialog_removed',
      'bot_added',
      'unknown',
    ]) {
      expect(
        parseUpdate({ update_type: updateType, timestamp: TIMESTAMP, chat_id: 1, user: sender }),
      ).toBeNull();
    }
  });

  it('returns null for broken input without throwing', () => {
    const cyclic: Record<string, unknown> = { update_type: 'bot_started', timestamp: TIMESTAMP };
    cyclic.user = cyclic;
    const throwing = {
      update_type: 'bot_started',
      timestamp: TIMESTAMP,
      chat_id: 1,
      get user() {
        throw new Error('broken getter');
      },
    };
    const inputs: unknown[] = [
      null,
      undefined,
      42,
      '{"update_type":"bot_started"',
      [],
      {},
      { update_type: 'bot_started' },
      { update_type: 'bot_started', timestamp: 'now', chat_id: 1, user: sender },
      { update_type: 'bot_started', timestamp: TIMESTAMP, chat_id: 1, user: { ...sender, user_id: '1' } },
      { update_type: 'bot_started', timestamp: TIMESTAMP, chat_id: 1, user: { ...sender, user_id: -1001 } },
      { update_type: 'message_callback', timestamp: TIMESTAMP, callback: { callback_id: '', user: sender } },
      messageCreated({ mid: '' }),
      cyclic,
      throwing,
    ];
    for (const input of inputs) {
      expect(parseUpdate(input)).toBeNull();
    }
  });
});
