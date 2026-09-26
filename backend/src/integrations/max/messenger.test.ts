import { describe, expect, it, vi } from 'vitest';
import { fakeMaxApi } from '../../../test/max-api.ts';
import type { Button, OutgoingMessage } from '../../ports/messenger.ts';
import { createMaxMessenger, escapeMarkdown } from './messenger.ts';

const BOT = { botUsername: 'ppshkin_bot', botUserId: 700 };

function setup() {
  const api = fakeMaxApi({
    sendMessage: vi.fn(() => Promise.resolve({ mid: 'mid.sent' })),
    editMessage: vi.fn(() => Promise.resolve()),
    answerCallback: vi.fn(() => Promise.resolve()),
    sendAction: vi.fn(() => Promise.resolve()),
    uploadImage: vi.fn(() => Promise.resolve('photo-token')),
    download: vi.fn(() => Promise.resolve(Buffer.from('file'))),
  });
  return { api, messenger: createMaxMessenger(api, BOT) };
}

const callback = (text = 'Хочу', payload = 'offer:accept:1'): Button => ({ kind: 'callback', text, payload });
const link = (url = 'https://ppshkin.example/menu'): Button => ({ kind: 'link', text: 'Меню', url });

describe('MAX messenger', () => {
  it('sends markdown text and passes notify only when it is set', async () => {
    const { api, messenger } = setup();
    expect(await messenger.sendToUser(101, { text: 'Привет' })).toEqual({ messageId: 'mid.sent' });
    await messenger.sendToUser(101, { text: '<b>Итог</b>', format: 'html', notify: false });
    expect(api.sendMessage).toHaveBeenNthCalledWith(
      1,
      { userId: 101 },
      { text: 'Привет', format: 'markdown' },
    );
    expect(api.sendMessage).toHaveBeenNthCalledWith(
      2,
      { userId: 101 },
      { text: '<b>Итог</b>', format: 'html', notify: false },
    );
  });

  it('maps every kind of button', async () => {
    const { api, messenger } = setup();
    await messenger.sendToUser(101, {
      text: 'Что дальше?',
      buttons: [
        [callback()],
        [link()],
        [{ kind: 'location', text: 'Где я' }],
        [
          { kind: 'app', text: 'Дневник' },
          { kind: 'app', text: 'Заведение', payload: 'venue_42' },
        ],
      ],
    });
    expect(api.sendMessage).toHaveBeenCalledWith(
      { userId: 101 },
      {
        text: 'Что дальше?',
        format: 'markdown',
        attachments: [
          {
            type: 'inline_keyboard',
            payload: {
              buttons: [
                [{ type: 'callback', text: 'Хочу', payload: 'offer:accept:1' }],
                [{ type: 'link', text: 'Меню', url: 'https://ppshkin.example/menu' }],
                [{ type: 'request_geo_location', text: 'Где я', quick: false }],
                [
                  { type: 'open_app', text: 'Дневник', web_app: 'ppshkin_bot', contact_id: 700 },
                  {
                    type: 'open_app',
                    text: 'Заведение',
                    web_app: 'ppshkin_bot',
                    contact_id: 700,
                    payload: 'venue_42',
                  },
                ],
              ],
            },
          },
        ],
      },
    );
  });

  it('puts photos before the keyboard in one message', async () => {
    const { api, messenger } = setup();
    await messenger.sendToUser(101, { text: 'Бронь', imageTokens: ['qr', 'map'], buttons: [[callback()]] });
    expect(api.sendMessage).toHaveBeenCalledWith(
      { userId: 101 },
      expect.objectContaining({
        attachments: [
          { type: 'image', payload: { token: 'qr' } },
          { type: 'image', payload: { token: 'map' } },
          {
            type: 'inline_keyboard',
            payload: { buttons: [[{ type: 'callback', text: 'Хочу', payload: 'offer:accept:1' }]] },
          },
        ],
      }),
    );
  });

  it('always sends attachments when editing so the old keyboard disappears', async () => {
    const { api, messenger } = setup();
    await messenger.editMessage('mid.1', { text: 'Бронь отменена' });
    await messenger.editMessage('mid.2', { text: 'Выберите', buttons: [], imageTokens: [] });
    expect(api.editMessage).toHaveBeenNthCalledWith(1, 'mid.1', {
      text: 'Бронь отменена',
      format: 'markdown',
      attachments: [],
    });
    expect(api.editMessage).toHaveBeenNthCalledWith(2, 'mid.2', {
      text: 'Выберите',
      format: 'markdown',
      attachments: [],
    });
  });

  it('answers callbacks with a notification, a replacement message or both', async () => {
    const { api, messenger } = setup();
    await messenger.answerCallback('cb.1', { notification: 'Готово' });
    await messenger.answerCallback('cb.2', { message: { text: 'Забронировано' } });
    await messenger.answerCallback('cb.3', {
      notification: 'Ок',
      message: { text: 'Ещё', buttons: [[callback()]] },
    });
    expect(api.answerCallback).toHaveBeenNthCalledWith(1, 'cb.1', { notification: 'Готово' });
    expect(api.answerCallback).toHaveBeenNthCalledWith(2, 'cb.2', {
      message: { text: 'Забронировано', format: 'markdown', attachments: [] },
    });
    expect(api.answerCallback).toHaveBeenNthCalledWith(3, 'cb.3', {
      notification: 'Ок',
      message: expect.objectContaining({
        attachments: [expect.objectContaining({ type: 'inline_keyboard' })],
      }) as unknown,
    });
  });

  it('accepts messages right at the limits', async () => {
    const { api, messenger } = setup();
    await messenger.sendToUser(101, {
      text: 'а'.repeat(4000),
      imageTokens: Array.from({ length: 12 }, (_, index) => `t${index}`),
      buttons: [
        Array.from({ length: 7 }, () => callback('б'.repeat(128), 'p'.repeat(1024))),
        [
          link(`https://ppshkin.example/${'x'.repeat(2048 - 25)}`),
          { kind: 'location', text: 'Где я' },
          link(),
        ],
        [{ kind: 'app', text: 'Открыть', payload: `${'A'.repeat(500)}_-z09` }],
        ...Array.from({ length: 27 }, () => [callback()]),
      ],
    });
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  const violations: [string, OutgoingMessage, RegExp][] = [
    ['text is too long', { text: 'а'.repeat(4001) }, /4001 characters/],
    [
      'there are too many photos',
      { text: 'x', imageTokens: Array.from({ length: 13 }, () => 't') },
      /13 images/,
    ],
    [
      'there are too many rows',
      { text: 'x', buttons: Array.from({ length: 31 }, () => [callback()]) },
      /31 rows/,
    ],
    ['a row is empty', { text: 'x', buttons: [[callback()], []] }, /row 2 has 0 buttons/],
    [
      'a row has more than 7 buttons',
      { text: 'x', buttons: [Array.from({ length: 8 }, () => callback())] },
      /row 1 has 8/,
    ],
    [
      'a row with a link has more than 3 buttons',
      { text: 'x', buttons: [[link(), callback(), callback(), callback()]] },
      /row 1 has 4 buttons, 1 to 3/,
    ],
    [
      'a row with a location button has more than 3 buttons',
      { text: 'x', buttons: [[{ kind: 'location', text: 'Где' }, callback(), callback(), callback()]] },
      /1 to 3/,
    ],
    [
      'a row with an app button has more than 3 buttons',
      { text: 'x', buttons: [[{ kind: 'app', text: 'App' }, callback(), callback(), callback()]] },
      /1 to 3/,
    ],
    ['a button has no text', { text: 'x', buttons: [[callback('')]] }, /Button 1 in keyboard row 1 text/],
    ['a button text is too long', { text: 'x', buttons: [[callback('б'.repeat(129))]] }, /1 to 128/],
    ['a callback payload is too long', { text: 'x', buttons: [[callback('Да', 'p'.repeat(1025))]] }, /1024/],
    ['a link is not http', { text: 'x', buttons: [[link('javascript:alert(1)')]] }, /http or https/],
    ['a link is not a URL', { text: 'x', buttons: [[link('menu')]] }, /http or https/],
    ['a link is too long', { text: 'x', buttons: [[link(`https://a.example/${'x'.repeat(2048)}`)]] }, /2048/],
    [
      'an app payload has forbidden characters',
      { text: 'x', buttons: [[{ kind: 'app', text: 'App', payload: 'venue 42' }]] },
      /payload must match/,
    ],
    [
      'an app payload is too long',
      { text: 'x', buttons: [[{ kind: 'app', text: 'App', payload: 'a'.repeat(513) }]] },
      /payload must match/,
    ],
  ];

  it.each(violations)('refuses to send when %s', async (_name, message, error) => {
    const { api, messenger } = setup();
    await expect(messenger.sendToUser(101, message)).rejects.toThrow(error);
    await expect(messenger.editMessage('mid', message)).rejects.toThrow(error);
    await expect(messenger.answerCallback('cb', { message })).rejects.toThrow(error);
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.editMessage).not.toHaveBeenCalled();
    expect(api.answerCallback).not.toHaveBeenCalled();
  });

  it('shows typing and ignores failures of the indicator', async () => {
    const { api, messenger } = setup();
    await messenger.sendTyping(555);
    expect(api.sendAction).toHaveBeenCalledWith(555, 'typing_on');
    vi.mocked(api.sendAction).mockRejectedValueOnce(new Error('not supported in dialogs'));
    await expect(messenger.sendTyping(555)).resolves.toBeUndefined();
  });

  it('uploads PNG and JPEG images with the matching content type', async () => {
    const { api, messenger } = setup();
    const data = Buffer.from('image');
    expect(await messenger.uploadImage(data, 'qr.png')).toBe('photo-token');
    await messenger.uploadImage(data, 'dish.JPG');
    await messenger.uploadImage(data, 'dish.jpeg');
    expect(vi.mocked(api.uploadImage).mock.calls).toEqual([
      [data, 'qr.png', 'image/png'],
      [data, 'dish.JPG', 'image/jpeg'],
      [data, 'dish.jpeg', 'image/jpeg'],
    ]);
  });

  it('refuses to upload other file types', async () => {
    const { api, messenger } = setup();
    for (const filename of ['dish.gif', 'dish', 'png']) {
      await expect(messenger.uploadImage(Buffer.from('x'), filename)).rejects.toThrow(
        /\.png, \.jpg and \.jpeg/,
      );
    }
    expect(api.uploadImage).not.toHaveBeenCalled();
  });

  it('downloads files up to 15 MB', async () => {
    const { api, messenger } = setup();
    expect((await messenger.downloadFile('https://i.oneme.test/1')).toString()).toBe('file');
    expect(api.download).toHaveBeenCalledWith('https://i.oneme.test/1', 15 * 1024 * 1024);
  });
});

describe('escapeMarkdown', () => {
  it('escapes every markdown character of MAX and the backslash', () => {
    expect(escapeMarkdown('*_~+`[]()^#>\\')).toBe('\\*\\_\\~\\+\\`\\[\\]\\(\\)\\^\\#\\>\\\\');
  });

  it('keeps ordinary text as it is', () => {
    expect(escapeMarkdown('Кофейня «Зерно», ул. Баумана 5 - 350 ккал!')).toBe(
      'Кофейня «Зерно», ул. Баумана 5 - 350 ккал!',
    );
  });

  it('escapes names that would otherwise become formatting', () => {
    expect(escapeMarkdown('**Суп** дня [акция](https://evil.example)')).toBe(
      '\\*\\*Суп\\*\\* дня \\[акция\\]\\(https://evil.example\\)',
    );
  });
});
