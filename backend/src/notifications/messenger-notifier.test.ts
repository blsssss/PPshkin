import { describe, expect, it, vi } from 'vitest';
import { sampleBooking } from '../../test/bookings.ts';
import { fakeLogger, fakeMaxApi, fakeMessenger } from '../../test/max-api.ts';
import { sampleVenue } from '../../test/venues.ts';
import { EMPTY_TOTALS } from '../domain/nutrition/totals.ts';
import { MaxApiError, UserUnreachableError } from '../integrations/max/errors.ts';
import { createMaxMessenger } from '../integrations/max/messenger.ts';
import type { Messenger } from '../ports/messenger.ts';
import type { BookingNotice, Notifier } from '../ports/notifier.ts';
import type { DiaryDay } from '../services/diary.ts';
import { createMessengerNotifier } from './messenger-notifier.ts';

const GUEST = sampleBooking.userId;
const OWNER = sampleVenue.ownerId;

const notice: BookingNotice = { booking: sampleBooking, venue: sampleVenue };

const day: DiaryDay = {
  date: '2026-09-25',
  timezone: 'Europe/Moscow',
  targetKcal: 2000,
  totals: { ...EMPTY_TOTALS, meals: 3, kcal: 1450 },
  remainingKcal: 550,
  meals: [],
};

function setup(
  options: { messenger?: Messenger | null; diaryDay?: (userId: number) => Promise<DiaryDay> } = {},
) {
  const sendToUser = vi.fn<Messenger['sendToUser']>(() => Promise.resolve({ messageId: 'mid.1' }));
  const messenger = fakeMessenger({ sendToUser });
  const diaryDay = vi.fn(options.diaryDay ?? (() => Promise.resolve(day)));
  const logger = fakeLogger();
  const current = options.messenger === undefined ? messenger : options.messenger;
  const notifier = createMessengerNotifier({ messenger: () => current, diaryDay, logger });
  return { notifier, sendToUser, diaryDay, logger };
}

describe('messenger notifier messages', () => {
  it('tells the owner about a new booking with a redeem button', async () => {
    const { notifier, sendToUser } = setup();

    await notifier.bookingCreated(notice);

    expect(sendToUser).toHaveBeenCalledWith(OWNER, {
      text: '**Новая бронь K7MP4X**\nЭклер, 130 ₽\nДействует до 13:00',
      format: 'markdown',
      notify: true,
      buttons: [
        [
          { kind: 'callback', text: 'Погасить', payload: 'vn:rd:K7MP4X' },
          { kind: 'callback', text: 'Все брони', payload: 'vn:bk' },
        ],
      ],
    });
  });

  it('tells the owner about a cancelled deal booking and the returned portion', async () => {
    const { notifier, sendToUser } = setup();

    await notifier.bookingCancelled(notice);
    await notifier.bookingCancelled({ ...notice, booking: { ...sampleBooking, dealId: null } });

    const buttons = [[{ kind: 'callback', text: 'Все брони', payload: 'vn:bk' }]];
    expect(sendToUser.mock.calls).toEqual([
      [
        OWNER,
        {
          text: 'Гость отменил бронь K7MP4X: Эклер.\nПорция вернулась в горящее предложение.',
          format: 'markdown',
          notify: true,
          buttons,
        },
      ],
      [OWNER, { text: 'Гость отменил бронь K7MP4X: Эклер.', format: 'markdown', notify: true, buttons }],
    ]);
  });

  it('tells the guest the redeemed dish is in the diary with the day so far', async () => {
    const { notifier, sendToUser, diaryDay } = setup();

    await notifier.bookingRedeemed(notice);

    expect(diaryDay).toHaveBeenCalledWith(GUEST);
    expect(sendToUser).toHaveBeenCalledWith(GUEST, {
      text: 'Приятного аппетита! В дневник записано: Эклер, около 330 ккал.\nСегодня около 1450 из 2000 ккал, осталось около 550 ккал',
      format: 'markdown',
      notify: true,
      buttons: [[{ kind: 'callback', text: 'Дневник за сегодня', payload: 'cmd:today' }]],
    });
  });

  it('sends the redeem notice without the day when the diary fails', async () => {
    const failure = new Error('diary is down');
    const { notifier, sendToUser, logger } = setup({ diaryDay: () => Promise.reject(failure) });

    await notifier.bookingRedeemed(notice);

    expect(sendToUser.mock.calls[0]?.[1].text).toBe(
      'Приятного аппетита! В дневник записано: Эклер, около 330 ккал.',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { err: failure, userId: GUEST },
      'day summary is unavailable, the redeem notice goes without it',
    );
  });

  it('tells the guest the booking expired and offers to pick another dish', async () => {
    const { notifier, sendToUser } = setup();

    await notifier.bookingExpired(notice);

    expect(sendToUser).toHaveBeenCalledWith(GUEST, {
      text: 'Бронь K7MP4X истекла в 13:00: Эклер, Кофейня «Зерно». Код больше не действует.',
      format: 'markdown',
      notify: true,
      buttons: [[{ kind: 'callback', text: 'Подобрать другое', payload: 'cmd:eat' }]],
    });
  });

  it('shows times in the venue time zone and escapes names', async () => {
    const { notifier, sendToUser } = setup();

    await notifier.bookingExpired({
      booking: { ...sampleBooking, itemName: 'Торт *Наполеон*' },
      venue: { ...sampleVenue, name: 'Кафе [Урал]', timezone: 'Asia/Yekaterinburg' },
    });

    expect(sendToUser.mock.calls[0]?.[1].text).toBe(
      'Бронь K7MP4X истекла в 15:00: Торт \\*Наполеон\\*, Кафе \\[Урал\\]. Код больше не действует.',
    );
  });

  it('builds messages the MAX messenger accepts', async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ mid: 'mid.1' }));
    const messenger = createMaxMessenger(fakeMaxApi({ sendMessage }), {
      botUsername: 'ppshkin_bot',
      botUserId: 700,
    });
    const logger = fakeLogger();
    const notifier = createMessengerNotifier({
      messenger: () => messenger,
      diaryDay: () => Promise.resolve(day),
      logger,
    });

    for (const event of [
      'bookingCreated',
      'bookingCancelled',
      'bookingRedeemed',
      'bookingExpired',
    ] as const) {
      await notifier[event](notice);
    }

    expect(sendMessage).toHaveBeenCalledTimes(4);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('messenger notifier delivery', () => {
  const events: (keyof Notifier)[] = [
    'bookingCreated',
    'bookingCancelled',
    'bookingRedeemed',
    'bookingExpired',
  ];
  const withoutRecipients = (recipient: number | null): BookingNotice => ({
    booking: { ...sampleBooking, userId: recipient },
    venue: { ...sampleVenue, ownerId: recipient },
  });

  it.each([
    ['a deleted account or a venue without an owner', null],
    ['a demo account', -1001],
  ])('skips %s', async (_case, recipient) => {
    const { notifier, sendToUser, diaryDay, logger } = setup();

    for (const event of events) await notifier[event](withoutRecipients(recipient));

    expect(sendToUser).not.toHaveBeenCalled();
    expect(diaryDay).not.toHaveBeenCalled();
    for (const event of events) {
      expect(logger.debug).toHaveBeenCalledWith(
        { userId: recipient, event },
        'notification skipped: the recipient is not a MAX user',
      );
    }
  });

  it('waits quietly until the bot is running', async () => {
    const { notifier, diaryDay, logger } = setup({ messenger: null });

    await notifier.bookingRedeemed(notice);

    expect(diaryDay).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      { userId: GUEST, event: 'bookingRedeemed' },
      'notification skipped: the bot is not running yet',
    );
  });

  it('treats a guest who blocked the bot as a normal outcome', async () => {
    const { notifier, sendToUser, logger } = setup();
    sendToUser.mockRejectedValueOnce(new UserUnreachableError('chat.denied', 'chat.denied'));

    await expect(notifier.bookingExpired(notice)).resolves.toBeUndefined();

    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { userId: GUEST, event: 'bookingExpired' },
      'notification not delivered: the user blocked the bot or never started it',
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs other delivery errors without throwing', async () => {
    const failure = new MaxApiError(502, 'unexpected.response', 'Bad gateway');
    const { notifier, sendToUser, logger } = setup();
    sendToUser.mockRejectedValueOnce(failure);

    await expect(notifier.bookingCreated(notice)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      { err: failure, userId: OWNER, event: 'bookingCreated' },
      'notification failed',
    );
  });
});
