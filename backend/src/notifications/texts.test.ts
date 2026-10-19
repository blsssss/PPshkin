import { describe, expect, it, vi } from 'vitest';
import { sampleBooking } from '../../test/bookings.ts';
import { fakeMaxApi } from '../../test/max-api.ts';
import { sampleDeal, sampleMenuItem, sampleVenue } from '../../test/venues.ts';
import { EMPTY_TOTALS } from '../domain/nutrition/totals.ts';
import { createMaxMessenger } from '../integrations/max/messenger.ts';
import type { DiaryDay } from '../services/diary.ts';
import type { RecommendedOffer } from '../services/recommendations.ts';
import {
  accountInactiveMessage,
  bookingCancelledMessage,
  bookingConfirmedMessage,
  bookingCreatedMessage,
  bookingExpiredMessage,
  bookingRedeemedMessage,
  bookingReminderMessage,
  dealEndingMessage,
  dealSoldOutMessage,
  proactiveOfferMessage,
  venueBookingExpiredMessage,
  type BookingNotice,
  type DealNotice,
} from './texts.ts';

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

const notice: BookingNotice = { booking: sampleBooking, venue: sampleVenue };
const MINUTE = 60_000;
const GUEST_BUTTONS = [
  [
    { kind: 'callback', text: 'Показать QR', payload: 'bk:qr:31' },
    { kind: 'callback', text: 'Отменить', payload: 'bk:cancel:31' },
  ],
];
const VENUE_BOOKINGS = [[{ kind: 'callback', text: 'Все брони', payload: 'vn:bk' }]];

function minutesBefore(minutes: number): Date {
  return new Date(sampleBooking.expiresAt.getTime() - minutes * MINUTE);
}

describe('guest booking messages', () => {
  it('confirms a mini app booking with the code, the venue and the deadline', () => {
    expect(bookingConfirmedMessage(notice)).toEqual({
      text: [
        '**Бронь K7MP4X подтверждена**',
        'Эклер, 130 ₽',
        'Кофейня «Зерно», ул. Баумана, 36',
        'Покажите код или QR на кассе до 13:00.',
      ].join('\n'),
      format: 'markdown',
      notify: true,
      buttons: GUEST_BUTTONS,
    });
  });

  it('reminds about the booking ten minutes before it ends', () => {
    expect(bookingReminderMessage(notice, minutesBefore(10))).toEqual({
      text: 'Бронь K7MP4X действует ещё 10 минут, до 13:00: Эклер, Кофейня «Зерно», ул. Баумана, 36.',
      format: 'markdown',
      notify: true,
      buttons: [
        ...GUEST_BUTTONS,
        [{ kind: 'callback', text: 'Не напоминать', payload: 'nt:off:booking_reminder' }],
      ],
    });
  });

  it.each([
    [1, '1 минуту'],
    [2, '2 минуты'],
    [5, '5 минут'],
    [11, '11 минут'],
    [21, '21 минуту'],
  ])('declines %i minutes', (minutes, words) => {
    expect(bookingReminderMessage(notice, minutesBefore(minutes)).text).toContain(`ещё ${words}, до 13:00`);
  });

  it('rounds the minutes left up', () => {
    const now = new Date(sampleBooking.expiresAt.getTime() - 9 * MINUTE - 1000);
    expect(bookingReminderMessage(notice, now).text).toContain('ещё 10 минут');
  });

  it('tells the guest the redeemed dish is in the diary with the day so far', () => {
    const day: DiaryDay = {
      date: '2026-09-25',
      timezone: 'Europe/Moscow',
      targetKcal: 2000,
      totals: { ...EMPTY_TOTALS, meals: 3, kcal: 1450 },
      remainingKcal: 550,
      meals: [],
    };
    expect(bookingRedeemedMessage(notice, day)).toEqual({
      text: 'Приятного аппетита! В дневник записано: Эклер, около 330 ккал.\nСегодня около 1450 из 2000 ккал, осталось около 550 ккал',
      format: 'markdown',
      notify: true,
      buttons: [[{ kind: 'callback', text: 'Дневник за сегодня', payload: 'cmd:today' }]],
    });
    expect(bookingRedeemedMessage(notice, null).text).toBe(
      'Приятного аппетита! В дневник записано: Эклер, около 330 ккал.',
    );
  });

  it('tells the guest the booking expired and offers to pick another dish', () => {
    expect(bookingExpiredMessage(notice)).toEqual({
      text: 'Бронь K7MP4X истекла в 13:00: Эклер, Кофейня «Зерно». Код больше не действует.',
      format: 'markdown',
      notify: true,
      buttons: [[{ kind: 'callback', text: 'Подобрать другое', payload: 'cmd:eat' }]],
    });
  });

  it('shows times in the venue time zone and escapes names', () => {
    const local: BookingNotice = {
      booking: { ...sampleBooking, itemName: 'Торт *Наполеон*' },
      venue: { ...sampleVenue, name: 'Кафе [Урал]', address: 'ул. Ленина_5', timezone: 'Asia/Yekaterinburg' },
    };
    expect(bookingExpiredMessage(local).text).toBe(
      'Бронь K7MP4X истекла в 15:00: Торт \\*Наполеон\\*, Кафе \\[Урал\\]. Код больше не действует.',
    );
    expect(bookingConfirmedMessage(local).text.split('\n').slice(1)).toEqual([
      'Торт \\*Наполеон\\*, 130 ₽',
      'Кафе \\[Урал\\], ул. Ленина\\_5',
      'Покажите код или QR на кассе до 15:00.',
    ]);
  });
});

describe('venue booking messages', () => {
  it('tells the owner about a new booking with a redeem button', () => {
    expect(bookingCreatedMessage(notice)).toEqual({
      text: '**Новая бронь K7MP4X**\nЭклер, 130 ₽\nДействует до 13:00',
      format: 'markdown',
      notify: true,
      buttons: [
        [
          { kind: 'callback', text: 'Погасить', payload: 'vn:rd:K7MP4X:7' },
          { kind: 'callback', text: 'Все брони', payload: 'vn:bk' },
        ],
      ],
    });
  });

  it('tells the owner about a cancelled booking and the returned portion of a deal', () => {
    expect(bookingCancelledMessage(notice).text).toBe(
      'Гость отменил бронь K7MP4X: Эклер.\nПорция вернулась в горящее предложение.',
    );
    expect(bookingCancelledMessage({ ...notice, booking: { ...sampleBooking, dealId: null } })).toEqual({
      text: 'Гость отменил бронь K7MP4X: Эклер.',
      format: 'markdown',
      notify: true,
      buttons: VENUE_BOOKINGS,
    });
  });

  it('tells the owner the guest did not come and mentions the portion only for a running deal', () => {
    expect(venueBookingExpiredMessage(notice, true)).toEqual({
      text: 'Бронь K7MP4X истекла в 13:00: Эклер. Гость не пришёл.\nПорция вернулась в горящее предложение.',
      format: 'markdown',
      notify: true,
      buttons: VENUE_BOOKINGS,
    });
    expect(venueBookingExpiredMessage(notice, false).text).toBe(
      'Бронь K7MP4X истекла в 13:00: Эклер. Гость не пришёл.',
    );
  });
});

describe('venue deal messages', () => {
  const deal: DealNotice = {
    deal: { ...sampleDeal, quantityTotal: 10, quantityLeft: 0, priceRub: 90 },
    venue: sampleVenue,
    itemName: 'Круассан',
  };

  it('tells the owner the deal is fully booked', () => {
    expect(dealSoldOutMessage(deal)).toEqual({
      text: 'Горящая позиция забронирована целиком: Круассан, 10 шт. по 90 ₽. Новые брони появятся, только если гость отменит свою или она истечёт.',
      format: 'markdown',
      notify: true,
      buttons: [
        [
          { kind: 'callback', text: 'Брони', payload: 'vn:bk' },
          { kind: 'callback', text: 'Горящие позиции', payload: 'vn:deals' },
        ],
      ],
    });
  });

  it('warns that the deal ends soon with portions left, at the closing time when it comes first', () => {
    const ending: DealNotice = {
      ...deal,
      deal: { ...deal.deal, quantityLeft: 3, endsAt: new Date('2026-09-25T20:00:00Z') },
      venue: { ...sampleVenue, closesAt: '21:30' },
    };
    expect(dealEndingMessage(ending)).toEqual({
      text: 'Горящая позиция «Круассан» закончится в 21:30, осталось 3 из 10. Продлить до закрытия можно в кабинете.',
      format: 'markdown',
      notify: true,
      buttons: [
        [{ kind: 'callback', text: 'Горящие позиции', payload: 'vn:deals' }],
        [{ kind: 'callback', text: 'Не присылать', payload: 'nt:off:venue_deal_ending' }],
      ],
    });
  });

  it('builds messages the MAX messenger accepts', async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ mid: 'mid.1' }));
    const messenger = createMaxMessenger(fakeMaxApi({ sendMessage }), {
      botUsername: 'ppshkin_bot',
      botUserId: 700,
    });
    for (const message of [
      bookingConfirmedMessage(notice),
      bookingReminderMessage(notice, minutesBefore(10)),
      venueBookingExpiredMessage(notice, true),
      dealSoldOutMessage(deal),
      dealEndingMessage(deal),
    ]) {
      await expect(messenger.sendToUser(101, message)).resolves.toEqual({ messageId: 'mid.1' });
    }
  });
});

describe('account inactive warning', () => {
  it('warns about the deletion without buttons', () => {
    expect(accountInactiveMessage()).toEqual({
      text: 'Аккаунт удалится через 14 дней, потому что вы давно не заходили. Чтобы сохранить его, откройте бот.',
      format: 'markdown',
      notify: true,
      buttons: [],
    });
  });
});
