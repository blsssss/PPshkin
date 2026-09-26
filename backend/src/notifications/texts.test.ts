import { describe, expect, it, vi } from 'vitest';
import { fakeMaxApi } from '../../test/max-api.ts';
import { sampleDeal, sampleMenuItem, sampleVenue } from '../../test/venues.ts';
import { createMaxMessenger } from '../integrations/max/messenger.ts';
import type { RecommendedOffer } from '../services/recommendations.ts';
import { proactiveOfferMessage } from './texts.ts';

const offer: RecommendedOffer = {
  offerId: 501,
  item: sampleMenuItem,
  venue: sampleVenue,
  deal: { deal: sampleDeal, item: sampleMenuItem, status: 'active' },
  score: 0.82,
  distanceM: 340,
  priceRub: 130,
  kcal: 330,
  explanation: {
    headline: 'Можно позволить десерт',
    facts: [
      'Сегодня записано 2 приёма пищи, примерно 900 ккал',
      '«Эклер» в «Кофейня «Зерно»»: 330 ккал по данным заведения',
    ],
    calculations: [
      'До ориентира 2000 ккал остаётся около 1100 ккал',
      'Скидка 35%: 130 ₽ вместо 200 ₽, до 14:00',
    ],
    assumptions: ['Калорийность приблизительная, это не медицинская рекомендация'],
    factors: [],
  },
};

describe('proactiveOfferMessage', () => {
  it('introduces the offer card and asks before booking', () => {
    expect(proactiveOfferMessage(offer)).toEqual({
      text: [
        'Подсказка по вашему дневнику',
        '',
        '**Можно позволить десерт**',
        'Эклер',
        'Кофейня «Зерно», ул. Баумана, 36',
        '130 ₽, около 330 ккал, 350 м от вас',
        '',
        'Почему:',
        '- Сегодня записано 2 приёма пищи, примерно 900 ккал',
        '- «Эклер» в «Кофейня «Зерно»»: 330 ккал по данным заведения',
        '- До ориентира 2000 ккал остаётся около 1100 ккал',
        '- Скидка 35%: 130 ₽ вместо 200 ₽, до 14:00',
        '*Калорийность приблизительная, это не медицинская рекомендация*',
      ].join('\n'),
      format: 'markdown',
      notify: true,
      buttons: [
        [{ kind: 'callback', text: 'Забронировать', payload: 'bk:new:11:21:501' }],
        [
          { kind: 'callback', text: 'Не сегодня', payload: 'of:nt:501' },
          { kind: 'callback', text: 'Отписаться', payload: 'cs:ad:off' },
        ],
      ],
    });
  });

  it('books without a deal and leaves out an unknown distance', () => {
    const message = proactiveOfferMessage({ ...offer, deal: null, distanceM: null, priceRub: 200 });

    expect(message.text.split('\n')[5]).toBe('200 ₽, около 330 ккал');
    expect(message.buttons?.[0]).toEqual([
      { kind: 'callback', text: 'Забронировать', payload: 'bk:new:11:0:501' },
    ]);
  });

  it('escapes names that look like markdown', () => {
    const message = proactiveOfferMessage({
      ...offer,
      item: { ...sampleMenuItem, name: 'Сэндвич [BLT]' },
      venue: { ...sampleVenue, name: 'Кафе_24', address: 'ул. Пушкина, 1 (вход со двора)' },
    });

    expect(message.text.split('\n').slice(3, 5)).toEqual([
      'Сэндвич \\[BLT\\]',
      'Кафе\\_24, ул. Пушкина, 1 \\(вход со двора\\)',
    ]);
  });

  it('builds a message the MAX messenger accepts', async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ mid: 'mid.1' }));
    const messenger = createMaxMessenger(fakeMaxApi({ sendMessage }), {
      botUsername: 'ppshkin_bot',
      botUserId: 700,
    });

    await expect(messenger.sendToUser(101, proactiveOfferMessage(offer))).resolves.toEqual({
      messageId: 'mid.1',
    });
  });
});
