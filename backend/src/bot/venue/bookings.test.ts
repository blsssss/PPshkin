import { describe, expect, it } from 'vitest';
import { answers, payloads, sent, texts } from '../../../test/bot.ts';
import { OWNER_ID, venueChat, type VenueChat } from '../../../test/venue-bot.ts';
import type { MenuItem } from '../../domain/models.ts';

const REDEEM_CODE = { type: 'callback', text: 'Погасить код', payload: 'vn:redeem' };
const BOOKINGS = { type: 'callback', text: 'Брони', payload: 'vn:bk' };
const HOME = { type: 'callback', text: 'Главное меню', payload: 'vn:home' };
const CANCEL = { type: 'callback', text: 'Отмена', payload: 'vn:rd_no' };
const REDEEMED = 'Погашено: Эклер, 120 ₽. Блюдо добавлено гостю в дневник.';
const AFTER_REDEEM = [[{ type: 'callback', text: 'Погасить ещё', payload: 'vn:redeem' }, BOOKINGS]];
const CODE_PROMPT = 'Введите код с экрана гостя: 6 символов, например K7M2QX';
const CODE_INVALID = 'Код состоит из 6 латинских букв и цифр, попробуйте ещё раз';

function ownerChat(): VenueChat & { eclair: MenuItem } {
  const chat = venueChat();
  chat.fake.seedVenue();
  const eclair = chat.fake.seedItem({ name: 'Эклер' });
  chat.fake.seedBooking(eclair);
  return { ...chat, eclair };
}

async function typing(): Promise<VenueChat & { eclair: MenuItem }> {
  const chat = ownerChat();
  await chat.press('vn:redeem', 'mid.home');
  return chat;
}

describe('venue bookings', () => {
  it('lists active bookings with a redeem button for each', async () => {
    const chat = ownerChat();
    const coffee = chat.fake.seedItem({ name: 'Капучино', category: 'drink' });
    chat.fake.seedBooking(coffee, {
      code: 'P4X9ZZ',
      priceRub: 90,
      expiresAt: new Date('2026-09-26T09:55:00Z'),
    });
    chat.fake.seedBooking(coffee, { code: 'A2B3C4', status: 'redeemed' });

    const [reply] = answers(await chat.press('vn:bk', 'mid.home'));

    expect(reply?.message?.text).toBe(
      ['**Активные брони: 2**', 'K7M2QX: Эклер, 120 ₽, до 12:40', 'P4X9ZZ: Капучино, 90 ₽, до 12:55'].join(
        '\n',
      ),
    );
    expect(reply?.message?.buttons).toEqual([
      [
        { type: 'callback', text: 'Погасить K7M2QX', payload: 'vn:rd:K7M2QX' },
        { type: 'callback', text: 'Погасить P4X9ZZ', payload: 'vn:rd:P4X9ZZ' },
      ],
      [REDEEM_CODE],
      [HOME],
    ]);
  });

  it('says when there are no active bookings', async () => {
    const chat = venueChat();
    chat.fake.seedVenue();

    const [reply] = answers(await chat.press('vn:bk', 'mid.notice'));

    expect(reply?.message).toEqual({
      text: 'Активных броней нет.',
      buttons: [[REDEEM_CODE], [HOME]],
      images: [],
    });
  });

  it('redeems a booking from the button after a confirmation', async () => {
    const chat = ownerChat();

    const [question] = answers(await chat.press('vn:rd:K7M2QX', 'mid.notice'));
    expect(question?.message).toEqual({
      text: 'Погасить бронь K7M2QX: Эклер, 120 ₽? Сверьте код с экраном гостя.',
      buttons: [[{ type: 'callback', text: 'Погасить', payload: 'vn:rd_ok:K7M2QX' }, CANCEL]],
      images: [],
    });

    const redeemed = await chat.press('vn:rd_ok:K7M2QX', 'mid.notice');
    expect(answers(redeemed)[0]?.message).toEqual({
      text: 'Бронь K7M2QX: Эклер, 120 ₽.',
      buttons: [],
      images: [],
    });
    expect(sent(redeemed)[0]).toMatchObject({ text: REDEEMED, buttons: AFTER_REDEEM });
    expect(chat.fake.services.bookings.redeem).toHaveBeenCalledWith(OWNER_ID, 'K7M2QX');
    expect(chat.fake.state.bookings[0]?.status).toBe('redeemed');
  });

  it('redeems once on a double tap', async () => {
    const chat = ownerChat();
    await chat.press('vn:rd:K7M2QX', 'mid.notice');
    await chat.press('vn:rd_ok:K7M2QX', 'mid.notice');

    const repeated = await chat.press('vn:rd_ok:K7M2QX', 'mid.notice');

    expect(answers(repeated)[0]?.notification).toBe('Эта кнопка уже нажата');
    expect(chat.fake.services.bookings.redeem).toHaveBeenCalledTimes(1);
  });

  it('does not mention the diary when the guest has deleted the account', async () => {
    const chat = ownerChat();
    const [booking] = chat.fake.state.bookings;
    if (booking) booking.userId = null;

    expect(texts(await chat.press('vn:rd_ok:K7M2QX', 'mid.confirm'))).toEqual([
      'Бронь K7M2QX: Эклер, 120 ₽.',
      'Погашено: Эклер, 120 ₽.',
    ]);
  });

  it('says when the code is not among active bookings', async () => {
    const chat = ownerChat();

    const [reply] = answers(await chat.press('vn:rd:Z9Z9Z9', 'mid.notice'));

    expect(reply?.message).toEqual({
      text: 'Бронь с кодом Z9Z9Z9 не найдена среди активных',
      buttons: [[BOOKINGS, REDEEM_CODE]],
      images: [],
    });
  });

  it.each(['vn:rd', 'vn:rd:bad', 'vn:rd_ok', 'vn:rd_ok:bad'])(
    'treats %s as a stale button',
    async (payload) => {
      const chat = ownerChat();

      expect(await chat.press(payload, 'mid.old')).toEqual([
        { kind: 'answer', messageId: 'mid.old', notification: 'Кнопка устарела', message: null },
      ]);
      expect(chat.fake.services.bookings.redeem).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'an expired booking',
      { expiresAt: new Date('2026-09-26T08:59:00Z') },
      'Бронь K7M2QX: Эклер, 120 ₽.',
      'Срок брони истёк. Гость может оформить новую',
    ],
    [
      'a cancelled booking',
      { status: 'cancelled' as const },
      'Бронь K7M2QX.',
      'Бронь уже погашена или отменена',
    ],
  ])('explains %s after the confirmation', async (_case, change, answer, text) => {
    const chat = ownerChat();
    Object.assign(chat.fake.state.bookings[0] ?? {}, change);

    const replies = await chat.press('vn:rd_ok:K7M2QX', 'mid.confirm');

    expect(answers(replies)[0]?.message?.text).toBe(answer);
    expect(sent(replies)[0]).toMatchObject({ text, buttons: [[BOOKINGS, REDEEM_CODE]] });
  });

  it('keeps the booking on cancel', async () => {
    const chat = ownerChat();
    await chat.press('vn:rd:K7M2QX', 'mid.notice');

    const [reply] = answers(await chat.press('vn:rd_no', 'mid.notice'));

    expect(reply?.message).toEqual({
      text: 'Хорошо, бронь не погашена.',
      buttons: [[BOOKINGS, REDEEM_CODE]],
      images: [],
    });
    expect(chat.fake.services.bookings.redeem).not.toHaveBeenCalled();
  });
});

describe('redeeming a typed code', () => {
  it('asks for the code in a new message', async () => {
    const chat = ownerChat();

    const replies = await chat.press('vn:redeem', 'mid.home');

    expect(answers(replies)[0]?.notification).toBe('Открываю');
    expect(sent(replies)[0]).toMatchObject({ text: CODE_PROMPT, buttons: [[CANCEL]] });
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ name: 'redeem_input' });
  });

  it.each(['K7M2QX', 'k7m2qx', ' K7M 2QX ', 'ppshkin:booking:K7M2QX', 'PPSHKIN:BOOKING:k7m2qx', 'К7М2QХ'])(
    'redeems %j at once',
    async (input) => {
      const chat = await typing();

      const [reply] = sent(await chat.send(input));

      expect(reply).toMatchObject({ text: REDEEMED, buttons: AFTER_REDEEM });
      expect(chat.fake.services.bookings.redeem).toHaveBeenCalledWith(OWNER_ID, 'K7M2QX');
      expect(chat.states.peek(OWNER_ID).flow).toBeNull();
    },
  );

  it.each(['ABC', 'K7M2Q', 'K7M2QXX', 'O0I1O0', 'Эклер 200'])('asks again after %j', async (input) => {
    const chat = await typing();

    const [reply] = sent(await chat.send(input));

    expect(reply).toMatchObject({ text: CODE_INVALID, buttons: [[CANCEL]] });
    expect(chat.fake.services.bookings.redeem).not.toHaveBeenCalled();
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ name: 'redeem_input' });
  });

  it('asks for the code as text when a photo comes', async () => {
    const chat = await typing();

    expect(texts(await chat.photo())).toEqual([CODE_PROMPT]);
    expect(chat.api.download).not.toHaveBeenCalled();
    expect(chat.world.recognizePhoto).not.toHaveBeenCalled();
  });

  it('lets the owner fix a code that is not found', async () => {
    const chat = await typing();

    const [missing] = sent(await chat.send('Z9Z9Z9'));
    expect(missing).toMatchObject({
      text: 'Бронь с таким кодом не найдена в вашем заведении. Проверьте код и введите его ещё раз.',
      buttons: [[CANCEL]],
    });
    expect(chat.states.peek(OWNER_ID).flow).toMatchObject({ name: 'redeem_input' });

    expect(texts(await chat.send('K7M2QX'))).toEqual([REDEEMED]);
  });

  it.each([
    ['expired', 'Срок брони истёк. Гость может оформить новую'],
    ['redeemed', 'Бронь уже погашена или отменена'],
  ] as const)('explains a %s booking and stops waiting for codes', async (status, text) => {
    const chat = await typing();
    Object.assign(chat.fake.state.bookings[0] ?? {}, { status });

    const [reply] = sent(await chat.send('K7M2QX'));

    expect(reply).toMatchObject({ text, buttons: [[BOOKINGS, REDEEM_CODE]] });
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
  });

  it('stops waiting for the code on cancel', async () => {
    const chat = await typing();

    await chat.press('vn:rd_no');

    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
    expect(texts(await chat.send('K7M2QX'))[0]).not.toBe(REDEEMED);
  });
});

describe('staff start link', () => {
  it('asks the owner to confirm the booking of the link', async () => {
    const chat = ownerChat();

    const [reply] = sent(await chat.start('r_k7m2qx'));

    expect(reply?.text).toBe('Погасить бронь K7M2QX: Эклер, 120 ₽? Сверьте код с экраном гостя.');
    expect(payloads(reply)).toEqual(['vn:rd_ok:K7M2QX', 'vn:rd_no']);
  });

  it('accepts the link typed as a start command', async () => {
    const chat = ownerChat();

    expect(texts(await chat.send('/start r_ABC'))).toEqual(['Бронь с кодом ABC не найдена среди активных']);
  });

  it('tells guests that the link is for venue staff', async () => {
    const chat = venueChat();

    const [reply] = sent(await chat.start('r_K7M2QX'));

    expect(reply?.text).toMatch(/^Эта ссылка для сотрудников заведения\.\n\n\*\*Что я умею\*\*/);
    expect(payloads(reply)).toEqual(['cmd:today', 'cmd:profile']);
  });

  it('opens the link after the personal data consent', async () => {
    const chat = ownerChat();
    chat.world.consents.clear();

    await chat.start('r_K7M2QX');
    const replies = await chat.press('cs:pd:ok');

    expect(texts(replies)).toContain('Погасить бронь K7M2QX: Эклер, 120 ₽? Сверьте код с экраном гостя.');
  });
});
