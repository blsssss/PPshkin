import { describe, expect, it, vi } from 'vitest';
import { answers, CHAT_ID, payloads, sent, texts } from '../../../test/bot.ts';
import { OWNER_ID, parsedItem, venueChat, withBackground, type VenueChat } from '../../../test/venue-bot.ts';
import { DownloadTooLargeError, UserUnreachableError } from '../../integrations/max/errors.ts';
import type { Sleep } from '../../integrations/max/sleep.ts';
import { conflict } from '../../shared/errors.ts';

const UPLOAD_PROMPT =
  'Пришлите фото меню (одно, чётко и целиком) или вставьте текст меню: каждая позиция с новой строки, с ценой, например: Эклер 150 г 200 ₽';
const MENU_TEXT = 'Эклер 150 г 200 ₽\nКруассан 90 г\nМорс 250 мл';
const UPLOAD = { type: 'callback', text: 'Загрузить меню', payload: 'vn:menu:upload' };
const HOME = { type: 'callback', text: 'Главное меню', payload: 'vn:home' };
const RETRY = { type: 'callback', text: 'Попробовать ещё раз', payload: 'vn:menu:upload' };
const TEN_MEGABYTES = 10 * 1024 * 1024;
const FIRST_PHOTO_ONLY = 'Беру первое фото. Следующее пришлите после результата через «Загрузить меню».';
const TEXT_TOO_LONG =
  'Текст меню длиннее 8000 символов. Пришлите первую часть, а следующую после результата через «Загрузить меню».';

function ownerChat(options: Parameters<typeof venueChat>[0] = {}): VenueChat {
  const chat = venueChat(options);
  chat.fake.seedVenue();
  return chat;
}

async function uploading(options: Parameters<typeof venueChat>[0] = {}): Promise<VenueChat> {
  const chat = ownerChat(options);
  await chat.press('vn:menu:upload', 'mid.menu');
  return chat;
}

function recognizes(chat: VenueChat, afterMs = 5000) {
  chat.fake.state.recognition = {
    status: 'ready',
    items: [
      parsedItem(),
      parsedItem({ name: 'Круассан', category: 'bakery', priceRub: null, kcal: 260 }),
      parsedItem({ name: 'Морс', category: 'drink', priceRub: 0, kcal: 90 }),
    ],
    error: null,
    afterMs,
  };
}

describe('venue menu', () => {
  it('lists the menu by categories and marks hidden items', async () => {
    const chat = ownerChat();
    chat.fake.seedItem({ name: 'Эклер', category: 'dessert', priceRub: 200, kcal: 330 });
    chat.fake.seedItem({ name: 'Капучино', category: 'drink', priceRub: 180, kcal: 120 });
    chat.fake.seedItem({
      name: 'Чизкейк',
      category: 'dessert',
      priceRub: 290,
      kcal: 410,
      isAvailable: false,
    });
    chat.fake.seedItem({ name: 'Сырники', category: 'breakfast', priceRub: 250, kcal: 450 });

    const [reply] = answers(await chat.press('vn:menu', 'mid.home'));

    expect(reply?.message?.text).toBe(
      [
        '**Меню: 4 позиции**',
        '',
        '*Завтраки*',
        'Сырники, 250 ₽, 450 ккал',
        '',
        '*Десерты*',
        'Чизкейк, 290 ₽, 410 ккал (скрыто)',
        'Эклер, 200 ₽, 330 ккал',
        '',
        '*Напитки*',
        'Капучино, 180 ₽, 120 ккал',
      ].join('\n'),
    );
    expect(reply?.message?.buttons).toEqual([
      [UPLOAD, { type: 'callback', text: 'Горящее', payload: 'vn:deals' }],
      [HOME],
    ]);
  });

  it('shortens a long menu and links to the mini app', async () => {
    const chat = ownerChat({ miniAppEnabled: true });
    for (let index = 1; index <= 65; index += 1) {
      chat.fake.seedItem({ name: `Десерт *${String(index).padStart(2, '0')}*`, category: 'dessert' });
    }

    const [reply] = answers(await chat.press('vn:menu', 'mid.home'));

    expect(reply?.message?.text).toMatch(
      /^\*\*Меню: 65 позиций\*\*\n\n\*Десерты\*\nДесерт \\\*01\\\*, 200 ₽/,
    );
    expect(reply?.message?.text).toContain('Десерт \\*60\\*');
    expect(reply?.message?.text).not.toContain('Десерт \\*61\\*');
    expect(reply?.message?.text).toMatch(/\n\nи ещё 5, полный список в кабинете$/);
    expect(reply?.message?.buttons[1]).toEqual([{ type: 'open_app', text: 'Открыть кабинет' }]);
  });

  it('invites to upload an empty menu', async () => {
    const chat = ownerChat();

    const [reply] = answers(await chat.press('vn:menu', 'mid.home'));

    expect(reply?.message?.text).toBe('Меню пока пустое. Загрузите его фотографией или текстом.');
    expect(reply?.message?.buttons).toEqual([[UPLOAD], [HOME]]);
  });
});

describe('menu import', () => {
  it('imports a pasted menu, waits for the result and summarizes it', async () => {
    const chat = ownerChat();
    recognizes(chat);

    const [prompt] = answers(await chat.press('vn:menu:upload', 'mid.menu'));
    expect(prompt?.message?.text).toBe(UPLOAD_PROMPT);
    expect(payloads(prompt?.message)).toEqual(['vn:menu:cancel']);
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ name: 'menu_upload' });

    const [started, summary] = sent(await withBackground(chat, chat.send(MENU_TEXT)));
    expect(started?.text).toBe('Разбираю меню, это несколько секунд.');
    expect(chat.fake.services.menuImports.fromText).toHaveBeenCalledWith(OWNER_ID, MENU_TEXT);
    expect(chat.world.recognizeText).not.toHaveBeenCalled();
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();

    const [menuImport] = chat.fake.state.imports;
    expect(summary?.text).toBe(
      [
        'Распознал 3 позиции:',
        'Эклер, 200 ₽, около 330 ккал',
        'Круассан, цена не распознана, около 260 ккал',
        'Морс, цена не распознана, около 90 ккал',
        '',
        'Без цены: 2. Такие позиции не добавлю, цену можно указать в кабинете.',
        'Калорийность оценочная, её можно поправить в кабинете.',
      ].join('\n'),
    );
    expect(summary?.buttons).toEqual([
      [{ type: 'callback', text: 'Добавить всё', payload: `vn:imp:apply:${menuImport?.id}` }],
      [{ type: 'callback', text: 'Загрузить заново', payload: 'vn:menu:upload' }],
    ]);
    expect(chat.sleep).toHaveBeenCalledTimes(2);
    expect(chat.sleep).toHaveBeenCalledWith(3000);
    expect(chat.fake.services.menuImports.get).toHaveBeenCalledTimes(2);
  });

  it('adds only the items with a price and ignores a second tap', async () => {
    const chat = await uploading();
    recognizes(chat);
    const [, summary] = sent(await withBackground(chat, chat.send(MENU_TEXT)));
    const importId = chat.fake.state.imports[0]?.id ?? 0;

    const applied = await chat.press(`vn:imp:apply:${importId}`);

    expect(answers(applied)[0]?.message).toEqual({ text: summary?.text, buttons: [], images: [] });
    expect(sent(applied)[0]).toMatchObject({
      text: 'Добавлена 1 позиция. Без цены пропущено 2: Круассан, Морс. Их можно добавить в кабинете.',
      buttons: [
        [
          { type: 'callback', text: 'Меню', payload: 'vn:menu' },
          { type: 'callback', text: 'Выставить горящее', payload: 'vn:dl:new' },
        ],
        [UPLOAD],
      ],
    });
    expect(chat.fake.services.menuImports.apply).toHaveBeenCalledWith(OWNER_ID, importId, [parsedItem()]);
    expect(chat.fake.state.items.map((item) => item.name)).toEqual(['Эклер']);

    const repeated = await chat.press(`vn:imp:apply:${importId}`, summary?.messageId);
    expect(answers(repeated)[0]?.notification).toBe('Эта кнопка уже нажата');
    expect(chat.fake.services.menuImports.apply).toHaveBeenCalledTimes(1);
  });

  it('adds nothing when no item has a price', async () => {
    const chat = await uploading();
    chat.fake.state.recognition = {
      status: 'ready',
      items: [parsedItem({ priceRub: null }), parsedItem({ name: 'Морс', priceRub: null })],
      error: null,
      afterMs: 0,
    };
    await withBackground(chat, chat.send(MENU_TEXT));

    const applied = await chat.press(`vn:imp:apply:${chat.fake.state.imports[0]?.id}`);

    expect(sent(applied)[0]).toMatchObject({
      text: 'Ни у одной позиции нет цены. Пришлите меню с ценами или добавьте их в кабинете.',
      buttons: [[{ type: 'callback', text: 'Загрузить заново', payload: 'vn:menu:upload' }]],
    });
    expect(chat.fake.services.menuImports.apply).not.toHaveBeenCalled();
  });

  it('links the result to the mini app when it is enabled', async () => {
    const chat = await uploading({ miniAppEnabled: true });
    recognizes(chat, 0);

    const [, summary] = sent(await withBackground(chat, chat.send(MENU_TEXT)));

    expect(summary?.buttons[1]).toEqual([
      {
        type: 'link',
        text: 'Открыть в кабинете',
        url: `https://max.ru/ppshkin_bot?startapp=import_${chat.fake.state.imports[0]?.id}`,
      },
    ]);
  });

  it('recognizes the first photo of the menu instead of logging a meal', async () => {
    const chat = await uploading();

    const replies = await chat.photo(2);

    expect(texts(replies)).toEqual([
      `${FIRST_PHOTO_ONLY}\nРаспознаю меню, обычно это 15-30 секунд. Пришлю результат сюда.`,
    ]);
    expect(chat.api.sendAction).toHaveBeenCalledWith(CHAT_ID, 'typing_on');
    expect(chat.api.download).toHaveBeenCalledWith('https://files.max.example/photo-0.jpg', 15 * 1024 * 1024);
    expect(chat.fake.services.menuImports.fromPhoto).toHaveBeenCalledWith(
      OWNER_ID,
      Buffer.from('jpeg bytes'),
    );
    expect(chat.world.recognizePhoto).not.toHaveBeenCalled();
  });

  it('leads the owner to the next menu photo through a new upload', async () => {
    const chat = await uploading();
    recognizes(chat, 0);
    const [started] = sent(await withBackground(chat, chat.photo(2)));
    expect(started?.text).toContain(FIRST_PHOTO_ONLY);

    const [added] = sent(await chat.press(`vn:imp:apply:${chat.fake.state.imports[0]?.id}`));
    expect(added?.buttons.at(-1)).toEqual([UPLOAD]);
    await chat.press('vn:menu:upload', added?.messageId);
    await withBackground(chat, chat.photo());

    expect(chat.fake.services.menuImports.fromPhoto).toHaveBeenCalledTimes(2);
    expect(chat.world.recognizePhoto).not.toHaveBeenCalled();
  });

  it('leads the owner to the next part of a long menu through a new upload', async () => {
    const chat = await uploading();
    recognizes(chat, 0);
    expect(texts(await chat.send('Эклер 200 ₽\n'.repeat(700)))).toEqual([TEXT_TOO_LONG]);
    await withBackground(chat, chat.send(MENU_TEXT));

    const [added] = sent(await chat.press(`vn:imp:apply:${chat.fake.state.imports[0]?.id}`));
    await chat.press('vn:menu:upload', added?.messageId);
    await withBackground(chat, chat.send('Сырники 250 г 350 ₽'));

    expect(chat.fake.services.menuImports.fromText).toHaveBeenCalledTimes(2);
    expect(chat.fake.services.menuImports.fromText).toHaveBeenLastCalledWith(OWNER_ID, 'Сырники 250 г 350 ₽');
    expect(chat.world.recognizeText).not.toHaveBeenCalled();
  });

  it('still logs food photos without the upload flow', async () => {
    const chat = ownerChat();

    await chat.photo();

    expect(chat.world.recognizePhoto).toHaveBeenCalledTimes(1);
    expect(chat.fake.services.menuImports.fromPhoto).not.toHaveBeenCalled();
  });

  it.each([
    ['a photo over 10 MB', { download: vi.fn(() => Promise.resolve(Buffer.alloc(TEN_MEGABYTES + 1))) }],
    [
      'a photo over the download limit',
      { download: vi.fn(() => Promise.reject(new DownloadTooLargeError(1))) },
    ],
  ])('refuses %s and keeps waiting for the menu', async (_case, api) => {
    const chat = await uploading({ api });

    const [reply] = sent(await chat.photo());

    expect(reply?.text).toBe('Фото слишком большое, пришлите до 10 МБ');
    expect(payloads(reply)).toEqual(['vn:menu:cancel']);
    expect(chat.fake.services.menuImports.fromPhoto).not.toHaveBeenCalled();
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ name: 'menu_upload' });
  });

  it('accepts a photo of exactly 10 MB', async () => {
    const chat = await uploading({
      api: { download: vi.fn(() => Promise.resolve(Buffer.alloc(TEN_MEGABYTES))) },
    });

    await chat.photo();

    expect(chat.fake.services.menuImports.fromPhoto).toHaveBeenCalledTimes(1);
  });

  it('asks for the photo again when the download fails', async () => {
    const chat = await uploading({
      api: { download: vi.fn(() => Promise.reject(new Error('socket hang up'))) },
    });

    expect(texts(await chat.photo())).toEqual(['Не получилось загрузить фото. Пришлите его ещё раз.']);
    expect(chat.logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) as unknown, userId: OWNER_ID },
      'menu photo download failed',
    );
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ name: 'menu_upload' });
  });

  it.each([
    ['a text longer than 8000 characters', 'Эклер 200 ₽\n'.repeat(700), TEXT_TOO_LONG],
    [
      'a text without prices',
      'отмена',
      'Не вижу цен. Вставьте текст меню: каждая позиция с новой строки, с ценой, например: Эклер 150 г 200 ₽',
    ],
  ])('refuses %s', async (_case, text, reply) => {
    const chat = await uploading();

    expect(texts(await chat.send(text))).toEqual([reply]);
    expect(chat.fake.services.menuImports.fromText).not.toHaveBeenCalled();
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ name: 'menu_upload' });
  });

  it.each([
    ['import_in_progress', 'Предыдущее меню ещё распознаётся, подождите немного'],
    [
      'import_limit_reached',
      'Сегодня загружено 20 меню, это дневной лимит. Добавьте позиции в кабинете или попробуйте завтра',
    ],
  ])('explains %s', async (code, text) => {
    const chat = await uploading({ miniAppEnabled: true });
    vi.mocked(chat.fake.services.menuImports.fromText).mockRejectedValueOnce(conflict(code, 'Refused'));

    const [reply] = sent(await chat.send(MENU_TEXT));

    expect(reply?.text).toBe(text);
    expect(reply?.buttons).toEqual([[{ type: 'open_app', text: 'Открыть кабинет' }]]);
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
    expect(chat.background.pending).toBe(0);
  });

  it('shows the failure reason of the import', async () => {
    const chat = await uploading();
    chat.fake.state.recognition = {
      status: 'failed',
      items: [],
      error: 'Не нашли позиций в меню, попробуйте фото получше или вставьте текст',
      afterMs: 3000,
    };

    const [, reply] = sent(await withBackground(chat, chat.photo()));

    expect(reply?.text).toBe('Не нашли позиций в меню, попробуйте фото получше или вставьте текст');
    expect(reply?.buttons).toEqual([[RETRY]]);
  });

  it('gives up after three minutes of waiting', async () => {
    const chat = await uploading({ miniAppEnabled: true });
    recognizes(chat, 10 * 60_000);

    const [, reply] = sent(await withBackground(chat, chat.send(MENU_TEXT)));

    expect(reply?.text).toBe('Распознавание затянулось. Попробуйте ещё раз или откройте кабинет.');
    expect(reply?.buttons).toEqual([[RETRY], [{ type: 'open_app', text: 'Открыть кабинет' }]]);
    expect(chat.sleep).toHaveBeenCalledTimes(60);
    expect(chat.fake.services.menuImports.get).toHaveBeenCalledTimes(60);
  });

  it('keeps waiting after a failed status check', async () => {
    const chat = await uploading();
    recognizes(chat, 3000);
    vi.mocked(chat.fake.services.menuImports.get).mockRejectedValueOnce(new Error('database is down'));

    const [, reply] = sent(await withBackground(chat, chat.send(MENU_TEXT)));

    expect(reply?.text).toMatch(/^Распознал 3 позиции:/);
    expect(chat.logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) as unknown, userId: OWNER_ID, importId: chat.fake.state.imports[0]?.id },
      'menu import status check failed',
    );
  });

  it('stops waiting quietly when the bot shuts down', async () => {
    const sleep = vi.fn<Sleep>(() => Promise.reject(new Error('The bot stopped')));
    const chat = await uploading({ sleep });

    expect(texts(await withBackground(chat, chat.send(MENU_TEXT)))).toEqual([
      'Разбираю меню, это несколько секунд.',
    ]);
    expect(chat.fake.services.menuImports.get).not.toHaveBeenCalled();
    expect(chat.logger.error).not.toHaveBeenCalled();
  });

  it('logs an owner who blocked the bot before the result arrived', async () => {
    const chat = await uploading();
    recognizes(chat, 0);
    const send = vi.mocked(chat.api.sendMessage);
    const deliver = send.getMockImplementation()!;
    send.mockImplementation((to, body) =>
      body.text.startsWith('Распознал')
        ? Promise.reject(new UserUnreachableError('chat.denied', 'blocked'))
        : deliver(to, body),
    );

    expect(texts(await withBackground(chat, chat.send(MENU_TEXT)))).toEqual([
      'Разбираю меню, это несколько секунд.',
    ]);

    expect(chat.logger.warn).toHaveBeenCalledWith(
      { userId: OWNER_ID },
      'venue owner cannot be reached, the bot is probably blocked',
    );
    expect(chat.logger.error).not.toHaveBeenCalled();
  });

  it('cancels the upload', async () => {
    const chat = await uploading();

    const [reply] = answers(await chat.press('vn:menu:cancel', 'mid.menu'));

    expect(reply?.message?.text).toBe('Хорошо, меню не загружаю.');
    expect(payloads(reply?.message)).toEqual(['vn:menu']);
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
  });

  it('does not apply an import twice', async () => {
    const chat = await uploading();
    recognizes(chat, 0);
    await withBackground(chat, chat.send(MENU_TEXT));
    const importId = chat.fake.state.imports[0]?.id ?? 0;
    vi.mocked(chat.fake.services.menuImports.apply).mockRejectedValueOnce(
      conflict('import_already_applied', 'Applied'),
    );

    const [reply] = sent(await chat.press(`vn:imp:apply:${importId}`));
    expect(reply?.text).toBe('Это меню уже добавлено');
    expect(payloads(reply)).toEqual(['vn:menu']);

    const [menuImport] = chat.fake.state.imports;
    if (menuImport) menuImport.status = 'applied';
    const [again] = answers(await chat.press(`vn:imp:apply:${importId}`, 'mid.other'));
    expect(again?.message?.text).toBe('Это меню уже добавлено');
  });

  it('explains a missing import and ignores broken buttons', async () => {
    const chat = ownerChat();

    const [missing] = answers(await chat.press('vn:imp:apply:999', 'mid.old'));
    expect(missing?.message?.text).toBe('Это меню не найдено, загрузите его заново');
    expect(payloads(missing?.message)).toEqual(['vn:menu:upload']);

    expect(answers(await chat.press('vn:imp:apply:abc', 'mid.old'))[0]?.notification).toBe('Кнопка устарела');
  });

  it('does not apply an import that is still being recognized', async () => {
    const chat = await uploading({ sleep: vi.fn<Sleep>(() => Promise.reject(new Error('The bot stopped'))) });
    await withBackground(chat, chat.send(MENU_TEXT));

    const [reply] = answers(await chat.press(`vn:imp:apply:${chat.fake.state.imports[0]?.id}`, 'mid.old'));

    expect(reply?.message).toEqual({
      text: 'Меню ещё распознаётся, подождите немного',
      buttons: [],
      images: [],
    });
    expect(chat.fake.services.menuImports.apply).not.toHaveBeenCalled();
  });
});
