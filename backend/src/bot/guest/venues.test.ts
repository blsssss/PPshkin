import { describe, expect, it, vi } from 'vitest';
import { botChat, GUEST_ID, labels, payloads, sent, texts, type BotChat } from '../../../test/bot.ts';
import { sampleDeal, sampleMenuItem, sampleVenue } from '../../../test/venues.ts';
import type { DealCardView, VenueDetailsView } from '../../services/catalog.ts';
import { notFound } from '../../shared/errors.ts';

const DEAL_NOW = '2026-09-25T10:00:00Z';

function consentedChat(miniAppEnabled = false): BotChat {
  const chat = botChat({ miniAppEnabled });
  chat.world.consent('personal_data');
  chat.world.clock.set(DEAL_NOW);
  return chat;
}

const details: VenueDetailsView = {
  venue: sampleVenue,
  openNow: true,
  menu: [sampleMenuItem],
  deals: [{ deal: sampleDeal, item: sampleMenuItem, status: 'active' }],
};

const card: DealCardView = {
  deal: { deal: sampleDeal, item: sampleMenuItem, status: 'active' },
  venue: sampleVenue,
  distanceM: 342,
};

const ROUTE = { type: 'link', text: 'Маршрут', url: 'https://yandex.ru/maps/?pt=49.1221,55.7887&z=17&l=map' };

describe('start links', () => {
  it('opens a venue card with its hot deals', async () => {
    const chat = consentedChat();
    const venue = vi.fn(() => Promise.resolve(details));
    chat.world.services.catalog.venue = venue;

    const [reply] = sent(await chat.start('v_7'));

    expect(venue).toHaveBeenCalledWith(GUEST_ID, 7);
    expect(reply?.text).toBe(
      [
        '**Кофейня «Зерно»**',
        'Кофейня, ул. Баумана, 36',
        'Сейчас открыто до 22:00',
        '',
        '**Горящие предложения**',
        'Эклер: 130 ₽ вместо 200 ₽, около 330 ккал, до 14:00, осталось 3 шт.',
      ].join('\n'),
    );
    expect(reply?.buttons).toEqual([
      [{ type: 'callback', text: 'Забронировать: Эклер, 130 ₽', payload: 'bk:new:11:21:0' }],
      [ROUTE],
    ]);
  });

  it('offers to book only running deals of an open venue', async () => {
    const chat = consentedChat();
    const view = (id: number, status: 'active' | 'scheduled' | 'sold_out', name: string) => ({
      deal: { ...sampleDeal, id },
      item: { ...sampleMenuItem, id: id + 100, name },
      status,
    });
    const deals = [
      view(31, 'active', 'Очень длинное название десерта дня от шефа с ягодами'),
      view(32, 'scheduled', 'Пирог'),
      view(33, 'sold_out', 'Кекс'),
    ];
    chat.world.services.catalog.venue = () => Promise.resolve({ ...details, deals });

    const [open] = sent(await chat.start('v_7'));
    expect(payloads(open)).toEqual(['bk:new:131:31:0']);
    expect(labels(open)[0]).toBe('Забронировать: Очень длинное название десерта дня от ш…, 130 ₽');

    chat.world.services.catalog.venue = () => Promise.resolve({ ...details, openNow: false, deals });
    const [closed] = sent(await chat.start('v_7'));
    expect(payloads(closed)).toEqual([]);
  });

  it('marks demo venues, lists at most five deals and links to the mini app', async () => {
    const chat = consentedChat(true);
    const deals = Array.from({ length: 7 }, (_, index) => ({
      deal: { ...sampleDeal, id: 30 + index },
      item: { ...sampleMenuItem, name: `Десерт ${index + 1}` },
      status: 'active' as const,
    }));
    chat.world.services.catalog.venue = () =>
      Promise.resolve({ ...details, venue: { ...sampleVenue, isDemo: true }, openNow: false, deals });

    const [reply] = sent(await chat.send('/start v_7'));

    expect(reply?.text).toContain('Сейчас закрыто, откроется в 08:00\n*Заведение и меню тестовые*');
    expect(reply?.text).toContain('Десерт 5:');
    expect(reply?.text).not.toContain('Десерт 6:');
    expect(reply?.text).toContain('и ещё 2 предложения');
    expect(reply?.buttons).toEqual([
      [
        ROUTE,
        { type: 'link', text: 'Меню и все предложения', url: 'https://max.ru/ppshkin_bot?startapp=venue_7' },
      ],
    ]);
  });

  it('says when a venue has no deals right now', async () => {
    const chat = consentedChat();
    chat.world.services.catalog.venue = () =>
      Promise.resolve({
        ...details,
        venue: { ...sampleVenue, opensAt: '00:00:00', closesAt: '00:00:00' },
        deals: [],
      });

    const [reply] = sent(await chat.start('v_7'));

    expect(reply?.text).toContain('Открыто круглосуточно');
    expect(reply?.text).toContain('Сейчас горящих предложений нет.');
  });

  it('opens a deal card with the distance', async () => {
    const chat = consentedChat(true);
    const deal = vi.fn(() => Promise.resolve(card));
    chat.world.services.catalog.deal = deal;

    const [reply] = sent(await chat.start('d_21'));

    expect(deal).toHaveBeenCalledWith(GUEST_ID, 21);
    expect(reply?.text).toBe(
      [
        '**Эклер**',
        '130 ₽ вместо 200 ₽, около 330 ккал',
        'До 14:00, осталось 3 шт.',
        'Кофейня «Зерно», ул. Баумана, 36, 350 м от вас',
      ].join('\n'),
    );
    expect(reply?.buttons).toEqual([
      [{ type: 'callback', text: 'Забронировать', payload: 'bk:new:11:21:0' }],
      [
        ROUTE,
        {
          type: 'link',
          text: 'Открыть в мини-приложении',
          url: 'https://max.ru/ppshkin_bot?startapp=deal_21',
        },
      ],
    ]);
  });

  it('does not offer to book a deal that has not started yet', async () => {
    const chat = consentedChat();
    chat.world.services.catalog.deal = () =>
      Promise.resolve({ ...card, deal: { ...card.deal, status: 'scheduled' } });

    const [reply] = sent(await chat.start('d_21'));

    expect(payloads(reply)).toEqual([]);
    expect(reply?.buttons).toEqual([[ROUTE]]);
  });

  it('warns that the venue of a deal is closed and escapes venue names', async () => {
    const chat = consentedChat();
    chat.world.clock.set('2026-09-25T20:30:00Z');
    chat.world.services.catalog.deal = () =>
      Promise.resolve({
        ...card,
        venue: { ...sampleVenue, name: 'Кафе *Звезда*', isDemo: true },
        distanceM: null,
      });

    const [reply] = sent(await chat.start('d_21'));

    expect(reply?.text).toContain('Кафе \\*Звезда\\*, ул. Баумана, 36\nСейчас закрыто, откроется в 08:00');
    expect(reply?.text).not.toContain('от вас');
    expect(reply?.text).toContain('*Заведение и меню тестовые*');
  });

  it.each([
    ['v_404', { venue: () => Promise.reject(notFound('venue_not_found', 'Venue not found')) }],
    ['d_404', { deal: () => Promise.reject(notFound('deal_not_found', 'Deal not found')) }],
  ])('says that %s is over', async (payload, catalog) => {
    const chat = consentedChat();
    Object.assign(chat.world.services.catalog, catalog);

    const [reply] = sent(await chat.start(payload));

    expect(reply?.text).toBe('Это предложение уже закончилось.');
    expect(reply?.buttons).toEqual([[{ type: 'callback', text: 'Что поесть?', payload: 'cmd:eat' }]]);
  });

  it.each(['v_abc', 'd_0'])('treats %s as a finished offer without asking the catalog', async (payload) => {
    const chat = consentedChat();
    expect(texts(await chat.start(payload))).toEqual(['Это предложение уже закончилось.']);
  });

  it('greets as usual for an unknown payload', async () => {
    const chat = consentedChat();
    expect(texts(await chat.start('promo-2026'))).toEqual([
      'С возвращением! Пришлите фото блюда или напишите, что съели.',
    ]);
  });

  it('reports unexpected catalog failures', async () => {
    const chat = consentedChat();
    chat.world.services.catalog.deal = () => Promise.reject(new Error('database is down'));

    expect(texts(await chat.start('d_21'))).toEqual([
      'Что-то пошло не так. Попробуйте ещё раз или отправьте /help',
    ]);
    expect(chat.logger.error).toHaveBeenCalledWith(
      { userId: GUEST_ID, event: 'started', err: expect.any(Error) as unknown },
      'bot handler failed',
    );
  });
});
