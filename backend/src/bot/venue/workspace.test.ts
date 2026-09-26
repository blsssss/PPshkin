import { describe, expect, it } from 'vitest';
import { answers, labels, payloads, sent, texts, type Outgoing } from '../../../test/bot.ts';
import { OWNER_ID, venueChat, type VenueChat } from '../../../test/venue-bot.ts';
import { FLOW_TTL_MS } from '../state.ts';
import type { VenueCreateStep } from './flows.ts';

const CONNECT =
  'Подключите заведение: гости рядом увидят ваши блюда и горящие предложения в подборе, а брони придут сюда.';
const GUEST_LINK =
  'Ссылка для гостей: [https://max.ru/ppshkin\\_bot?start=v\\_7](https://max.ru/ppshkin_bot?start=v_7)';
const HOME_BUTTONS = [
  [
    { type: 'callback', text: 'Меню', payload: 'vn:menu' },
    { type: 'callback', text: 'Горящее', payload: 'vn:deals' },
  ],
  [
    { type: 'callback', text: 'Брони', payload: 'vn:bk' },
    { type: 'callback', text: 'Погасить код', payload: 'vn:redeem' },
  ],
  [{ type: 'callback', text: 'Статистика', payload: 'vn:stats:today' }],
];
const CANCEL = { type: 'callback', text: 'Отмена', payload: 'vn:new:cancel' };
const NAME_QUESTION = 'Как называется заведение? Так его увидят гости.';
const ADDRESS_QUESTION = 'Адрес для гостей, например: ул. Баумана, 36';
const CATEGORY_QUESTION = 'Что за заведение?';
const WIZARD_STALE = 'Мастер устарел, начните заново';

function homeText(lines: { place: string; counts?: string; demo?: boolean }): string {
  return [
    '**Кофейня «Зерно»**',
    lines.place,
    ...(lines.demo ? ['*Заведение и меню тестовые*'] : []),
    lines.counts ?? 'Активных броней: 0, горящих позиций: 0',
    GUEST_LINK,
  ].join('\n');
}

const WIZARD_INPUTS: readonly [VenueCreateStep, (chat: VenueChat) => Promise<Outgoing[]>][] = [
  ['name', (chat) => chat.press('vn:new')],
  ['address', (chat) => chat.send('Кофейня «Зерно»')],
  ['location', (chat) => chat.send('ул. Баумана, 36')],
  ['category', (chat) => chat.send('55.7887, 49.1221')],
  ['hours', (chat) => chat.press('vn:new:cat:bakery')],
  ['confirm', (chat) => chat.press('vn:new:hours:0800_2200')],
];

async function walkTo(chat: VenueChat, step: VenueCreateStep): Promise<Outgoing[]> {
  await chat.send('/venue');
  for (const [reached, advance] of WIZARD_INPUTS) {
    const replies = await advance(chat);
    if (reached === step) return replies;
  }
  throw new Error(`The wizard never shows the ${step} step`);
}

function putFlow(chat: VenueChat, step: VenueCreateStep, messageId = 'mid.wizard') {
  chat.states.put(OWNER_ID, {
    flow: {
      name: 'venue_create',
      step,
      draft: { name: 'Кофейня «Зерно»', address: 'ул. Баумана, 36' },
      messageId,
      expiresAt: '2026-09-26T09:30:00.000Z',
    },
    pendingStart: null,
  });
}

describe('/venue', () => {
  it('offers to connect a venue when the user has none', async () => {
    const chat = venueChat();

    const [reply] = sent(await chat.send('/venue'));

    expect(reply?.text).toBe(CONNECT);
    expect(reply?.buttons).toEqual([[{ type: 'callback', text: 'Создать заведение', payload: 'vn:new' }]]);
  });

  it('shows the workspace with counts, hours and the guest link', async () => {
    const chat = venueChat();
    chat.fake.seedVenue();
    const item = chat.fake.seedItem();
    chat.fake.seedDeal(item);
    chat.fake.seedBooking(item);

    const [reply] = sent(await chat.send('/venue'));

    expect(reply?.text).toBe(
      homeText({
        place: 'ул. Баумана, 36, 08:00-22:00, сейчас открыто',
        counts: 'Активных броней: 1, горящих позиций: 1',
      }),
    );
    expect(reply?.buttons).toEqual(HOME_BUTTONS);
  });

  it('marks demo venues, closed hours and opens the mini app when it is enabled', async () => {
    const chat = venueChat({ miniAppEnabled: true, now: '2026-09-26T20:30:00Z' });
    chat.fake.seedVenue({ isDemo: true });

    const [reply] = sent(await chat.send('/venue'));

    expect(reply?.text).toBe(homeText({ place: 'ул. Баумана, 36, 08:00-22:00, сейчас закрыто', demo: true }));
    expect(reply?.buttons).toEqual([...HOME_BUTTONS, [{ type: 'open_app', text: 'Открыть кабинет' }]]);
  });

  it('shows round the clock venues without the open state', async () => {
    const chat = venueChat();
    chat.fake.seedVenue({ opensAt: '00:00', closesAt: '00:00' });

    expect(texts(await chat.send('/venue'))[0]).toContain('ул. Баумана, 36, круглосуточно\n');
  });

  it('opens from the command button and returns home from any screen', async () => {
    const chat = venueChat();
    chat.fake.seedVenue();

    const opened = await chat.press('cmd:venue', null);
    expect(answers(opened)[0]?.notification).toBe('Открываю');
    expect(sent(opened)[0]?.buttons).toEqual(HOME_BUTTONS);

    const home = await chat.press('vn:home', 'mid.stats');
    expect(answers(home)[0]?.message?.text).toBe(
      homeText({ place: 'ул. Баумана, 36, 08:00-22:00, сейчас открыто' }),
    );
  });

  it('asks for the personal data consent first', async () => {
    const chat = venueChat();
    chat.world.consents.clear();

    expect(texts(await chat.send('/venue'))[0]).toContain(
      'нужно ваше согласие на обработку персональных данных',
    );
    expect(chat.fake.services.venues.get).not.toHaveBeenCalled();
  });
});

describe('venue creation wizard', () => {
  it('creates a venue step by step with the exact point of the venue', async () => {
    const chat = venueChat();
    await chat.send('/venue');

    const [name] = answers(await chat.press('vn:new'));
    expect(name?.message).toEqual({ text: NAME_QUESTION, buttons: [[CANCEL]], images: [] });
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ name: 'venue_create', step: 'name', draft: {} });

    const [address] = sent(await chat.send('  Кофейня   «Зерно» '));
    expect(address?.text).toBe(ADDRESS_QUESTION);

    const [point] = sent(await chat.send('ул. Баумана, 36'));
    expect(point?.text).toBe(
      'Отправьте точку заведения: нажмите кнопку, находясь в заведении, или пришлите координаты текстом, например: 55.7887, 49.1221. В Яндекс Картах координаты копируются нажатием на место.',
    );
    expect(point?.buttons).toEqual([[{ type: 'request_geo_location', text: 'Отправить точку' }], [CANCEL]]);

    const [category] = sent(await chat.location({ lat: 55.788712, lon: 49.122134 }));
    expect(category?.text).toBe(CATEGORY_QUESTION);
    expect(payloads(category)).toEqual([
      'vn:new:cat:coffee',
      'vn:new:cat:bakery',
      'vn:new:cat:cafe',
      'vn:new:cat:canteen',
      'vn:new:cat:restaurant',
      'vn:new:cancel',
    ]);
    expect(labels(category)).toEqual(['Кофейня', 'Пекарня', 'Кафе', 'Столовая', 'Ресторан', 'Отмена']);

    const [hours] = answers(await chat.press('vn:new:cat:coffee'));
    expect(hours?.message?.text).toBe('Часы работы?');
    expect(labels(hours?.message)).toEqual([
      '08:00-22:00',
      '09:00-21:00',
      '10:00-23:00',
      'Круглосуточно',
      'Другие',
      'Отмена',
    ]);

    const [confirm] = answers(await chat.press('vn:new:hours:0800_2200'));
    const summary = [
      '**Проверьте данные**',
      'Название: Кофейня «Зерно»',
      'Адрес: ул. Баумана, 36',
      'Точка: 55.788712, 49.122134',
      'Тип: Кофейня',
      'Часы работы: 08:00-22:00',
    ].join('\n');
    expect(confirm?.message?.text).toBe(summary);
    expect(confirm?.message?.buttons).toEqual([
      [
        { type: 'callback', text: 'Создать', payload: 'vn:new:ok' },
        { type: 'callback', text: 'Заново', payload: 'vn:new:restart' },
      ],
      [
        {
          type: 'link',
          text: 'Проверить на карте',
          url: 'https://yandex.ru/maps/?pt=49.122134,55.788712&z=17&l=map',
        },
      ],
      [CANCEL],
    ]);

    const created = await chat.press('vn:new:ok');
    expect(answers(created)[0]?.message).toEqual({ text: summary, buttons: [], images: [] });
    expect(sent(created)[0]).toMatchObject({
      text: 'Заведение создано. Следующий шаг: загрузите меню, это займёт минуту.',
      buttons: [
        [{ type: 'callback', text: 'Загрузить меню', payload: 'vn:menu:upload' }],
        [{ type: 'callback', text: 'Позже', payload: 'vn:home' }],
      ],
    });
    expect(chat.fake.services.venues.create).toHaveBeenCalledWith(OWNER_ID, {
      name: 'Кофейня «Зерно»',
      address: 'ул. Баумана, 36',
      location: { lat: 55.788712, lon: 49.122134 },
      category: 'coffee',
      opensAt: '08:00',
      closesAt: '22:00',
    });
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
    expect(chat.world.user.location).toBeNull();
  });

  it.each([
    ['an empty name', 'name', '   ', 'Название нужно текстом, от 1 до 120 символов.', NAME_QUESTION],
    ['a long name', 'name', 'я'.repeat(121), 'Название нужно текстом, от 1 до 120 символов.', NAME_QUESTION],
    [
      'a long address',
      'address',
      'д'.repeat(201),
      'Адрес нужен текстом, от 1 до 200 символов.',
      ADDRESS_QUESTION,
    ],
  ] as const)('explains %s and asks again', async (_case, step, input, error, question) => {
    const chat = venueChat();
    await walkTo(chat, step);

    const [reply] = sent(await chat.send(input));

    expect(reply?.text).toBe(`${error}\n\n${question}`);
    expect(payloads(reply)).toEqual(['vn:new:cancel']);
  });

  it.each(['абв', '95, 49.1221', '55.7887, 190', '55,7887 49,1221'])(
    'asks for the point again after %j',
    async (input) => {
      const chat = venueChat();
      await walkTo(chat, 'location');

      const [reply] = sent(await chat.send(input));

      expect(reply?.text).toMatch(
        /^Не понял координаты\. Нужны широта от -90 до 90 и долгота от -180 до 180/,
      );
      expect(reply?.text).toContain('\n\nОтправьте точку заведения');
      expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ step: 'location' });
    },
  );

  it('takes the point as text and keeps it exact', async () => {
    const chat = venueChat();
    await walkTo(chat, 'confirm');

    await chat.press('vn:new:ok');

    expect(chat.fake.services.venues.create).toHaveBeenCalledWith(
      OWNER_ID,
      expect.objectContaining({ location: { lat: 55.7887, lon: 49.1221 }, category: 'bakery' }),
    );
  });

  it('never stores the venue point in the profile of the owner', async () => {
    const chat = venueChat();
    await walkTo(chat, 'name');

    const [reply] = sent(await chat.location({ lat: 55.79, lon: 49.12 }));

    expect(reply?.text).toBe(`Название нужно текстом, от 1 до 120 символов.\n\n${NAME_QUESTION}`);
    expect(chat.world.user.location).toBeNull();
  });

  it.each([
    ['18:00-02:00', '18:00-02:00, закрытие после полуночи', { opensAt: '18:00', closesAt: '02:00' }],
    ['9-9', 'круглосуточно', { opensAt: '09:00', closesAt: '09:00' }],
    ['7:30-20:00', '07:30-20:00', { opensAt: '07:30', closesAt: '20:00' }],
  ])('takes custom opening hours %j', async (input, label, hours) => {
    const chat = venueChat();
    await walkTo(chat, 'hours');

    const [prompt] = answers(await chat.press('vn:new:hours:custom'));
    expect(prompt?.message?.text).toBe(
      'Напишите часы работы, например: 07:30-20:00. Если закрываетесь после полуночи, так и пишите: 18:00-02:00.',
    );
    const [invalid] = sent(await chat.send('с утра до вечера'));
    expect(invalid?.text).toMatch(
      /^Не понял часы работы\. Напишите так: 08:00-22:00\n\nНапишите часы работы/,
    );

    const [confirm] = sent(await chat.send(input));
    expect(confirm?.text).toContain(`Часы работы: ${label}`);
    await chat.press('vn:new:ok');
    expect(chat.fake.services.venues.create).toHaveBeenCalledWith(OWNER_ID, expect.objectContaining(hours));
  });

  it('keeps round the clock hours from the preset', async () => {
    const chat = venueChat();
    await walkTo(chat, 'hours');

    const [confirm] = answers(await chat.press('vn:new:hours:24h'));

    expect(confirm?.message?.text).toContain('Часы работы: круглосуточно');
    await chat.press('vn:new:ok');
    expect(chat.fake.services.venues.create).toHaveBeenCalledWith(
      OWNER_ID,
      expect.objectContaining({ opensAt: '00:00', closesAt: '00:00' }),
    );
  });

  it('asks to use the buttons when text comes at a button step', async () => {
    const chat = venueChat();
    await walkTo(chat, 'category');

    const [reply] = sent(await chat.send('Кофейня'));

    expect(reply?.text).toBe(`Выберите вариант кнопкой.\n\n${CATEGORY_QUESTION}`);
    expect(payloads(reply)).toContain('vn:new:cat:coffee');
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ step: 'category', messageId: reply?.messageId });
  });

  it('starts over from the summary', async () => {
    const chat = venueChat();
    await walkTo(chat, 'confirm');

    const [restart] = answers(await chat.press('vn:new:restart'));

    expect(restart?.message?.text).toBe(NAME_QUESTION);
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ step: 'name', draft: {} });
  });

  it.each<VenueCreateStep>(['name', 'address', 'location', 'category', 'hours', 'hours_input', 'confirm'])(
    'cancels at the %s step',
    async (step) => {
      const chat = venueChat();
      putFlow(chat, step);

      const [reply] = answers(await chat.press('vn:new:cancel', 'mid.wizard'));

      expect(reply?.message?.text).toBe('Хорошо, отменил. Подключить заведение можно в любой момент: /venue');
      expect(chat.states.peek(OWNER_ID).flow).toBeNull();
      expect(chat.fake.services.venues.create).not.toHaveBeenCalled();
    },
  );

  it('shows the workspace when the venue appeared meanwhile', async () => {
    const chat = venueChat();
    await walkTo(chat, 'confirm');
    chat.fake.seedVenue();

    const [reply] = sent(await chat.press('vn:new:ok'));

    expect(reply?.text).toBe(
      `У вас уже есть заведение\n\n${homeText({ place: 'ул. Баумана, 36, 08:00-22:00, сейчас открыто' })}`,
    );
    expect(reply?.buttons).toEqual(HOME_BUTTONS);
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
  });

  it('does not start the wizard for an owner who already has a venue', async () => {
    const chat = venueChat();
    chat.fake.seedVenue();

    const [reply] = answers(await chat.press('vn:new', 'mid.connect'));

    expect(reply?.message?.text).toMatch(/^У вас уже есть заведение\n\n\*\*Кофейня «Зерно»\*\*/);
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
  });

  it('answers a double tap on a step once', async () => {
    const chat = venueChat();
    const [category] = sent(await walkTo(chat, 'category'));
    await chat.press('vn:new:cat:coffee');

    const repeated = await chat.press('vn:new:cat:coffee', category?.messageId);

    expect(repeated).toEqual([
      {
        kind: 'answer',
        messageId: category?.messageId,
        notification: 'Эта кнопка уже нажата',
        message: null,
      },
    ]);
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ step: 'hours', draft: { category: 'coffee' } });
  });

  it('creates the venue once on a double tap', async () => {
    const chat = venueChat();
    const [confirm] = answers(await walkTo(chat, 'confirm'));
    await chat.press('vn:new:ok');

    const repeated = await chat.press('vn:new:ok', confirm?.messageId);

    expect(answers(repeated)[0]?.notification).toBe('Эта кнопка уже нажата');
    expect(chat.fake.services.venues.create).toHaveBeenCalledTimes(1);
  });

  it('replaces buttons of an expired wizard with a fresh start', async () => {
    const chat = venueChat();
    const [category] = sent(await walkTo(chat, 'category'));
    chat.world.clock.advance(FLOW_TTL_MS + 1);

    const [reply] = answers(await chat.press('vn:new:cat:coffee', category?.messageId));

    expect(reply?.message).toEqual({
      text: WIZARD_STALE,
      buttons: [[{ type: 'callback', text: 'Создать заведение', payload: 'vn:new' }]],
      images: [],
    });
    expect(chat.fake.services.venues.create).not.toHaveBeenCalled();
  });

  it('treats buttons of an older wizard as stale', async () => {
    const chat = venueChat();
    const [category] = sent(await walkTo(chat, 'category'));
    await chat.press('vn:new', 'mid.connect');

    const [reply] = answers(await chat.press('vn:new:cat:cafe', category?.messageId));

    expect(reply?.message?.text).toBe(WIZARD_STALE);
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ step: 'name', messageId: 'mid.connect' });
  });

  it('starts over when the stored draft misses a part at the summary', async () => {
    const chat = venueChat();
    putFlow(chat, 'confirm');

    const [reply] = answers(await chat.press('vn:new:ok', 'mid.wizard'));

    expect(reply?.message?.text).toBe(NAME_QUESTION);
    expect(chat.fake.services.venues.create).not.toHaveBeenCalled();
  });

  it('ignores unknown categories and presets', async () => {
    const chat = venueChat();
    await walkTo(chat, 'category');

    expect(answers(await chat.press('vn:new:cat:bar', null))[0]?.notification).toBe('Кнопка устарела');
    await chat.press('vn:new:cat:cafe');
    expect(answers(await chat.press('vn:new:hours:0700_2000', null))[0]?.notification).toBe(
      'Кнопка устарела',
    );
  });
});
