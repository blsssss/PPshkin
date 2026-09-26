import { describe, expect, it, vi } from 'vitest';
import { answers, botChat, GUEST_ID, labels, payloads, sent, texts } from '../../../test/bot.ts';
import {
  croissantOffer,
  eclairCard,
  eclairOffer,
  insightsOf,
  offersWorld,
  recommendationsResult,
  saladOffer,
  type OffersWorld,
} from '../../../test/offers.ts';
import { BAUMANA } from '../../../test/venues.ts';
import type { RecommendedOffer } from '../../services/recommendations.ts';
import { conflict } from '../../shared/errors.ts';
import { dislikeMessage, isLocationStale, renderOfferCard, toOfferCard } from './offers.ts';

const HOUR_MS = 3_600_000;

const ECLAIR_TEXT = [
  '**Можно позволить десерт**',
  'Эклер',
  'Кофейня «Зерно», ул. Баумана, 36',
  '130 ₽, около 330 ккал, 350 м от вас',
  '',
  'Почему:',
  '- Сегодня записано 2 приёма пищи, примерно 900 ккал',
  '- Вы часто выбираете: десерт, сладкое',
  '- До ориентира 2000 ккал остаётся около 1100 ккал',
  '- Скидка 35%: 130 ₽ вместо 200 ₽, до 14:00',
  '- Осталось 3 шт.',
  '*Калорийность приблизительная, это не медицинская рекомендация*',
].join('\n');

const ROUTE = { type: 'link', text: 'Маршрут', url: 'https://yandex.ru/maps/?pt=49.1221,55.7887&z=17&l=map' };

const ECLAIR_BUTTONS = [
  [{ type: 'callback', text: 'Забронировать', payload: 'bk:new:11:21:501' }],
  [
    { type: 'callback', text: 'Другое', payload: 'of:next:501' },
    { type: 'callback', text: 'Не сегодня', payload: 'of:nt:501' },
    { type: 'callback', text: 'Не люблю такое', payload: 'of:dl:501:dessert,sweet' },
  ],
  [ROUTE],
];

const NO_MORE = 'Больше вариантов рядом сейчас нет. Загляните позже.';
const PRESSED = 'Эта кнопка уже нажата';

interface ChatSetup {
  located?: 'fresh' | 'stale';
  offers?: RecommendedOffer[];
  miniAppEnabled?: boolean;
}

function offersChat(setup: ChatSetup = {}) {
  const world: OffersWorld = offersWorld({ offers: setup.offers });
  if (setup.located) {
    world.user.location = BAUMANA;
    const age = setup.located === 'fresh' ? HOUR_MS : 13 * HOUR_MS;
    world.user.locationUpdatedAt = new Date(world.clock.now().getTime() - age);
  }
  const chat = botChat({ world, miniAppEnabled: setup.miniAppEnabled ?? false });
  return { ...chat, world };
}

describe('offer cards', () => {
  it('keeps everything a card needs from a recommendation', () => {
    expect(toOfferCard(eclairOffer)).toEqual({
      ...eclairCard,
      reasons: [
        'Сегодня записано 2 приёма пищи, примерно 900 ккал',
        'Вы часто выбираете: десерт, сладкое',
        'До ориентира 2000 ккал остаётся около 1100 ккал',
        'Скидка 35%: 130 ₽ вместо 200 ₽, до 14:00',
        'Осталось 3 шт.',
      ],
    });
    expect(toOfferCard(croissantOffer)).toMatchObject({ offerId: 502, menuItemId: 12, dealId: null });
  });

  it('shows the dish, the place, the price and why it fits', () => {
    const card = renderOfferCard(toOfferCard(eclairOffer), {
      miniAppEnabled: false,
      botUsername: 'ppshkin_bot',
      locationStale: false,
    });
    expect(card.text).toBe(ECLAIR_TEXT);
    expect(card.buttons).toEqual([
      [{ kind: 'callback', text: 'Забронировать', payload: 'bk:new:11:21:501' }],
      [
        { kind: 'callback', text: 'Другое', payload: 'of:next:501' },
        { kind: 'callback', text: 'Не сегодня', payload: 'of:nt:501' },
        { kind: 'callback', text: 'Не люблю такое', payload: 'of:dl:501:dessert,sweet' },
      ],
      [{ kind: 'link', text: 'Маршрут', url: ROUTE.url }],
    ]);
  });

  it('links the deal or the venue in the mini app and asks where the guest is when the point is old', () => {
    const options = { miniAppEnabled: true, botUsername: 'ppshkin_bot', locationStale: true };
    const withDeal = renderOfferCard(eclairCard, options);
    const withoutDeal = renderOfferCard({ ...eclairCard, dealId: null, tags: [] }, options);

    expect(withDeal.buttons?.[2]?.[1]).toEqual({
      kind: 'link',
      text: 'Открыть в мини-приложении',
      url: 'https://max.ru/ppshkin_bot?startapp=deal_21',
    });
    expect(withDeal.buttons?.at(-1)).toEqual([{ kind: 'location', text: 'Я в другом месте' }]);
    expect(withoutDeal.buttons?.[0]).toEqual([
      { kind: 'callback', text: 'Забронировать', payload: 'bk:new:11:0:501' },
    ]);
    expect(withoutDeal.buttons?.[1]?.[2]).toEqual({
      kind: 'callback',
      text: 'Не люблю такое',
      payload: 'of:dl:501',
    });
    expect(withoutDeal.buttons?.[2]?.[1]).toMatchObject({
      url: 'https://max.ru/ppshkin_bot?startapp=venue_7',
    });
  });

  it('escapes names, addresses and reasons and omits an unknown distance', () => {
    const card = renderOfferCard(
      {
        ...eclairCard,
        itemName: 'Торт *Наполеон*',
        venueName: 'Кафе [Звезда]',
        venueAddress: 'ул. #1',
        distanceM: null,
        reasons: ['«Торт *Наполеон*» в «Кафе [Звезда]»: 400 ккал по данным заведения'],
        assumptions: ['Заведение и меню тестовые'],
      },
      { miniAppEnabled: false, botUsername: 'ppshkin_bot', locationStale: false },
    );
    expect(card.text).toBe(
      [
        '**Можно позволить десерт**',
        'Торт \\*Наполеон\\*',
        'Кафе \\[Звезда\\], ул. \\#1',
        '130 ₽, около 330 ккал',
        '',
        'Почему:',
        '- «Торт \\*Наполеон\\*» в «Кафе \\[Звезда\\]»: 400 ккал по данным заведения',
        '*Заведение и меню тестовые*',
      ].join('\n'),
    );
  });

  it('treats a saved point older than 12 hours as stale', () => {
    const now = new Date('2026-09-26T12:00:00Z');
    const at = (hours: number) => new Date(now.getTime() - hours * HOUR_MS);
    expect(isLocationStale({ location: null, locationUpdatedAt: null }, now)).toBe(false);
    expect(isLocationStale({ location: BAUMANA, locationUpdatedAt: at(12) }, now)).toBe(false);
    expect(isLocationStale({ location: BAUMANA, locationUpdatedAt: at(12.01) }, now)).toBe(true);
    expect(isLocationStale({ location: BAUMANA, locationUpdatedAt: null }, now)).toBe(true);
  });

  it('offers up to three tags that are not disliked yet', () => {
    const message = dislikeMessage(['dessert', 'sweet', 'dairy', 'cheese'], ['sweet']);
    expect(message.text).toBe(
      'Понял, это блюдо больше не предложу.\nНе предлагаю: сладкое. Сбросить можно в /profile.',
    );
    expect(message.buttons?.flat().map((button) => button.text)).toEqual([
      'Не предлагать: десерт',
      'Не предлагать: молочное',
      'Не предлагать: сыр',
    ]);
  });
});

describe('/eat', () => {
  it('asks where the guest is and continues with the shared point', async () => {
    const chat = offersChat();

    const [question] = sent(await chat.send('/eat'));
    expect(question?.text).toBe('Где вы? Отправьте местоположение, чтобы искать рядом.');
    expect(question?.buttons).toEqual([
      [{ type: 'request_geo_location', text: 'Отправить местоположение' }],
      [{ type: 'callback', text: 'Искать по всему городу', payload: 'of:any' }],
    ]);
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'eat_location' });
    expect(chat.world.recommend).not.toHaveBeenCalled();

    const [card] = sent(await chat.location({ lat: 55.788712, lon: 49.122134 }));
    expect(chat.world.user.location).toEqual({ lat: 55.79, lon: 49.12 });
    expect(chat.world.recommend).toHaveBeenCalledWith(GUEST_ID, { location: null, limit: 3, channel: 'bot' });
    expect(card?.text).toBe(ECLAIR_TEXT);
    expect(card?.buttons).toEqual(ECLAIR_BUTTONS);
    const state = chat.states.peek(GUEST_ID);
    expect(state.flow).toBeNull();
    expect(state.offerQueue).toEqual({
      messageId: card?.messageId,
      cards: [eclairOffer, croissantOffer, saladOffer].map(toOfferCard),
      expiresAt: '2026-09-26T09:30:00.000Z',
    });
  });

  it('searches the whole city in place of the question', async () => {
    const chat = offersChat();
    const [question] = sent(await chat.send('/eat'));

    const replies = await chat.press('of:any');

    const [answer] = answers(replies);
    expect(answer?.messageId).toBe(question?.messageId);
    expect(answer?.message?.text).toBe(ECLAIR_TEXT);
    expect(sent(replies)).toEqual([]);
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
    expect(chat.states.peek(GUEST_ID).offerQueue?.messageId).toBe(question?.messageId);

    const again = await chat.press('of:any', question?.messageId);
    expect(answers(again)[0]?.notification).toBe(PRESSED);
    expect(chat.world.recommend).toHaveBeenCalledTimes(1);
  });

  it('keeps the search near the shared point when the old question is answered later', async () => {
    const chat = offersChat();
    const [question] = sent(await chat.send('/eat'));
    const [card] = sent(await chat.location(BAUMANA));

    const late = await chat.press('of:any', question?.messageId);

    expect(late).toEqual([
      { kind: 'answer', messageId: question?.messageId, notification: 'Кнопка устарела', message: null },
    ]);
    expect(chat.world.recommend).toHaveBeenCalledTimes(1);
    expect(chat.states.peek(GUEST_ID).offerQueue?.messageId).toBe(card?.messageId);
    expect(answers(await chat.press('of:next:501', card?.messageId))[0]?.message?.text).toContain(
      'Круассан с миндалём',
    );
  });

  it('leaves the location question when the guest writes something else', async () => {
    const chat = offersChat();
    await chat.send('/eat');

    const replies = await chat.send('Сырники 350');

    expect(texts(replies)[0]).toContain('Записал: **Сырники**');
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
    expect(chat.world.recommend).not.toHaveBeenCalled();
  });

  it('shows the best card at once when the saved point is fresh', async () => {
    const chat = offersChat({ located: 'fresh', miniAppEnabled: true });

    const [card] = sent(await chat.send('/eat'));

    expect(card?.text).toBe(ECLAIR_TEXT);
    expect(labels(card)).not.toContain('Я в другом месте');
    expect(card?.buttons[2]).toEqual([
      ROUTE,
      { type: 'link', text: 'Открыть в мини-приложении', url: 'https://max.ru/ppshkin_bot?startapp=deal_21' },
    ]);
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
  });

  it('asks whether the guest moved when the saved point is older than 12 hours', async () => {
    const chat = offersChat({ located: 'stale' });

    const [card] = sent(await chat.send('/eat'));
    expect(card?.buttons.at(-1)).toEqual([{ type: 'request_geo_location', text: 'Я в другом месте' }]);
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'eat_location' });

    const moved = await chat.location({ lat: 55.8209, lon: 49.1607 });
    expect(chat.world.user.location).toEqual({ lat: 55.82, lon: 49.16 });
    expect(sent(moved)).toHaveLength(1);
    expect(labels(sent(moved)[0])).not.toContain('Я в другом месте');
    expect(chat.world.recommend).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['«Другое»', 'of:next:501'],
    ['«Не сегодня»', 'of:nt:501'],
  ])('continues the search from a point shared under a card shown by %s', async (_button, payload) => {
    const chat = offersChat({ located: 'stale' });
    const [first] = sent(await chat.send('/eat'));
    await chat.send('Сырники 350');
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();

    const replies = await chat.press(payload, first?.messageId);

    const card = sent(replies)[0] ?? answers(replies)[0]?.message;
    expect(card?.text).toContain('Круассан с миндалём');
    expect(labels(card)).toContain('Я в другом месте');
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'eat_location' });

    const moved = await chat.location({ lat: 55.8209, lon: 49.1607 });
    expect(chat.world.user.location).toEqual({ lat: 55.82, lon: 49.16 });
    expect(texts(moved)).toEqual([ECLAIR_TEXT]);
    expect(chat.world.recommend).toHaveBeenCalledTimes(2);
  });

  it('keeps a started input flow when the point is stale', async () => {
    const chat = offersChat({ located: 'stale' });
    chat.world.addMeal('Борщ', 300);
    await chat.press('ml:fix:1', 'mid.logged');

    await chat.send('/eat');

    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'meal_fix', mealId: 1 });
  });

  it.each([
    [3, 'Профиль вкусов ещё собирается: запишите ещё 3 приёма пищи, и подбор станет точнее'],
    [1, 'Профиль вкусов ещё собирается: запишите ещё 1 приём пищи, и подбор станет точнее'],
    [0, 'Профиль вкусов ещё собирается: записывайте еду ещё пару дней, и подбор станет точнее'],
  ])('tells how many meals are left while the profile is collected (%i)', async (left, note) => {
    const chat = offersChat({ located: 'fresh' });
    chat.world.insights.mockResolvedValue(insightsOf('collecting', left));

    const [card] = sent(await chat.send('/eat'));

    expect(card?.text).toBe(`${note}\n\n${ECLAIR_TEXT}`);
  });

  it('invites to log food when the diary is empty', async () => {
    const chat = offersChat({ located: 'fresh' });
    chat.world.recommend.mockResolvedValue(recommendationsResult('profile_empty'));
    chat.world.insights.mockResolvedValue(insightsOf('empty', 5));

    const [reply] = sent(await chat.send('/eat'));

    expect(reply?.text).toBe('Пока в дневнике нет записей. Пришлите фото еды, и я начну подбирать под вас.');
    expect(reply?.buttons).toEqual([[{ type: 'callback', text: 'Как записать еду', payload: 'cmd:help' }]]);
    expect(chat.states.peek(GUEST_ID).offerQueue).toBeNull();
  });

  it('stops offering new dishes when the guideline is almost reached', async () => {
    const chat = offersChat({ located: 'fresh' });
    chat.world.recommend.mockResolvedValue(recommendationsResult('budget_exhausted', [], 80));

    const [reply] = sent(await chat.send('/eat'));

    expect(reply?.text).toBe(
      'На сегодня ориентир почти набран: осталось около 80 ккал. Новые блюда сегодня не предлагаю. Ориентир можно изменить в /profile.',
    );
    expect(reply?.buttons).toEqual([[{ type: 'callback', text: 'Профиль', payload: 'cmd:profile' }]]);
  });

  it('explains that nothing fits nearby and waits for a new point', async () => {
    const chat = offersChat({ located: 'fresh' });
    chat.world.recommend.mockResolvedValue(recommendationsResult('nothing_fits', [], 250));

    const [reply] = sent(await chat.send('/eat'));

    expect(reply?.text).toBe(
      'Сейчас рядом нет подходящих блюд: заведения закрыты или блюда больше вашего остатка (около 250 ккал).',
    );
    expect(reply?.buttons).toEqual([
      [{ type: 'request_geo_location', text: 'Обновить местоположение' }],
      [{ type: 'callback', text: 'Профиль', payload: 'cmd:profile' }],
    ]);
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'eat_location' });

    chat.world.recommend.mockResolvedValue(recommendationsResult('ok', [croissantOffer]));
    const [card] = sent(await chat.location(BAUMANA));
    expect(card?.text).toContain('**Лёгкий перекус**');
  });

  it('does not say nearby for a search across the city', async () => {
    const chat = offersChat();
    chat.world.recommend.mockResolvedValue(recommendationsResult('nothing_fits', [], 250));
    await chat.send('/eat');

    const [answer] = answers(await chat.press('of:any'));

    expect(answer?.message?.text).toBe(
      'Сейчас нет подходящих блюд: заведения закрыты или блюда больше вашего остатка (около 250 ккал).',
    );
    expect(labels(answer?.message)[0]).toBe('Отправить местоположение');
  });

  it('opens from the «Что поесть?» button', async () => {
    const chat = offersChat({ located: 'fresh' });
    const replies = await chat.press('cmd:eat', 'mid.menu');
    expect(answers(replies)[0]?.notification).toBe('Открываю');
    expect(sent(replies)[0]?.text).toBe(ECLAIR_TEXT);
  });

  it('needs the personal data consent', async () => {
    const chat = offersChat({ located: 'fresh' });
    chat.world.consents.clear();
    expect(texts(await chat.send('/eat'))).toEqual([expect.stringContaining('Чтобы вести дневник')]);
    expect(chat.world.recommend).not.toHaveBeenCalled();
  });
});

describe('«Другое»', () => {
  it('walks the queue to its end in the same message', async () => {
    const chat = offersChat({ located: 'fresh' });
    const [first] = sent(await chat.send('/eat'));
    const messageId = first?.messageId ?? null;

    const second = answers(await chat.press('of:next:501', messageId))[0];
    expect(second?.messageId).toBe(messageId);
    expect(second?.message?.text).toContain('**Лёгкий перекус**\nКруассан с миндалём');
    expect(payloads(second?.message)).toContain('of:next:502');
    expect(chat.states.peek(GUEST_ID).offerQueue?.cards.map((card) => card.offerId)).toEqual([502, 503]);

    const third = answers(await chat.press('of:next:502', messageId))[0];
    expect(third?.message?.text).toContain(
      'Пекарня «Колос», ул. Пушкина, 5\n320 ₽, около 380 ккал, 1,2 км от вас',
    );
    expect(third?.message?.text).toContain('*Заведение и меню тестовые*');

    const end = answers(await chat.press('of:next:503', messageId))[0];
    expect(end).toEqual({ kind: 'answer', messageId, notification: NO_MORE, message: null });
    expect(chat.world.recommend).toHaveBeenCalledTimes(1);
  });

  it('does not skip a card on a double tap', async () => {
    const chat = offersChat({ located: 'fresh' });
    const [first] = sent(await chat.send('/eat'));
    const messageId = first?.messageId ?? null;

    await chat.press('of:next:501', messageId);
    const second = await chat.press('of:next:501', messageId);

    expect(answers(second)[0]?.notification).toBe(PRESSED);
    expect(chat.states.peek(GUEST_ID).offerQueue?.cards[0]?.offerId).toBe(502);
  });

  it('has nothing more after 30 minutes or on an older card', async () => {
    const chat = offersChat({ located: 'fresh' });
    const [first] = sent(await chat.send('/eat'));
    const [second] = sent(await chat.send('/eat'));

    expect(answers(await chat.press('of:next:501', first?.messageId))[0]?.notification).toBe(NO_MORE);

    chat.world.clock.advance(30 * 60_000);
    expect(answers(await chat.press('of:next:501', second?.messageId))[0]?.notification).toBe(NO_MORE);
  });
});

describe('«Не сегодня»', () => {
  it('declines the offer and shows the next card as a new message', async () => {
    const chat = offersChat({ located: 'fresh' });
    const [first] = sent(await chat.send('/eat'));

    const replies = await chat.press('of:nt:501');

    expect(chat.world.decline).toHaveBeenCalledWith(GUEST_ID, 501, 'not_today');
    expect(answers(replies)[0]).toEqual({
      kind: 'answer',
      messageId: first?.messageId,
      notification: null,
      message: { text: 'Хорошо, сегодня это не предложу.', buttons: [], images: [] },
    });
    const [next] = sent(replies);
    expect(next?.text).toContain('Круассан с миндалём');
    expect(chat.states.peek(GUEST_ID).offerQueue).toMatchObject({
      messageId: next?.messageId,
      cards: [{ offerId: 502 }, { offerId: 503 }],
    });

    const repeated = await chat.press('of:nt:501', first?.messageId);
    expect(answers(repeated)[0]?.notification).toBe(PRESSED);
    expect(chat.world.decline).toHaveBeenCalledTimes(1);
  });

  it('forgets the queue after the last card', async () => {
    const chat = offersChat({ located: 'fresh', offers: [eclairOffer] });
    await chat.send('/eat');

    const replies = await chat.press('of:nt:501');

    expect(texts(replies)).toEqual(['Хорошо, сегодня это не предложу.']);
    expect(chat.states.peek(GUEST_ID).offerQueue).toBeNull();
  });

  it('declines an older card without showing more', async () => {
    const chat = offersChat({ located: 'fresh' });
    const [first] = sent(await chat.send('/eat'));
    await chat.send('/eat');

    const replies = await chat.press('of:nt:501', first?.messageId);

    expect(texts(replies)).toEqual(['Хорошо, сегодня это не предложу.']);
    expect(chat.world.decline).toHaveBeenCalledWith(GUEST_ID, 501, 'not_today');
  });

  it('tells that a booked offer cannot be declined', async () => {
    const chat = offersChat({ located: 'fresh' });
    chat.world.decline.mockRejectedValue(conflict('offer_already_accepted', 'Booked'));
    await chat.send('/eat');

    const replies = await chat.press('of:nt:501');

    expect(replies).toEqual([
      expect.objectContaining({
        kind: 'answer',
        notification: 'По этому предложению уже есть бронь, код в /bookings.',
      }),
    ]);
  });

  it.each(['of:nt:abc', 'of:dl:0', 'of:jump'])('treats %s as a stale button', async (payload) => {
    const chat = offersChat();
    expect(answers(await chat.press(payload, 'mid.old'))[0]?.notification).toBe('Кнопка устарела');
    expect(chat.world.decline).not.toHaveBeenCalled();
  });
});

describe('«Не люблю такое»', () => {
  it('declines the dish and offers to hide its tags', async () => {
    const chat = offersChat({ located: 'fresh' });
    await chat.send('/eat');

    const replies = await chat.press('of:dl:501:dessert,sweet');

    expect(chat.world.decline).toHaveBeenCalledWith(GUEST_ID, 501, 'dislike');
    const [answer] = answers(replies);
    expect(answer?.message?.text).toBe('Понял, это блюдо больше не предложу.');
    expect(answer?.message?.buttons).toEqual([
      [{ type: 'callback', text: 'Не предлагать: десерт', payload: 'pf:tag:add:dessert:dessert,sweet' }],
      [{ type: 'callback', text: 'Не предлагать: сладкое', payload: 'pf:tag:add:sweet:dessert,sweet' }],
    ]);
    expect(sent(replies)[0]?.text).toContain('Круассан с миндалём');
  });

  it('hides a tag and keeps the other one on offer', async () => {
    const chat = offersChat({ located: 'fresh' });
    await chat.send('/eat');
    await chat.press('of:dl:501:dessert,sweet');

    const hidden = answers(await chat.press('pf:tag:add:sweet:dessert,sweet'))[0];

    expect(chat.world.user.dislikedTags).toEqual(['sweet']);
    expect(hidden?.message?.text).toBe(
      'Понял, это блюдо больше не предложу.\nНе предлагаю: сладкое. Сбросить можно в /profile.',
    );
    expect(payloads(hidden?.message)).toEqual(['pf:tag:add:dessert:dessert,sweet']);

    const both = answers(await chat.press('pf:tag:add:dessert:dessert,sweet'))[0];
    expect(chat.world.user.dislikedTags).toEqual(['sweet', 'dessert']);
    expect(both?.message?.text).toContain('Не предлагаю: десерт, сладкое.');
    expect(both?.message?.buttons).toEqual([]);
  });

  it('drops queued dishes with a hidden tag and keeps the card on screen', async () => {
    const chat = offersChat({ located: 'fresh', offers: [eclairOffer, saladOffer, croissantOffer] });
    await chat.send('/eat');
    const [salad] = sent(await chat.press('of:dl:501:dessert,sweet'));
    expect(salad?.text).toContain('Салат с курицей');

    await chat.press('pf:tag:add:sweet:dessert,sweet');

    expect(chat.states.peek(GUEST_ID).offerQueue).toMatchObject({
      messageId: salad?.messageId,
      cards: [{ offerId: 503 }],
    });
    const end = answers(await chat.press('of:next:503', salad?.messageId))[0];
    expect(end?.notification).toBe(NO_MORE);
  });

  it('keeps the card on screen even when it has the hidden tag', async () => {
    const chat = offersChat({ located: 'fresh' });
    await chat.send('/eat');
    const [croissant] = sent(await chat.press('of:dl:501:dessert,sweet'));

    await chat.press('pf:tag:add:sweet:dessert,sweet');

    expect(chat.states.peek(GUEST_ID).offerQueue?.cards.map((card) => card.offerId)).toEqual([502, 503]);
    const next = answers(await chat.press('of:next:502', croissant?.messageId))[0];
    expect(next?.message?.text).toContain('Салат с курицей');
  });

  it('does not update the profile for a tag that is already hidden', async () => {
    const chat = offersChat();
    chat.world.user.dislikedTags = ['sweet'];
    const update = vi.spyOn(chat.world.services.profile, 'update');

    const answer = answers(await chat.press('pf:tag:add:sweet', 'mid.tags'))[0];

    expect(update).not.toHaveBeenCalled();
    expect(answer?.message?.text).toContain('Не предлагаю: сладкое.');
  });

  it('keeps the list within 20 tags', async () => {
    const chat = offersChat();
    chat.world.user.dislikedTags = [
      'sweet',
      'dessert',
      'pastry',
      'chocolate',
      'fruit',
      'berries',
      'dairy',
      'cheese',
      'eggs',
      'meat',
      'poultry',
      'fish',
      'seafood',
      'vegetarian',
      'vegetables',
      'greens',
      'salad',
      'soup',
      'grain',
      'pasta',
    ];

    const answer = answers(await chat.press('pf:tag:add:rice', 'mid.tags'))[0];

    expect(answer?.notification).toBe('Список «Не предлагать» заполнен. Сбросить его можно в /profile.');
    expect(chat.world.user.dislikedTags).not.toContain('rice');
  });

  it('ignores unknown tags from a button', async () => {
    const chat = offersChat({ located: 'fresh' });
    const [card] = sent(await chat.send('/eat'));

    const answer = answers(await chat.press('of:dl:501:sweet,retired_tag,SWEET', card?.messageId))[0];
    expect(payloads(answer?.message)).toEqual(['pf:tag:add:sweet:sweet']);
    expect(answers(await chat.press('pf:tag:add:retired_tag', 'mid.tags'))[0]?.notification).toBe(
      'Кнопка устарела',
    );
  });
});

describe('contextual suggestion after a meal', () => {
  function readyChat(setup: ChatSetup = {}) {
    const chat = offersChat({ located: 'fresh', ...setup });
    chat.world.consent('personalized_offers');
    chat.world.recognizePhoto.mockImplementation(() => chat.world.logged({}));
    return chat;
  }

  it('shows one card right after the logged meal', async () => {
    const chat = readyChat();

    const replies = await chat.photo();

    const [placeholder, suggestion] = sent(replies);
    expect(placeholder?.text).toBe('Смотрю на фото, это до 15 секунд...');
    expect(replies.at(-2)).toMatchObject({
      kind: 'edit',
      text: expect.stringContaining('Записал:') as unknown,
    });
    expect(suggestion?.text).toBe(ECLAIR_TEXT);
    expect(suggestion?.buttons).toEqual([
      ...ECLAIR_BUTTONS,
      [{ type: 'callback', text: 'Не присылать подсказки', payload: 'cs:ad:off' }],
    ]);
    expect(chat.world.recommend).toHaveBeenCalledWith(GUEST_ID, {
      location: null,
      limit: 3,
      channel: 'bot',
      minScore: 0.5,
    });
    const state = chat.states.peek(GUEST_ID);
    expect(state.contextualOfferOn).toBe('2026-09-26');
    expect(state.offerQueue).toMatchObject({ messageId: suggestion?.messageId, cards: [{}, {}, {}] });
  });

  it('suggests across the city without a saved point', async () => {
    const chat = offersChat();
    chat.world.consent('personalized_offers');
    chat.world.recognizePhoto.mockImplementation(() => chat.world.logged({}));
    chat.world.recommend.mockResolvedValue(
      recommendationsResult('ok', [{ ...eclairOffer, distanceM: null }]),
    );

    const suggestion = sent(await chat.photo()).at(-1);

    expect(suggestion?.text).toContain('Кофейня «Зерно», ул. Баумана, 36\n130 ₽, около 330 ккал\n');
    expect(labels(suggestion)).not.toContain('Я в другом месте');
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
  });

  it('suggests at most once a local day', async () => {
    const chat = readyChat();
    await chat.photo();

    expect(sent(await chat.send('Сырники 350'))).toHaveLength(1);
    chat.world.clock.set('2026-09-26T20:59:00Z');
    expect(sent(await chat.photo())).toHaveLength(1);
    expect(chat.world.recommend).toHaveBeenCalledTimes(1);

    chat.world.clock.set('2026-09-26T21:00:00Z');
    const nextDay = sent(await chat.photo());
    expect(nextDay.at(-1)?.text).toBe(ECLAIR_TEXT);
    expect(chat.states.peek(GUEST_ID).contextualOfferOn).toBe('2026-09-27');
  });

  it('also follows a meal typed by hand and a picked candidate', async () => {
    const manual = readyChat();
    const typed = sent(await manual.send('Сырники 350'));
    expect(typed.map((message) => message.text)).toEqual([expect.stringContaining('Записал:'), ECLAIR_TEXT]);

    const picked = readyChat();
    picked.world.recognizePhoto.mockResolvedValue({
      status: 'uncertain',
      candidates: [
        {
          title: 'Плов',
          portionG: 300,
          kcalMin: 400,
          kcalMax: 550,
          proteinG: 12,
          fatG: 18,
          carbsG: 60,
          tags: ['rice'],
          confidence: 0.3,
        },
      ],
      basis: 'Похоже на плов',
    });
    await picked.photo();
    const pick = await picked.press('ml:pick:0');
    expect(answers(pick)[0]?.message?.text).toContain('Записал: **Плов**');
    expect(sent(pick)[0]?.text).toBe(ECLAIR_TEXT);
  });

  it('stays silent without the consent to personalized offers', async () => {
    const chat = readyChat();
    chat.world.consents.delete('personalized_offers');

    expect(sent(await chat.photo())).toHaveLength(1);
    expect(chat.world.insights).not.toHaveBeenCalled();
    expect(chat.world.recommend).not.toHaveBeenCalled();
  });

  it('stays silent while the profile is collected', async () => {
    const chat = readyChat();
    chat.world.insights.mockResolvedValue(insightsOf('collecting', 2));

    expect(sent(await chat.photo())).toHaveLength(1);
    expect(chat.world.recommend).not.toHaveBeenCalled();
    expect(chat.states.peek(GUEST_ID).contextualOfferOn).toBeNull();
  });

  it.each([
    ['no good match', recommendationsResult('ok', [recommendedScore(0.49)])],
    ['nothing fits', recommendationsResult('nothing_fits')],
    ['the day is full', recommendationsResult('budget_exhausted', [], 50)],
  ])('stays silent when there is %s', async (_case, result) => {
    const chat = readyChat();
    chat.world.recommend.mockResolvedValue(result);

    expect(sent(await chat.photo())).toHaveLength(1);
    expect(chat.states.peek(GUEST_ID).contextualOfferOn).toBeNull();
  });

  it('shows a match with exactly the minimum score', async () => {
    const chat = readyChat();
    chat.world.recommend.mockResolvedValue(recommendationsResult('ok', [recommendedScore(0.5)]));

    expect(sent(await chat.photo()).at(-1)?.text).toBe(ECLAIR_TEXT);
  });

  it('does not suggest after results other than a logged meal', async () => {
    const chat = readyChat();
    chat.world.recognizePhoto.mockResolvedValue({ status: 'not_food', basis: 'На фото чашка' });

    await chat.photo();

    expect(chat.world.insights).not.toHaveBeenCalled();
  });

  it('asks whether the guest moved when the point is stale', async () => {
    const chat = readyChat({ located: 'stale' });

    const suggestion = sent(await chat.photo()).at(-1);

    expect(labels(suggestion)).toEqual(
      expect.arrayContaining(['Я в другом месте', 'Не присылать подсказки']),
    );
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'eat_location' });
  });

  it('keeps the logged meal when the suggestion fails', async () => {
    const chat = readyChat();
    chat.world.recommend.mockRejectedValue(new Error('database is down'));

    const replies = await chat.photo();

    expect(texts(replies).join('\n')).not.toContain('Что-то пошло не так');
    expect(chat.world.meals).toHaveLength(1);
    expect(chat.logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) as unknown, userId: GUEST_ID },
      'contextual offer failed',
    );
  });

  it('turns hints off from the card', async () => {
    const chat = readyChat();
    await chat.photo();

    const off = await chat.press('cs:ad:off');

    expect(answers(off)[0]?.message?.text).toBe(
      'Готово, сам больше ничего не пришлю. Подбор по запросу работает: /eat',
    );
    expect(chat.world.consents.has('personalized_offers')).toBe(false);
    chat.world.clock.set('2026-09-27T09:00:00Z');
    expect(sent(await chat.photo())).toHaveLength(1);
  });

  it('leads to the next card from the suggestion', async () => {
    const chat = readyChat();
    const suggestion = sent(await chat.photo()).at(-1);

    const next = answers(await chat.press('of:next:501', suggestion?.messageId))[0];

    expect(next?.message?.text).toContain('Круассан с миндалём');
    expect(labels(next?.message)).not.toContain('Не присылать подсказки');
  });
});

function recommendedScore(score: number): RecommendedOffer {
  return { ...eclairOffer, score };
}
