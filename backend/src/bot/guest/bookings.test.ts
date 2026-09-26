import { describe, expect, it, vi } from 'vitest';
import { answers, botChat, GUEST_ID, labels, payloads, sent, texts } from '../../../test/bot.ts';
import { SAMPLE_PNG } from '../../../test/bookings.ts';
import { eclairOffer, offersWorld, type OffersWorld } from '../../../test/offers.ts';
import { BAUMANA, sampleDeal, sampleMenuItem, sampleVenue } from '../../../test/venues.ts';
import type { BookingStatus } from '../../domain/vocabulary.ts';
import { MaxApiError } from '../../integrations/max/errors.ts';
import type { RecommendedOffer } from '../../services/recommendations.ts';
import { conflict, forbidden, notFound } from '../../shared/errors.ts';

const BOOKING_TEXT = [
  '**Бронь K7M2QX**',
  'Эклер, 130 ₽',
  'Кофейня «Зерно», ул. Баумана, 36',
  'Действует до 13:00. Покажите код или QR на кассе.',
].join('\n');

const ROUTE = { type: 'link', text: 'Маршрут', url: 'https://yandex.ru/maps/?pt=49.1221,55.7887&z=17&l=map' };
const CANCEL = { type: 'callback', text: 'Отменить бронь', payload: 'bk:cancel:31' };
const SHOW_QR = { type: 'callback', text: 'Показать QR', payload: 'bk:qr:31' };
const PRESSED = 'Эта кнопка уже нажата';

interface BookingSetup {
  miniAppEnabled?: boolean;
  upload?: () => Promise<string>;
  offers?: RecommendedOffer[];
}

function bookingChat(options: BookingSetup = {}) {
  const world: OffersWorld = offersWorld({ offers: options.offers });
  world.user.location = BAUMANA;
  world.user.locationUpdatedAt = world.clock.now();
  const uploadImage = vi.fn(options.upload ?? (() => Promise.resolve('qr-token')));
  const chat = botChat({ world, miniAppEnabled: options.miniAppEnabled ?? false, api: { uploadImage } });
  return { ...chat, world, uploadImage };
}

async function bookFromCard(chat: ReturnType<typeof bookingChat>) {
  const [card] = sent(await chat.send('/eat'));
  const replies = await chat.press('bk:new:11:21:501', card?.messageId);
  return { card, replies };
}

describe('booking from an offer card', () => {
  it('goes from a food photo to a suggestion, a booking with QR and its cancellation', async () => {
    const chat = bookingChat();
    chat.world.consent('personalized_offers');
    chat.world.recognizePhoto.mockImplementation(() => chat.world.logged({}));

    const suggestion = sent(await chat.photo()).at(-1);
    expect(suggestion?.text).toContain('**Можно позволить десерт**\nЭклер');

    const booked = await chat.press('bk:new:11:21:501', suggestion?.messageId);
    expect(answers(booked)[0]?.message).toEqual({ text: suggestion?.text, buttons: [], images: [] });
    const [booking] = sent(booked);
    expect(booking).toMatchObject({ text: BOOKING_TEXT, images: ['qr-token'] });

    await chat.press('bk:cancel:31', booking?.messageId);
    const cancelled = await chat.press('bk:cancel_ok:31', booking?.messageId);
    expect(texts(cancelled)).toEqual(['Бронь K7M2QX отменена.']);
    expect(chat.world.bookings.views.map(({ booking: { status } }) => status)).toEqual(['cancelled']);
    expect(chat.states.peek(GUEST_ID).offerQueue).toBeNull();
  });

  it('keeps the card without buttons and sends the code with the QR', async () => {
    const chat = bookingChat();

    const { card, replies } = await bookFromCard(chat);

    const [answer] = answers(replies);
    expect(answer).toEqual({
      kind: 'answer',
      messageId: card?.messageId,
      notification: null,
      message: { text: card?.text, buttons: [], images: [] },
    });
    expect(chat.world.bookings.create).toHaveBeenCalledWith(GUEST_ID, {
      menuItemId: 11,
      dealId: 21,
      offerId: 501,
    });
    expect(chat.world.bookings.qr).toHaveBeenCalledWith(GUEST_ID, 31);
    expect(chat.uploadImage).toHaveBeenCalledWith(SAMPLE_PNG, 'booking-K7M2QX.png', 'image/png');
    const [booking] = sent(replies);
    expect(booking).toMatchObject({ text: BOOKING_TEXT, images: ['qr-token'], buttons: [[ROUTE], [CANCEL]] });
    expect(chat.states.peek(GUEST_ID).offerQueue).toBeNull();
  });

  it('links the booking in the mini app when it is enabled', async () => {
    const chat = bookingChat({ miniAppEnabled: true });

    const { replies } = await bookFromCard(chat);

    expect(sent(replies)[0]?.buttons).toEqual([
      [
        ROUTE,
        {
          type: 'link',
          text: 'Открыть в мини-приложении',
          url: 'https://max.ru/ppshkin_bot?startapp=booking_31',
        },
      ],
      [CANCEL],
    ]);
  });

  it('creates one booking on a double tap', async () => {
    const chat = bookingChat();
    const { card } = await bookFromCard(chat);

    const second = await chat.press('bk:new:11:21:501', card?.messageId);

    expect(second).toEqual([
      { kind: 'answer', messageId: card?.messageId, notification: PRESSED, message: null },
    ]);
    expect(chat.world.bookings.create).toHaveBeenCalledTimes(1);
  });

  it('sends the booking without the image when the QR upload fails', async () => {
    const chat = bookingChat({
      upload: () => Promise.reject(new MaxApiError(500, 'internal', 'Upload failed')),
    });

    const { replies } = await bookFromCard(chat);

    const [booking] = sent(replies);
    expect(booking).toMatchObject({
      text: BOOKING_TEXT,
      images: [],
      buttons: [[SHOW_QR], [ROUTE], [CANCEL]],
    });
    expect(chat.logger.warn).toHaveBeenCalledWith(
      { err: expect.any(MaxApiError) as unknown, userId: GUEST_ID, bookingId: 31 },
      'booking qr was not uploaded',
    );
  });

  it('books a deal from a venue card with a notice', async () => {
    const chat = bookingChat();

    const replies = await chat.press('bk:new:11:21:0', 'mid.venue');

    expect(answers(replies)[0]?.notification).toBe('Бронирую');
    expect(chat.world.bookings.create).toHaveBeenCalledWith(GUEST_ID, { menuItemId: 11, dealId: 21 });
    expect(sent(replies)[0]?.text).toBe(BOOKING_TEXT);
  });

  it('books a dish without a deal from an older card', async () => {
    const chat = bookingChat();
    const [first] = sent(await chat.send('/eat'));
    await chat.send('/eat');

    const replies = await chat.press('bk:new:12:0:502', first?.messageId);

    expect(answers(replies)[0]?.notification).toBe('Бронирую');
    expect(chat.world.bookings.create).toHaveBeenCalledWith(GUEST_ID, { menuItemId: 12, offerId: 502 });
    expect(sent(replies)[0]?.text).toContain('Круассан с миндалём, 180 ₽');
  });

  it('marks demo venues in the booking', async () => {
    const chat = bookingChat();
    const view = await chat.world.bookings.create(GUEST_ID, { menuItemId: 11, dealId: 21 });
    view.venue = { ...sampleVenue, isDemo: true };

    const [card] = sent(await chat.send('/bookings'));

    expect(card?.text).toBe(`${BOOKING_TEXT}\n*Заведение и меню тестовые*`);
  });
});

describe('booking errors', () => {
  it.each([
    [
      'deal_sold_out',
      conflict('deal_sold_out', 'Sold out'),
      'Эту позицию уже разобрали. Посмотрим другое: /eat',
      'cmd:eat',
    ],
    [
      'deal_not_active',
      conflict('deal_not_active', 'Over'),
      'Предложение уже закончилось. Посмотрим другое: /eat',
      'cmd:eat',
    ],
    [
      'venue_closed',
      conflict('venue_closed', 'Closed'),
      'Заведение сейчас закрыто, бронь не получится. Посмотрим другое: /eat',
      'cmd:eat',
    ],
    [
      'menu_item_unavailable',
      notFound('menu_item_unavailable', 'Hidden'),
      'Позиция больше недоступна. Посмотрим другое: /eat',
      'cmd:eat',
    ],
    [
      'too_many_bookings',
      conflict('too_many_bookings', 'Too many'),
      'У вас уже 3 активные брони. Лишнюю можно отменить в /bookings.',
      'cmd:bookings',
    ],
    [
      'booking_exists',
      conflict('booking_exists', 'Booked'),
      'Это предложение уже забронировано вами, код в /bookings.',
      'cmd:bookings',
    ],
  ])('explains %s and offers the next step', async (_code, error, text, next) => {
    const chat = bookingChat();
    vi.mocked(chat.world.bookings.create).mockRejectedValueOnce(error);

    const { replies } = await bookFromCard(chat);

    const [failure] = sent(replies);
    expect(failure?.text).toBe(text);
    expect(payloads(failure)).toEqual([next]);
    expect(chat.uploadImage).not.toHaveBeenCalled();
  });

  it('tells that the deal sold out between the suggestion and the tap', async () => {
    const deal = { ...sampleDeal, quantityLeft: 1 };
    const chat = bookingChat({
      offers: [{ ...eclairOffer, deal: { deal, item: sampleMenuItem, status: 'active' } }],
    });
    const [card] = sent(await chat.send('/eat'));
    deal.quantityLeft = 0;

    const replies = await chat.press('bk:new:11:21:501', card?.messageId);

    expect(texts(replies)).toEqual([card?.text, 'Эту позицию уже разобрали. Посмотрим другое: /eat']);
    expect(labels(sent(replies)[0])).toEqual(['Что поесть?']);
    expect(chat.world.bookings.views).toHaveLength(0);
  });

  it('points to the existing booking of the same dish', async () => {
    const chat = bookingChat();
    await chat.press('bk:new:11:0:0', 'mid.venue');

    const replies = await chat.press('bk:new:11:21:0', 'mid.deal');

    expect(texts(replies).at(-1)).toBe('Это предложение уже забронировано вами, код в /bookings.');
    expect(labels(sent(replies)[0])).toEqual(['Мои брони']);
    expect(chat.world.bookings.views).toHaveLength(1);
  });

  it('asks for the consent again when the booking needs it', async () => {
    const chat = bookingChat();
    vi.mocked(chat.world.bookings.create).mockRejectedValueOnce(forbidden('consent_required', 'No consent'));

    const { replies } = await bookFromCard(chat);

    expect(texts(replies).at(-1)).toContain('Чтобы вести дневник, нужно ваше согласие');
    expect(labels(sent(replies).at(-1))).not.toContain('Что поесть?');
    expect(chat.logger.error).not.toHaveBeenCalled();
  });

  it('reports unexpected failures in general words', async () => {
    const chat = bookingChat();
    vi.mocked(chat.world.bookings.create).mockRejectedValueOnce(new Error('database is down'));

    const { replies } = await bookFromCard(chat);

    expect(texts(replies).at(-1)).toBe('Что-то пошло не так. Попробуйте ещё раз или отправьте /help');
    expect(chat.logger.error).toHaveBeenCalled();
  });

  it.each([
    'bk:new:abc:0:0',
    'bk:new:11:x:0',
    'bk:new:11:0:-1',
    'bk:new',
    'bk:qr:0',
    'bk:cancel:abc',
    'bk:fly:1',
  ])('treats %s as a stale button', async (payload) => {
    const chat = bookingChat();
    expect(answers(await chat.press(payload, 'mid.old'))[0]?.notification).toBe('Кнопка устарела');
    expect(chat.world.bookings.create).not.toHaveBeenCalled();
  });
});

describe('booking cancellation', () => {
  it('asks first, keeps the booking on «Нет» and cancels on «Да, отменить»', async () => {
    const chat = bookingChat();
    const { replies } = await bookFromCard(chat);
    const [booking] = sent(replies);
    const messageId = booking?.messageId ?? null;

    const question = answers(await chat.press('bk:cancel:31', messageId))[0];
    expect(question?.message).toEqual({
      text: 'Отменить бронь K7M2QX?',
      buttons: [
        [
          { type: 'callback', text: 'Да, отменить', payload: 'bk:cancel_ok:31' },
          { type: 'callback', text: 'Нет', payload: 'bk:keep:31' },
        ],
      ],
      images: [],
    });

    const kept = answers(await chat.press('bk:keep:31', messageId))[0];
    expect(kept?.message).toEqual({
      text: BOOKING_TEXT,
      buttons: [[SHOW_QR], [ROUTE], [CANCEL]],
      images: [],
    });
    expect(chat.world.bookings.cancel).not.toHaveBeenCalled();

    await chat.press('bk:cancel:31', messageId);
    const cancelled = answers(await chat.press('bk:cancel_ok:31', messageId))[0];
    expect(cancelled?.message?.text).toBe('Бронь K7M2QX отменена.');
    expect(chat.world.bookings.views[0]?.booking.status).toBe('cancelled');

    const again = await chat.press('bk:cancel_ok:31', messageId);
    expect(answers(again)[0]?.notification).toBe(PRESSED);
    expect(chat.world.bookings.cancel).toHaveBeenCalledTimes(1);
  });

  it('says that a booking from an old message is no longer active', async () => {
    const chat = bookingChat();
    await bookFromCard(chat);
    await chat.world.bookings.cancel(GUEST_ID, 31);

    expect(answers(await chat.press('bk:cancel:31', 'mid.old'))[0]?.message?.text).toBe(
      'Бронь K7M2QX уже не активна.',
    );
    expect(answers(await chat.press('bk:keep:31', 'mid.old2'))[0]?.message?.text).toBe(
      'Бронь K7M2QX уже не активна.',
    );
    expect(answers(await chat.press('bk:cancel_ok:31', 'mid.old3'))[0]?.message?.text).toBe(
      'Бронь уже не активна.',
    );
  });

  it('says that an expired booking cannot be cancelled', async () => {
    const chat = bookingChat();
    await bookFromCard(chat);
    vi.mocked(chat.world.bookings.cancel).mockRejectedValueOnce(conflict('booking_expired', 'Expired'));

    const answer = answers(await chat.press('bk:cancel_ok:31', 'mid.confirm'))[0];

    expect(answer?.message?.text).toBe('Бронь уже не активна.');
  });

  it('does not find a booking of someone else', async () => {
    const chat = bookingChat();

    const answer = answers(await chat.press('bk:cancel:77', 'mid.old'))[0];

    expect(answer?.message?.text).toBe('Не нашёл: запись уже удалена или устарела.');
  });
});

describe('«Показать QR»', () => {
  it('attaches the QR to the booking in place', async () => {
    const chat = bookingChat();
    await chat.world.bookings.create(GUEST_ID, { menuItemId: 11, dealId: 21 });

    const answer = answers(await chat.press('bk:qr:31', 'mid.list'))[0];

    expect(answer?.message).toEqual({
      text: BOOKING_TEXT,
      buttons: [[ROUTE], [CANCEL]],
      images: ['qr-token'],
    });
  });

  it('says so when the QR cannot be shown', async () => {
    const chat = bookingChat({ upload: () => Promise.reject(new Error('timeout')) });
    await chat.world.bookings.create(GUEST_ID, { menuItemId: 11, dealId: 21 });

    const replies = await chat.press('bk:qr:31', 'mid.list');

    expect(replies).toEqual([
      {
        kind: 'answer',
        messageId: 'mid.list',
        notification: 'Не получилось показать QR. Покажите код на кассе.',
        message: null,
      },
    ]);
  });

  it('does not show the QR of a finished booking', async () => {
    const chat = bookingChat();
    await chat.world.bookings.create(GUEST_ID, { menuItemId: 11, dealId: 21 });
    await chat.world.bookings.cancel(GUEST_ID, 31);

    const answer = answers(await chat.press('bk:qr:31', 'mid.list'))[0];

    expect(answer?.message?.text).toBe('Бронь K7M2QX уже не активна.');
    expect(chat.uploadImage).not.toHaveBeenCalled();
  });
});

describe('/bookings', () => {
  it('invites to pick a dish when there are no bookings', async () => {
    const chat = bookingChat();

    const replies = sent(await chat.send('/bookings'));

    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toBe('Активных броней нет. Подобрать блюдо: /eat');
    expect(replies[0]?.buttons).toEqual([[{ type: 'callback', text: 'Что поесть?', payload: 'cmd:eat' }]]);
  });

  it('lists active bookings one by one and the latest history in one message', async () => {
    const chat = bookingChat();
    const { bookings } = chat.world;
    const finish = async (menuItemId: number, status: BookingStatus, day: string) => {
      chat.world.clock.set(`2026-09-${day}T09:00:00Z`);
      const view = await bookings.create(GUEST_ID, { menuItemId });
      view.booking = { ...view.booking, status, resolvedAt: chat.world.clock.now() };
    };
    await finish(11, 'redeemed', '12');
    await finish(12, 'cancelled', '13');
    await finish(13, 'expired', '14');
    await finish(11, 'redeemed', '15');
    await finish(12, 'redeemed', '16');
    await finish(13, 'cancelled', '17');
    chat.world.clock.set('2026-09-26T09:00:00Z');
    await bookings.create(GUEST_ID, { menuItemId: 11, dealId: 21 });
    await bookings.create(GUEST_ID, { menuItemId: 12 });

    const replies = sent(await chat.send('/bookings'));

    expect(replies.map((reply) => reply.text)).toEqual([
      expect.stringContaining('Эклер, 130 ₽'),
      expect.stringContaining('Круассан с миндалём, 180 ₽'),
      [
        '**История**',
        '17.09 Салат с курицей, Пекарня «Колос»: отменена',
        '16.09 Круассан с миндалём, Кофейня «Зерно»: погашена',
        '15.09 Эклер, Кофейня «Зерно»: погашена',
        '14.09 Салат с курицей, Пекарня «Колос»: истекла',
        '13.09 Круассан с миндалём, Кофейня «Зерно»: отменена',
      ].join('\n'),
    ]);
    expect(replies[0]?.buttons).toEqual([
      [{ type: 'callback', text: 'Показать QR', payload: 'bk:qr:37' }],
      [ROUTE],
      [{ type: 'callback', text: 'Отменить бронь', payload: 'bk:cancel:37' }],
    ]);
    expect(bookings.list).toHaveBeenNthCalledWith(1, GUEST_ID, 'active');
    expect(bookings.list).toHaveBeenNthCalledWith(2, GUEST_ID, 'history');
  });

  it('shows the history under the empty list', async () => {
    const chat = bookingChat();
    const view = await chat.world.bookings.create(GUEST_ID, { menuItemId: 11 });
    view.booking = { ...view.booking, status: 'redeemed' };

    expect(texts(await chat.send('/bookings'))).toEqual([
      'Активных броней нет. Подобрать блюдо: /eat',
      '**История**\n26.09 Эклер, Кофейня «Зерно»: погашена',
    ]);
  });

  it('escapes names in the history', async () => {
    const chat = bookingChat();
    const view = await chat.world.bookings.create(GUEST_ID, { menuItemId: 11 });
    view.booking = { ...view.booking, status: 'expired', itemName: 'Торт *дня*' };

    expect(texts(await chat.send('/bookings')).at(-1)).toBe(
      '**История**\n26.09 Торт \\*дня\\*, Кофейня «Зерно»: истекла',
    );
  });

  it('opens from the «Мои брони» button', async () => {
    const chat = bookingChat();
    const replies = await chat.press('cmd:bookings', 'mid.failure');
    expect(answers(replies)[0]?.notification).toBe('Открываю');
    expect(sent(replies)[0]?.text).toBe('Активных броней нет. Подобрать блюдо: /eat');
  });

  it('shows the time until which a booking holds in the venue time zone', async () => {
    const chat = bookingChat();
    const view = await chat.world.bookings.create(GUEST_ID, { menuItemId: 11, dealId: 21 });
    view.venue = { ...sampleVenue, timezone: 'Asia/Yekaterinburg' };

    expect(sent(await chat.send('/bookings'))[0]?.text).toContain('Действует до 15:00.');
  });
});
