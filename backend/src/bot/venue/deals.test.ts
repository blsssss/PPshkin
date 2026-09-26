import { describe, expect, it, vi } from 'vitest';
import { answers, labels, payloads, sent } from '../../../test/bot.ts';
import { OWNER_ID, venueChat, type VenueChat } from '../../../test/venue-bot.ts';
import type { MenuItem } from '../../domain/models.ts';
import { unprocessable } from '../../shared/errors.ts';
import { FLOW_TTL_MS } from '../state.ts';
import type { DealDraft, DealWizardStep } from './flows.ts';

const CANCEL = { type: 'callback', text: 'Отмена', payload: 'vn:dl:cancel' };
const DEALS = { type: 'callback', text: 'Горящее', payload: 'vn:deals' };
const NEW_DEAL = { type: 'callback', text: 'Новое горящее предложение', payload: 'vn:dl:new' };
const HOME = { type: 'callback', text: 'Главное меню', payload: 'vn:home' };
const WIZARD = 'mid.wizard';

function ownerChat(options: Parameters<typeof venueChat>[0] = {}): VenueChat {
  const chat = venueChat(options);
  chat.fake.seedVenue();
  return chat;
}

function putWizard(chat: VenueChat, step: DealWizardStep, draft: DealDraft) {
  chat.states.put(OWNER_ID, {
    flow: {
      name: 'deal_wizard',
      step,
      page: 1,
      draft,
      messageId: WIZARD,
      expiresAt: new Date(chat.world.clock.now().getTime() + FLOW_TTL_MS).toISOString(),
    },
    pendingStart: null,
  });
}

function chosen(item: MenuItem, extra: DealDraft = {}): DealDraft {
  return { menuItemId: item.id, itemName: item.name, itemPriceRub: item.priceRub, ...extra };
}

function atConfirm(chat: VenueChat, item: MenuItem, endsAt = '2026-09-26T11:00:00.000Z') {
  putWizard(chat, 'confirm', chosen(item, { quantity: 5, priceRub: 120, endsAt }));
}

describe('hot deals list', () => {
  it('lists live deals with a stop button under each', async () => {
    const chat = ownerChat();
    const eclair = chat.fake.seedItem({ name: 'Эклер', priceRub: 200 });
    const coffee = chat.fake.seedItem({ name: 'Капучино', priceRub: 180, category: 'drink' });
    const tart = chat.fake.seedItem({ name: 'Тарт' });
    const eclairDeal = chat.fake.seedDeal(eclair, {
      priceRub: 120,
      endsAt: new Date('2026-09-26T18:00:00Z'),
    });
    const coffeeDeal = chat.fake.seedDeal(coffee, {
      priceRub: 90,
      quantityTotal: 10,
      quantityLeft: 10,
      endsAt: new Date('2026-09-26T17:00:00Z'),
    });
    chat.fake.seedDeal(tart, { quantityLeft: 0 });
    chat.fake.seedDeal(tart, { cancelledAt: new Date('2026-09-26T08:00:00Z') });
    chat.fake.seedDeal(tart, { endsAt: new Date('2026-09-26T08:00:00Z') });

    const [reply] = answers(await chat.press('vn:deals', 'mid.home'));

    expect(reply?.message?.text).toBe(
      [
        '**Горящие предложения**',
        'Капучино: 90 ₽ вместо 180 ₽ (-50%), осталось 10 из 10, до 20:00',
        'Эклер: 120 ₽ вместо 200 ₽ (-40%), осталось 3 из 5, до 21:00',
      ].join('\n'),
    );
    expect(reply?.message?.buttons).toEqual([
      [{ type: 'callback', text: 'Снять: Капучино', payload: `vn:dl:stop:${coffeeDeal.id}` }],
      [{ type: 'callback', text: 'Снять: Эклер', payload: `vn:dl:stop:${eclairDeal.id}` }],
      [NEW_DEAL],
      [HOME],
    ]);
  });

  it('suggests a first deal when nothing is on sale', async () => {
    const chat = ownerChat();

    const [reply] = answers(await chat.press('vn:deals', 'mid.home'));

    expect(reply?.message?.text).toBe(
      'Нет горящих позиций. Отметьте то, что осталось к вечеру, со скидкой: гости рядом увидят это в подборе.',
    );
    expect(reply?.message?.buttons).toEqual([[NEW_DEAL], [HOME]]);
  });

  it('shows at most ten stop buttons', async () => {
    const chat = ownerChat();
    for (let index = 0; index < 12; index += 1) {
      chat.fake.seedDeal(chat.fake.seedItem({ name: `Десерт ${index}` }));
    }

    const [reply] = answers(await chat.press('vn:deals', 'mid.home'));

    expect(labels(reply?.message).filter((label) => label.startsWith('Снять'))).toHaveLength(10);
    expect(reply?.message?.text.split('\n')).toHaveLength(13);
  });

  it('stops a deal after a confirmation', async () => {
    const chat = ownerChat();
    const deal = chat.fake.seedDeal(chat.fake.seedItem({ name: 'Эклер' }));
    await chat.press('vn:deals', 'mid.home');

    const [question] = answers(await chat.press(`vn:dl:stop:${deal.id}`));
    expect(question?.message).toEqual({
      text: 'Снять «Эклер» с продажи?',
      buttons: [
        [
          { type: 'callback', text: 'Да, снять', payload: `vn:dl:stop_ok:${deal.id}` },
          { type: 'callback', text: 'Нет', payload: 'vn:dl:keep' },
        ],
      ],
      images: [],
    });

    const [stopped] = answers(await chat.press(`vn:dl:stop_ok:${deal.id}`));
    expect(stopped?.message?.text).toBe('Снято с продажи. Уже оформленные брони действуют.');
    expect(stopped?.message?.buttons).toEqual([[DEALS]]);
    expect(chat.fake.services.deals.cancel).toHaveBeenCalledWith(OWNER_ID, deal.id);
    expect(chat.fake.state.deals[0]?.cancelledAt).not.toBeNull();
  });

  it('keeps the deal on "no" and shows the list again', async () => {
    const chat = ownerChat();
    const deal = chat.fake.seedDeal(chat.fake.seedItem({ name: 'Эклер' }));

    await chat.press(`vn:dl:stop:${deal.id}`, 'mid.list');
    const [reply] = answers(await chat.press('vn:dl:keep', 'mid.list'));

    expect(reply?.message?.text).toMatch(/^\*\*Горящие предложения\*\*\nЭклер:/);
    expect(chat.fake.services.deals.cancel).not.toHaveBeenCalled();
  });

  it('refreshes the list when the deal is already over', async () => {
    const chat = ownerChat();
    const deal = chat.fake.seedDeal(chat.fake.seedItem({ name: 'Эклер' }), { quantityLeft: 0 });

    const [reply] = answers(await chat.press(`vn:dl:stop:${deal.id}`, 'mid.list'));

    expect(reply?.message?.text).toBe(
      'Это предложение уже снято или закончилось.\n\nНет горящих позиций. Отметьте то, что осталось к вечеру, со скидкой: гости рядом увидят это в подборе.',
    );
  });

  it('explains a deal of another venue', async () => {
    const chat = ownerChat();

    const [reply] = answers(await chat.press('vn:dl:stop_ok:999', 'mid.list'));

    expect(reply?.message?.text).toBe('Позиция уже удалена, обновите список');
    expect(answers(await chat.press('vn:dl:stop:abc', 'mid.list'))[0]?.notification).toBe('Кнопка устарела');
  });
});

describe('hot deal wizard', () => {
  it('publishes a deal in a few taps', async () => {
    const chat = ownerChat();
    const items = Array.from({ length: 10 }, (_, index) =>
      chat.fake.seedItem({ name: `Десерт ${String(index + 1).padStart(2, '0')}` }),
    );
    const last = items[9]!;

    const [first] = answers(await chat.press('vn:dl:new', 'mid.deals'));
    expect(first?.message?.text).toBe('Что выставляем? Страница 1 из 2.');
    expect(first?.message?.buttons).toEqual([
      ...items
        .slice(0, 8)
        .map((item) => [{ type: 'callback', text: `${item.name}, 200 ₽`, payload: `vn:dl:item:${item.id}` }]),
      [{ type: 'callback', text: 'Ещё', payload: 'vn:dl:page:2' }],
      [CANCEL],
    ]);
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({
      name: 'deal_wizard',
      step: 'item',
      page: 1,
      draft: {},
      messageId: 'mid.deals',
    });

    const [second] = answers(await chat.press('vn:dl:page:2', 'mid.deals'));
    expect(second?.message?.text).toBe('Что выставляем? Страница 2 из 2.');
    expect(labels(second?.message)).toEqual(['Десерт 09, 200 ₽', 'Десерт 10, 200 ₽', 'Назад', 'Отмена']);
    expect(payloads(second?.message)).toContain('vn:dl:page:1');

    const [quantity] = answers(await chat.press(`vn:dl:item:${last.id}`, 'mid.deals'));
    expect(quantity?.message?.text).toBe('**Десерт 10**, 200 ₽\nСколько порций?');
    expect(quantity?.message?.buttons).toEqual([
      [1, 3, 5, 10].map((count) => ({
        type: 'callback',
        text: String(count),
        payload: `vn:dl:qty:${count}`,
      })),
      [{ type: 'callback', text: 'Другое', payload: 'vn:dl:qty:custom' }],
      [CANCEL],
    ]);

    const [discount] = answers(await chat.press('vn:dl:qty:5', 'mid.deals'));
    expect(discount?.message?.text).toBe('**Десерт 10**, 200 ₽, 5 шт.\nКакая скидка?');
    expect(discount?.message?.buttons).toEqual([
      [
        { type: 'callback', text: '-20%, 160 ₽', payload: 'vn:dl:disc:20' },
        { type: 'callback', text: '-30%, 140 ₽', payload: 'vn:dl:disc:30' },
      ],
      [
        { type: 'callback', text: '-40%, 120 ₽', payload: 'vn:dl:disc:40' },
        { type: 'callback', text: '-50%, 100 ₽', payload: 'vn:dl:disc:50' },
      ],
      [{ type: 'callback', text: 'Своя цена', payload: 'vn:dl:disc:custom' }],
      [CANCEL],
    ]);

    const [until] = answers(await chat.press('vn:dl:disc:40', 'mid.deals'));
    expect(until?.message?.text).toBe('Десерт 10: 120 ₽ вместо 200 ₽ (-40%), 5 шт.\nДо скольки продаём?');
    expect(until?.message?.buttons).toEqual([
      [
        { type: 'callback', text: '1 час', payload: 'vn:dl:until:60' },
        { type: 'callback', text: '2 часа', payload: 'vn:dl:until:120' },
      ],
      [{ type: 'callback', text: 'До закрытия, 22:00', payload: 'vn:dl:until:close' }],
      [CANCEL],
    ]);

    const [confirm] = answers(await chat.press('vn:dl:until:120', 'mid.deals'));
    expect(confirm?.message?.text).toBe(
      'Десерт 10: 120 ₽ вместо 200 ₽ (-40%), 5 шт., до 14:00. Опубликовать?',
    );
    expect(confirm?.message?.buttons).toEqual([
      [{ type: 'callback', text: 'Опубликовать', payload: 'vn:dl:ok' }, CANCEL],
    ]);

    const published = await chat.press('vn:dl:ok', 'mid.deals');
    const [deal] = chat.fake.state.deals;
    expect(answers(published)[0]?.message).toEqual({
      text: 'Десерт 10: 120 ₽ вместо 200 ₽ (-40%), 5 шт., до 14:00.',
      buttons: [],
      images: [],
    });
    expect(sent(published)[0]).toMatchObject({
      text: `Опубликовано. Гости рядом увидят предложение в подборе. Ссылка для гостей: [https://max.ru/ppshkin\\_bot?start=d\\_${deal?.id}](https://max.ru/ppshkin_bot?start=d_${deal?.id})`,
      buttons: [[DEALS, { type: 'callback', text: 'Ещё одно', payload: 'vn:dl:new' }]],
    });
    expect(chat.fake.services.deals.create).toHaveBeenCalledWith(OWNER_ID, {
      menuItemId: last.id,
      priceRub: 120,
      quantity: 5,
      endsAt: new Date('2026-09-26T11:00:00Z'),
    });
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
  });

  it('offers only available items without a live deal', async () => {
    const chat = ownerChat();
    const fresh = chat.fake.seedItem({ name: 'Эклер' });
    chat.fake.seedItem({ name: 'Скрытый торт', isAvailable: false });
    chat.fake.seedItem({ name: 'Пробник', priceRub: 1 });
    chat.fake.seedDeal(chat.fake.seedItem({ name: 'Круассан' }));

    const [reply] = answers(await chat.press('vn:dl:new', 'mid.deals'));

    expect(reply?.message?.text).toBe('Что выставляем?');
    expect(reply?.message?.buttons).toEqual([
      [{ type: 'callback', text: 'Эклер, 200 ₽', payload: `vn:dl:item:${fresh.id}` }],
      [CANCEL],
    ]);
  });

  it('asks to upload the menu when there is nothing to sell', async () => {
    const chat = ownerChat();
    chat.fake.seedItem({ isAvailable: false });

    const [reply] = answers(await chat.press('vn:dl:new', 'mid.deals'));

    expect(reply?.message?.text).toBe('В меню нет доступных позиций. Сначала загрузите меню.');
    expect(payloads(reply?.message)).toEqual(['vn:menu:upload']);
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
  });

  it('says when every item is already on sale', async () => {
    const chat = ownerChat();
    chat.fake.seedDeal(chat.fake.seedItem());

    const [reply] = answers(await chat.press('vn:dl:new', 'mid.deals'));

    expect(reply?.message?.text).toBe('На все доступные позиции уже есть горящие предложения.');
    expect(reply?.message?.buttons).toEqual([[DEALS]]);
  });

  it('refreshes the list when the picked item got a deal meanwhile', async () => {
    const chat = ownerChat();
    const eclair = chat.fake.seedItem({ name: 'Эклер' });
    const tart = chat.fake.seedItem({ name: 'Тарт' });
    await chat.press('vn:dl:new', 'mid.deals');
    chat.fake.seedDeal(eclair);

    const [reply] = answers(await chat.press(`vn:dl:item:${eclair.id}`, 'mid.deals'));

    expect(reply?.message?.text).toBe('Эта позиция уже недоступна, выберите другую.\n\nЧто выставляем?');
    expect(payloads(reply?.message)).toEqual([`vn:dl:item:${tart.id}`, 'vn:dl:cancel']);
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ step: 'item' });
  });

  it('takes a custom quantity and explains a wrong one', async () => {
    const chat = ownerChat();
    const item = chat.fake.seedItem();
    putWizard(chat, 'quantity', chosen(item));

    const [prompt] = answers(await chat.press('vn:dl:qty:custom', WIZARD));
    expect(prompt?.message?.text).toBe('Напишите, сколько порций продаём: от 1 до 100.');
    expect(prompt?.message?.buttons).toEqual([[CANCEL]]);

    for (const wrong of ['0', '101', 'семь', '2.5']) {
      const [reply] = sent(await chat.send(wrong));
      expect(reply?.text).toBe(
        'Нужно целое число от 1 до 100, например 7.\n\nНапишите, сколько порций продаём: от 1 до 100.',
      );
    }

    const [discount] = sent(await chat.send('7 шт'));
    expect(discount?.text).toBe('**Эклер**, 200 ₽, 7 шт.\nКакая скидка?');
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({
      step: 'discount',
      draft: { quantity: 7 },
      messageId: discount?.messageId,
    });
  });

  it('takes a typed quantity right at the buttons', async () => {
    const chat = ownerChat();
    putWizard(chat, 'quantity', chosen(chat.fake.seedItem()));

    const [discount] = sent(await chat.send('12'));

    expect(discount?.text).toBe('**Эклер**, 200 ₽, 12 шт.\nКакая скидка?');
  });

  it('takes a custom price below the regular one', async () => {
    const chat = ownerChat();
    putWizard(chat, 'discount', chosen(chat.fake.seedItem(), { quantity: 5 }));

    const [prompt] = answers(await chat.press('vn:dl:disc:custom', WIZARD));
    expect(prompt?.message?.text).toBe('Напишите цену со скидкой в рублях: целое число от 1 до 199.');

    for (const wrong of ['200', '0', 'дёшево']) {
      const [reply] = sent(await chat.send(wrong));
      expect(reply?.text).toBe(
        'Нужно целое число от 1 до 199: цена со скидкой ниже обычной.\n\nНапишите цену со скидкой в рублях: целое число от 1 до 199.',
      );
    }

    const [until] = sent(await chat.send('150 ₽'));
    expect(until?.text).toBe('Эклер: 150 ₽ вместо 200 ₽ (-25%), 5 шт.\nДо скольки продаём?');
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ step: 'until', draft: { priceRub: 150 } });
  });

  it('hides discounts that would not lower a small price', async () => {
    const chat = ownerChat();
    putWizard(chat, 'discount', chosen(chat.fake.seedItem({ priceRub: 2 }), { quantity: 1 }));

    const [reply] = sent(await chat.send('скидку побольше'));

    expect(reply?.text).toBe('Выберите вариант кнопкой.\n\n**Эклер**, 2 ₽, 1 шт.\nКакая скидка?');
    expect(payloads(reply)).toEqual([
      'vn:dl:disc:30',
      'vn:dl:disc:40',
      'vn:dl:disc:50',
      'vn:dl:disc:custom',
      'vn:dl:cancel',
    ]);
    expect(answers(await chat.press('vn:dl:disc:20', reply?.messageId))[0]?.notification).toBe(
      'Кнопка устарела',
    );
  });

  it.each([
    ['closes at night', '2026-09-26T09:00:00Z', {}, 'До закрытия, 22:00', '2026-09-26T19:00:00.000Z'],
    [
      'works after midnight',
      '2026-09-26T20:00:00Z',
      { opensAt: '18:00', closesAt: '02:00' },
      'До закрытия, 02:00',
      '2026-09-26T23:00:00.000Z',
    ],
  ])('sells until closing when the venue %s', async (_case, now, hours, label, endsAt) => {
    const chat = venueChat({ now });
    chat.fake.seedVenue(hours);
    putWizard(chat, 'until', chosen(chat.fake.seedItem(), { quantity: 5, priceRub: 120 }));

    const [reply] = sent(await chat.send('до закрытия'));
    expect(labels(reply)).toContain(label);

    await chat.press('vn:dl:until:close', reply?.messageId);
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ step: 'confirm', draft: { endsAt } });
  });

  it.each([
    ['is open round the clock', '2026-09-26T09:00:00Z', { opensAt: '00:00', closesAt: '00:00' }],
    ['closes in ten minutes', '2026-09-26T18:50:00Z', {}],
  ])('does not offer closing time when the venue %s', async (_case, now, hours) => {
    const chat = venueChat({ now });
    chat.fake.seedVenue(hours);
    putWizard(chat, 'until', chosen(chat.fake.seedItem(), { quantity: 5, priceRub: 120 }));

    const [reply] = sent(await chat.send('до закрытия'));

    expect(payloads(reply)).toEqual(['vn:dl:until:60', 'vn:dl:until:120', 'vn:dl:cancel']);
    expect(answers(await chat.press('vn:dl:until:close', reply?.messageId))[0]?.notification).toBe(
      'Кнопка устарела',
    );
  });

  it('warns that guests cannot book while the venue is closed', async () => {
    const chat = venueChat({ now: '2026-09-26T04:00:00Z' });
    chat.fake.seedVenue();
    putWizard(chat, 'discount', chosen(chat.fake.seedItem(), { quantity: 3 }));

    const [reply] = answers(await chat.press('vn:dl:disc:50', WIZARD));

    expect(reply?.message?.text).toBe(
      [
        'Заведение сейчас закрыто по часам работы: гости не смогут забронировать до открытия.',
        '',
        'Эклер: 100 ₽ вместо 200 ₽ (-50%), 3 шт.',
        'До скольки продаём?',
      ].join('\n'),
    );
    expect(labels(reply?.message)).toContain('До закрытия, 22:00');
  });

  it('explains an existing deal on the item', async () => {
    const chat = ownerChat();
    const item = chat.fake.seedItem();
    atConfirm(chat, item);
    chat.fake.seedDeal(item);

    const [reply] = sent(await chat.press('vn:dl:ok', WIZARD));

    expect(reply?.text).toBe('На эту позицию уже есть горящее предложение');
    expect(reply?.buttons).toEqual([[DEALS], [NEW_DEAL]]);
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
  });

  it('asks for the discount again when the menu price went down', async () => {
    const chat = ownerChat();
    const item = chat.fake.seedItem();
    atConfirm(chat, item);
    item.priceRub = 100;

    const [reply] = sent(await chat.press('vn:dl:ok', WIZARD));

    expect(reply?.text).toBe(
      'Цена со скидкой должна быть ниже обычной\n\n**Эклер**, 100 ₽, 5 шт.\nКакая скидка?',
    );
    expect(labels(reply)).toContain('-40%, 60 ₽');
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({
      step: 'discount',
      draft: { itemPriceRub: 100, quantity: 5 },
      messageId: reply?.messageId,
    });
    expect(chat.states.peek(OWNER_ID).flow).not.toMatchObject({ draft: { priceRub: 120 } });
  });

  it('asks for the end time again when the window is invalid', async () => {
    const chat = ownerChat();
    atConfirm(chat, chat.fake.seedItem());
    vi.mocked(chat.fake.services.deals.create).mockRejectedValueOnce(
      unprocessable('deal_window_invalid', 'Bad window'),
    );

    const [reply] = sent(await chat.press('vn:dl:ok', WIZARD));

    expect(reply?.text).toBe(
      'Время окончания должно быть в ближайшие 24 часа\n\nЭклер: 120 ₽ вместо 200 ₽ (-40%), 5 шт.\nДо скольки продаём?',
    );
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ step: 'until' });
    expect(chat.states.peek(OWNER_ID).flow).not.toMatchObject({
      draft: { endsAt: expect.any(String) as unknown },
    });
  });

  it.each([
    [
      'a hidden item',
      (item: MenuItem) => {
        item.isAvailable = false;
      },
      'Позиция скрыта от гостей, включите её в кабинете',
    ],
    [
      'a deleted item',
      (item: MenuItem) => {
        item.venueId = 999;
      },
      'Позиция уже удалена, обновите список',
    ],
  ])('explains %s on publishing', async (_case, change, text) => {
    const chat = ownerChat();
    const item = chat.fake.seedItem();
    atConfirm(chat, item);
    change(item);

    const [reply] = sent(await chat.press('vn:dl:ok', WIZARD));

    expect(reply?.text).toBe(text);
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
  });

  it('publishes once on a double tap', async () => {
    const chat = ownerChat();
    atConfirm(chat, chat.fake.seedItem());
    await chat.press('vn:dl:ok', WIZARD);

    const repeated = await chat.press('vn:dl:ok', WIZARD);

    expect(answers(repeated)[0]?.notification).toBe('Эта кнопка уже нажата');
    expect(chat.fake.services.deals.create).toHaveBeenCalledTimes(1);
  });

  it('answers a double tap on a step once', async () => {
    const chat = ownerChat();
    const item = chat.fake.seedItem();
    await chat.press('vn:dl:new', 'mid.deals');
    await chat.press(`vn:dl:item:${item.id}`, 'mid.deals');

    const repeated = await chat.press(`vn:dl:item:${item.id}`, 'mid.deals');

    expect(answers(repeated)[0]).toMatchObject({ notification: 'Эта кнопка уже нажата', message: null });
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ step: 'quantity' });
  });

  it('replaces buttons of an expired wizard with a fresh start', async () => {
    const chat = ownerChat();
    const item = chat.fake.seedItem();
    await chat.press('vn:dl:new', 'mid.deals');
    await chat.press(`vn:dl:item:${item.id}`, 'mid.deals');
    chat.world.clock.advance(FLOW_TTL_MS + 1);

    const [reply] = answers(await chat.press('vn:dl:qty:5', 'mid.deals'));

    expect(reply?.message).toEqual({
      text: 'Мастер устарел, начните заново',
      buttons: [[NEW_DEAL]],
      images: [],
    });
    expect(chat.fake.services.deals.create).not.toHaveBeenCalled();
  });

  it('asks to use the buttons when text comes at the item step', async () => {
    const chat = ownerChat();
    chat.fake.seedItem();
    await chat.press('vn:dl:new', 'mid.deals');

    const [reply] = sent(await chat.send('Эклер'));

    expect(reply?.text).toBe('Выберите вариант кнопкой.\n\nЧто выставляем?');
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ step: 'item', messageId: reply?.messageId });
  });

  it.each<DealWizardStep>([
    'item',
    'quantity',
    'quantity_input',
    'discount',
    'price_input',
    'until',
    'confirm',
  ])('cancels at the %s step', async (step) => {
    const chat = ownerChat();
    putWizard(chat, step, chosen(chat.fake.seedItem(), { quantity: 5 }));

    const [reply] = answers(await chat.press('vn:dl:cancel', WIZARD));

    expect(reply?.message?.text).toBe('Хорошо, ничего не публикую.');
    expect(reply?.message?.buttons).toEqual([[DEALS]]);
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
  });

  it('starts over when the stored draft is incomplete', async () => {
    const chat = ownerChat();
    const item = chat.fake.seedItem();
    putWizard(chat, 'until', { menuItemId: item.id });

    const [reply] = sent(await chat.send('скорее'));

    expect(reply?.text).toBe('Выберите вариант кнопкой.\n\nЧто выставляем?');
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ step: 'item', draft: {} });
  });

  it('closes the wizard when the menu got empty meanwhile', async () => {
    const chat = ownerChat();
    putWizard(chat, 'item', {});

    const [reply] = sent(await chat.send('Эклер'));

    expect(reply?.text).toBe(
      'Выберите вариант кнопкой.\n\nВ меню нет доступных позиций. Сначала загрузите меню.',
    );
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
  });

  it('starts over when the stored draft misses a part at the summary', async () => {
    const chat = ownerChat();
    const item = chat.fake.seedItem();
    putWizard(chat, 'confirm', chosen(item, { quantity: 5, priceRub: 120 }));

    const [reply] = answers(await chat.press('vn:dl:ok', WIZARD));

    expect(reply?.message?.text).toBe('Что выставляем?');
    expect(chat.fake.services.deals.create).not.toHaveBeenCalled();
  });

  it.each(['vn:dl:page:x', 'vn:dl:item:x', 'vn:dl:stop_ok:x'])(
    'treats %s as a stale button',
    async (payload) => {
      const chat = ownerChat();
      chat.fake.seedItem();
      await chat.press('vn:dl:new', WIZARD);

      expect(answers(await chat.press(payload, WIZARD))[0]?.notification).toBe('Кнопка устарела');
      expect(chat.fake.services.deals.cancel).not.toHaveBeenCalled();
    },
  );

  it('ignores unknown choices', async () => {
    const chat = ownerChat();
    putWizard(chat, 'quantity', chosen(chat.fake.seedItem()));

    expect(answers(await chat.press('vn:dl:qty:7', WIZARD))[0]?.notification).toBe('Кнопка устарела');
    expect(answers(await chat.press('vn:dl:unknown', WIZARD))[0]?.notification).toBe('Кнопка устарела');
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ step: 'quantity' });
  });
});
