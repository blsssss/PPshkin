import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedGuest } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { fakeLogger, fakeMessenger } from '../../test/max-api.ts';
import { queuedNotifications } from '../../test/notifications.ts';
import { testConfig } from '../../test/services.ts';
import { parsedItem } from '../../test/venue-bot.ts';
import { seedDeal, seedMenuItem, seedVenue } from '../../test/venues.ts';
import { createServices } from '../container.ts';
import { withTransaction } from '../db/pool.ts';
import type { Deal, MenuItem, Venue } from '../domain/models.ts';
import { MaxApiError, UserUnreachableError } from '../integrations/max/errors.ts';
import { bookingRemindersJob } from '../jobs/booking-reminders.ts';
import { dealEndingRemindersJob } from '../jobs/deal-ending-reminders.ts';
import { purgeNotificationsJob } from '../jobs/purge-notifications.ts';
import type { Messenger, OutgoingMessage } from '../ports/messenger.ts';
import type { MenuParser, MenuParseResult } from '../ports/recognition.ts';
import { createRecognition } from '../recognition/index.ts';
import * as deals from '../repositories/deals.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { createOutbox, type Outbox } from './outbox.ts';
import { createNotificationStats } from './stats.ts';

const pool = testPool();
const START = '2026-09-25T09:00:00Z';
const clock = fixedClock(START);
const OWNER = 202;
const GUEST = 101;
const SECOND_GUEST = 102;
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const config = testConfig();
const background = createBackgroundTasks({ error: () => undefined });
const sendToUser = vi.fn<Messenger['sendToUser']>();
const menus = { fromPhoto: vi.fn<MenuParser['fromPhoto']>(), fromText: vi.fn<MenuParser['fromText']>() };
const stats = createNotificationStats();
let live = true;

function outboxFor(send: Messenger['sendToUser'] = sendToUser): Outbox {
  return createOutbox({
    pool,
    clock,
    bot: () => (live ? { messenger: fakeMessenger({ sendToUser: send }), username: 'ppshkin_bot' } : null),
    miniAppEnabled: true,
    diaryDay: (userId) => services.diary.day(userId),
    background,
    logger: fakeLogger(),
    stats,
  });
}

const outbox = outboxFor();
const services = createServices({
  config,
  pool,
  clock,
  recognition: {
    ...createRecognition({
      apiKey: undefined,
      baseUrl: config.CHADGPT_BASE_URL,
      visionModel: config.CHADGPT_MODEL,
      fallbackModel: config.CHADGPT_FALLBACK_MODEL,
      timeoutMs: config.CHADGPT_TIMEOUT_MS,
      menuTimeoutMs: config.CHADGPT_MENU_TIMEOUT_MS,
    }),
    menus,
  },
  background,
  notifications: outbox,
});

let venue: Venue;
let eclair: MenuItem;
let tart: MenuItem;
let deal: Deal;
let sequence = 0;

const later = (ms: number) => new Date(clock.now().getTime() + ms);

async function settle(): Promise<void> {
  await background.idle();
}

function sentTo(): [number, string][] {
  return sendToUser.mock.calls.map(([userId, message]) => [userId, message.text]);
}

async function deliver(): Promise<void> {
  await settle();
  await outbox.deliverDue(clock.now());
}

async function statusesOf(kind: string) {
  return (await queuedNotifications(pool)).filter((row) => row.kind === kind);
}

beforeEach(async () => {
  await background.idle();
  await resetDatabase(pool);
  clock.set(START);
  live = true;
  sequence = 0;
  sendToUser.mockReset();
  sendToUser.mockImplementation(() => {
    sequence += 1;
    return Promise.resolve({ messageId: `mid.${String(sequence)}` });
  });
  menus.fromPhoto.mockReset();
  menus.fromText.mockReset();
  venue = await seedVenue(pool, OWNER);
  eclair = await seedMenuItem(pool, venue.id, { name: 'Эклер', priceRub: 200 });
  tart = await seedMenuItem(pool, venue.id, { name: 'Тарт', priceRub: 250 });
  deal = await seedDeal(pool, eclair, {
    priceRub: 120,
    quantity: 2,
    startsAt: later(-HOUR),
    endsAt: later(5 * HOUR),
  });
  for (const guest of [GUEST, SECOND_GUEST]) await seedGuest(pool, guest, later(-HOUR));
});

afterAll(async () => {
  await background.idle();
  await closeTestPool();
});

describe('queueing', () => {
  it('writes nothing when the transaction rolls back and one row per key on repeats', async () => {
    const booking = (await services.bookings.create(GUEST, { menuItemId: tart.id }, 'bot')).booking;
    await settle();
    sendToUser.mockClear();
    const event = { kind: 'booking_reminder' as const, booking, venue };

    await expect(
      withTransaction(pool, async (client) => {
        await outbox.enqueue(client, event, clock.now());
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await statusesOf('booking_reminder')).toEqual([]);

    await outbox.enqueue(pool, event, clock.now());
    await outbox.enqueue(pool, event, clock.now());
    expect(await statusesOf('booking_reminder')).toHaveLength(1);
  });

  it('leaves out demo accounts and venues without an owner', async () => {
    const booking = (await services.bookings.create(GUEST, { menuItemId: tart.id }, 'bot')).booking;
    await outbox.enqueue(
      pool,
      { kind: 'booking_redeemed', booking: { ...booking, userId: -1001 }, venue },
      clock.now(),
    );
    await outbox.enqueue(
      pool,
      { kind: 'venue_booking_cancelled', booking, venue: { ...venue, ownerId: null } },
      clock.now(),
    );
    expect((await queuedNotifications(pool)).map((row) => row.kind)).toEqual(['venue_booking_created']);
  });

  it('queues nothing without the bot', async () => {
    const silent = createServices({
      config,
      pool,
      clock,
      recognition: { dishes: services.diary as never, menus },
      background,
    });
    await silent.bookings.create(GUEST, { menuItemId: eclair.id, dealId: deal.id }, 'miniapp');
    expect(await queuedNotifications(pool)).toEqual([]);
  });
});

describe('delivery', () => {
  it('confirms a mini app booking in the chat and tells the owner, but sends no confirmation for a bot booking', async () => {
    const fromApp = await services.bookings.create(
      GUEST,
      { menuItemId: eclair.id, dealId: deal.id },
      'miniapp',
    );
    await settle();
    const fromBot = await services.bookings.create(SECOND_GUEST, { menuItemId: tart.id }, 'bot');
    await settle();

    const code = fromApp.booking.code;
    expect(sentTo()).toEqual([
      [OWNER, `**Новая бронь ${code}**\nЭклер, 120 ₽\nДействует до 13:00`],
      [
        GUEST,
        `**Бронь ${code} подтверждена**\nЭклер, 120 ₽\nКофейня «Зерно», ул. Баумана, 36\nПокажите код или QR на кассе до 13:00.`,
      ],
      [OWNER, `**Новая бронь ${fromBot.booking.code}**\nТарт, 250 ₽\nДействует до 13:00`],
    ]);
    expect((await queuedNotifications(pool)).map((row) => [row.kind, row.status, row.messageId])).toEqual([
      ['venue_booking_created', 'sent', 'mid.1'],
      ['booking_confirmed', 'sent', 'mid.2'],
      ['venue_booking_created', 'sent', 'mid.3'],
    ]);
  });

  it('sends each row once when two deliveries run at the same time', async () => {
    live = false;
    for (const guest of [GUEST, SECOND_GUEST]) {
      await services.bookings.create(guest, { menuItemId: tart.id }, 'miniapp');
    }
    await settle();
    live = true;
    sendToUser.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      sequence += 1;
      return { messageId: `mid.${String(sequence)}` };
    });

    const reports = await Promise.all([
      outboxFor().deliverDue(clock.now()),
      outboxFor().deliverDue(clock.now()),
    ]);

    expect(reports.reduce((total, report) => total + report.sent, 0)).toBe(4);
    expect(sendToUser).toHaveBeenCalledTimes(4);
    expect(
      (await queuedNotifications(pool)).every((row) => row.status === 'sent' && row.attempts === 1),
    ).toBe(true);
  });

  it('returns a row stuck in sending for over two minutes and delivers it from a new instance', async () => {
    live = false;
    await services.bookings.create(GUEST, { menuItemId: tart.id }, 'bot');
    await pool.query(`update notifications set status = 'sending', claimed_at = $1, attempts = 1`, [
      clock.now(),
    ]);
    live = true;

    clock.advance(2 * MINUTE);
    await outboxFor().deliverDue(clock.now());
    expect(sendToUser).not.toHaveBeenCalled();

    clock.advance(SECOND);
    await outboxFor().deliverDue(clock.now());
    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(await statusesOf('venue_booking_created')).toMatchObject([{ status: 'sent', attempts: 2 }]);
  });

  it('marks a user who blocked the bot as unreachable without retries', async () => {
    sendToUser.mockRejectedValue(new UserUnreachableError('chat.denied', 'blocked'));
    await services.bookings.create(GUEST, { menuItemId: tart.id }, 'bot');
    await deliver();
    clock.advance(HOUR);
    await outbox.deliverDue(clock.now());

    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(await statusesOf('venue_booking_created')).toMatchObject([
      { status: 'unreachable', attempts: 1, lastError: '403 chat.denied: blocked' },
    ]);
  });

  it('retries a server error after 1, 5 and 15 minutes and fails after the fourth attempt', async () => {
    sendToUser.mockRejectedValue(new MaxApiError(500, 'internal', 'MAX is down'));
    await services.bookings.create(GUEST, { menuItemId: tart.id }, 'bot');
    await settle();
    const sendAfter = async () => (await statusesOf('venue_booking_created'))[0];

    expect(await sendAfter()).toMatchObject({ status: 'pending', attempts: 1, sendAfter: later(MINUTE) });
    clock.advance(MINUTE - SECOND);
    await outbox.deliverDue(clock.now());
    expect(sendToUser).toHaveBeenCalledTimes(1);

    clock.advance(SECOND);
    await outbox.deliverDue(clock.now());
    expect(await sendAfter()).toMatchObject({ status: 'pending', attempts: 2, sendAfter: later(5 * MINUTE) });
    clock.advance(5 * MINUTE);
    await outbox.deliverDue(clock.now());
    expect(await sendAfter()).toMatchObject({
      status: 'pending',
      attempts: 3,
      sendAfter: later(15 * MINUTE),
    });
    clock.advance(15 * MINUTE);
    await outbox.deliverDue(clock.now());

    expect(sendToUser).toHaveBeenCalledTimes(4);
    expect(await sendAfter()).toMatchObject({
      status: 'failed',
      attempts: 4,
      lastError: '500 internal: MAX is down',
    });
  });

  it('fails a request MAX rejects for good without retrying it', async () => {
    sendToUser.mockRejectedValue(new MaxApiError(400, 'bad.request', 'invalid markup'));
    await services.bookings.create(GUEST, { menuItemId: tart.id }, 'bot');
    await settle();
    expect(await statusesOf('venue_booking_created')).toMatchObject([{ status: 'failed', attempts: 1 }]);
  });

  it('expires rows past their deadline, also while the bot is not running', async () => {
    live = false;
    const { booking } = await services.bookings.create(GUEST, { menuItemId: tart.id }, 'miniapp');
    clock.set(new Date(booking.expiresAt.getTime() - SECOND));
    await outbox.deliverDue(clock.now());
    expect((await queuedNotifications(pool)).map((row) => row.status)).toEqual(['pending', 'pending']);

    clock.set(booking.expiresAt);
    await outbox.deliverDue(clock.now());
    expect((await queuedNotifications(pool)).map((row) => [row.kind, row.status])).toEqual([
      ['venue_booking_created', 'pending'],
      ['booking_confirmed', 'expired'],
    ]);
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it('skips the confirmation of a booking cancelled before the bot could send it', async () => {
    live = false;
    const { booking } = await services.bookings.create(GUEST, { menuItemId: tart.id }, 'miniapp');
    await services.bookings.cancel(GUEST, booking.id);
    await settle();
    live = true;
    await outbox.deliverDue(clock.now());

    expect((await queuedNotifications(pool)).map((row) => [row.kind, row.status, row.lastError])).toEqual([
      ['venue_booking_created', 'sent', null],
      ['booking_confirmed', 'skipped', 'booking is no longer active'],
      ['venue_booking_cancelled', 'sent', null],
    ]);
  });

  it('counts the outcomes for the metrics', async () => {
    const before = await stats.metrics[0]?.get();
    const sentBefore =
      before?.values.find((value) => value.labels.kind === 'venue_booking_created')?.value ?? 0;
    await services.bookings.create(GUEST, { menuItemId: tart.id }, 'bot');
    await settle();
    const after = await stats.metrics[0]?.get();
    expect(
      after?.values.find(
        (value) => value.labels.kind === 'venue_booking_created' && value.labels.result === 'sent',
      )?.value,
    ).toBe(sentBefore + 1);
  });
});

describe('booking reminders', () => {
  const remind = bookingRemindersJob(pool, outbox);

  it('reminds about a one hour booking once ten minutes before the end', async () => {
    const { booking } = await services.bookings.create(GUEST, { menuItemId: tart.id }, 'bot');
    await settle();
    sendToUser.mockClear();

    clock.set(new Date(booking.expiresAt.getTime() - 10 * MINUTE - SECOND));
    await remind.run(clock.now());
    await deliver();
    expect(sendToUser).not.toHaveBeenCalled();

    clock.advance(SECOND);
    await remind.run(clock.now());
    await deliver();
    clock.advance(MINUTE);
    await remind.run(clock.now());
    await deliver();

    expect(sentTo()).toEqual([
      [
        GUEST,
        `Бронь ${booking.code} действует ещё 10 минут, до 13:00: Тарт, Кофейня «Зерно», ул. Баумана, 36.`,
      ],
    ]);
  });

  it('does not remind about a 15 minute booking', async () => {
    const short = await seedDeal(pool, tart, {
      quantity: 3,
      startsAt: later(-HOUR),
      endsAt: later(15 * MINUTE),
    });
    const { booking } = await services.bookings.create(
      GUEST,
      { menuItemId: tart.id, dealId: short.id },
      'bot',
    );
    expect(booking.expiresAt).toEqual(later(15 * MINUTE));
    clock.advance(6 * MINUTE);
    await remind.run(clock.now());
    expect(await statusesOf('booking_reminder')).toEqual([]);
  });

  it('skips a reminder for a booking redeemed before it went out', async () => {
    live = false;
    const { booking } = await services.bookings.create(GUEST, { menuItemId: tart.id }, 'bot');
    clock.set(new Date(booking.expiresAt.getTime() - 5 * MINUTE));
    await remind.run(clock.now());
    await services.bookings.redeem(OWNER, booking.code);
    await settle();
    live = true;
    await outbox.deliverDue(clock.now());

    expect(await statusesOf('booking_reminder')).toMatchObject([
      { status: 'skipped', lastError: 'booking is no longer active' },
    ]);
  });
});

describe('deal events', () => {
  it('tells the owner once that the deal is fully booked', async () => {
    await services.bookings.create(GUEST, { menuItemId: eclair.id, dealId: deal.id }, 'bot');
    const last = await services.bookings.create(
      SECOND_GUEST,
      { menuItemId: eclair.id, dealId: deal.id },
      'bot',
    );
    await services.bookings.cancel(SECOND_GUEST, last.booking.id);
    await services.bookings.create(SECOND_GUEST, { menuItemId: eclair.id, dealId: deal.id }, 'bot');
    await settle();

    const soldOut = sentTo().filter(([, text]) => text.startsWith('Горящая позиция забронирована целиком'));
    expect(soldOut).toEqual([
      [
        OWNER,
        'Горящая позиция забронирована целиком: Эклер, 2 шт. по 120 ₽. Новые брони появятся, только если гость отменит свою или она истечёт.',
      ],
    ]);
  });

  it('warns once that a live deal ends soon, but not for a cancelled or sold out one', async () => {
    const remind = dealEndingRemindersJob(pool, outbox);
    const ending = await seedDeal(pool, tart, {
      priceRub: 150,
      quantity: 4,
      startsAt: later(-HOUR),
      endsAt: later(20 * MINUTE),
    });
    const cancelledItem = await seedMenuItem(pool, venue.id, { name: 'Морс', priceRub: 90 });
    const cancelled = await seedDeal(pool, cancelledItem, {
      quantity: 2,
      startsAt: later(-HOUR),
      endsAt: later(20 * MINUTE),
    });
    await deals.cancelLiveInVenue(pool, venue.id, cancelled.id, clock.now());
    const soldItem = await seedMenuItem(pool, venue.id, { name: 'Сок', priceRub: 90 });
    const sold = await seedDeal(pool, soldItem, {
      quantity: 1,
      startsAt: later(-HOUR),
      endsAt: later(20 * MINUTE),
    });
    await deals.update(pool, sold.id, { quantityLeft: 0, endsAt: sold.endsAt });

    await remind.run(clock.now());
    await settle();
    clock.advance(5 * MINUTE);
    await remind.run(clock.now());
    await deliver();

    expect(sentTo()).toEqual([
      [
        OWNER,
        'Горящая позиция «Тарт» закончится в 12:20, осталось 4 из 4. Продлить до закрытия можно в кабинете.',
      ],
    ]);
    expect((await statusesOf('venue_deal_ending')).map((row) => row.subject)).toEqual([
      { dealId: ending.id },
    ]);
  });
});

describe('expiry and account deletion', () => {
  it('tells the guest and the owner when a booking expires', async () => {
    const { booking } = await services.bookings.create(
      GUEST,
      { menuItemId: eclair.id, dealId: deal.id },
      'bot',
    );
    await settle();
    sendToUser.mockClear();
    clock.set(booking.expiresAt);
    await services.bookings.expireDue({});
    await settle();

    expect(sentTo()).toEqual([
      [GUEST, `Бронь ${booking.code} истекла в 13:00: Эклер, Кофейня «Зерно». Код больше не действует.`],
      [
        OWNER,
        `Бронь ${booking.code} истекла в 13:00: Эклер. Гость не пришёл.\nПорция вернулась в горящее предложение.`,
      ],
    ]);
  });

  it('tells the owner about the bookings of a deleted guest and drops the guest rows', async () => {
    live = false;
    const { booking } = await services.bookings.create(
      GUEST,
      { menuItemId: eclair.id, dealId: deal.id },
      'miniapp',
    );
    expect((await queuedNotifications(pool)).map((row) => row.userId)).toEqual([OWNER, GUEST]);

    await services.account.deleteAccount(GUEST);

    expect((await queuedNotifications(pool)).map((row) => [row.userId, row.kind])).toEqual([
      [OWNER, 'venue_booking_created'],
      [OWNER, 'venue_booking_cancelled'],
    ]);
    await settle();
    live = true;
    await outbox.deliverDue(clock.now());
    expect(sentTo().at(-1)).toEqual([
      OWNER,
      `Гость отменил бронь ${booking.code}: Эклер.\nПорция вернулась в горящее предложение.`,
    ]);
  });
});

describe('menu import result', () => {
  const syrniki = { ...parsedItem({ name: 'Сырники', kcal: 420 }), priceRub: 350 };
  const recognized: MenuParseResult = {
    status: 'parsed',
    venueName: 'Зерно',
    items: [syrniki],
    model: 'test-model',
  };

  function lastMessage(): OutgoingMessage | undefined {
    return sendToUser.mock.calls.at(-1)?.[1];
  }

  it('sends the result of a recognition that took four minutes', async () => {
    const { promise, resolve } = Promise.withResolvers<MenuParseResult>();
    menus.fromPhoto.mockReturnValue(promise);
    const started = await services.menuImports.fromPhoto(OWNER, Buffer.from('jpeg'));
    clock.advance(4 * MINUTE);
    resolve(recognized);
    await settle();

    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(lastMessage()).toMatchObject({
      text: expect.stringMatching(/^Распознал 1 позицию:\nСырники, 350 ₽, около 420 ккал/) as unknown,
      notify: true,
      buttons: [
        [{ kind: 'callback', text: 'Добавить всё', payload: `vn:imp:apply:${String(started.id)}` }],
        [
          {
            kind: 'link',
            text: 'Открыть в кабинете',
            url: `https://max.ru/ppshkin_bot?startapp=import_${String(started.id)}`,
          },
        ],
        [{ kind: 'callback', text: 'Загрузить заново', payload: 'vn:menu:upload' }],
      ],
    });
  });

  it('sends the failure of an import closed by fail_stale_imports', async () => {
    const { promise, resolve } = Promise.withResolvers<MenuParseResult>();
    menus.fromText.mockReturnValue(promise);
    await services.menuImports.fromText(OWNER, 'Сырники 350 ₽');
    clock.advance(31 * MINUTE);
    await services.menuImports.failStale(clock.now());
    resolve(recognized);
    await settle();

    expect(sendToUser).toHaveBeenCalledTimes(1);

    expect(lastMessage()).toMatchObject({
      text: 'Не успели распознать меню, попробуйте фото получше или вставьте текст',
      buttons: [[{ kind: 'callback', text: 'Попробовать ещё раз', payload: 'vn:menu:upload' }]],
    });
  });

  it('skips the result once the import is applied from the mini app', async () => {
    live = false;
    menus.fromText.mockResolvedValue(recognized);
    const started = await services.menuImports.fromText(OWNER, 'Сырники 350 ₽');
    await settle();
    await services.menuImports.apply(OWNER, started.id, [syrniki]);
    await settle();
    live = true;
    await outbox.deliverDue(clock.now());

    expect(sendToUser).not.toHaveBeenCalled();
    expect(await statusesOf('menu_import_done')).toMatchObject([
      { status: 'skipped', lastError: 'menu import is already applied' },
    ]);
  });
});

describe('purge_notifications job', () => {
  it('deletes rows older than 30 days', async () => {
    await services.bookings.create(GUEST, { menuItemId: tart.id }, 'bot');
    await settle();
    clock.set('2026-10-25T09:00:00Z');
    await services.bookings.create(SECOND_GUEST, { menuItemId: tart.id }, 'bot');
    await settle();

    await purgeNotificationsJob(pool).run(new Date('2026-10-25T09:00:01Z'));

    expect((await queuedNotifications(pool)).map((row) => row.kind)).toEqual(['venue_booking_created']);
    expect(await queuedNotifications(pool)).toHaveLength(1);
  });
});

describe('notification settings', () => {
  it('does not queue a kind the user turned off and skips one turned off after queueing', async () => {
    await services.notificationSettings.update(OWNER, {
      kinds: [{ kind: 'venue_booking_created', enabled: false }],
    });
    await services.bookings.create(GUEST, { menuItemId: tart.id }, 'bot');
    expect(await statusesOf('venue_booking_created')).toEqual([]);

    live = false;
    await services.notificationSettings.update(OWNER, {
      kinds: [{ kind: 'venue_booking_created', enabled: true }],
    });
    await services.bookings.create(SECOND_GUEST, { menuItemId: tart.id }, 'bot');
    await services.notificationSettings.update(OWNER, {
      kinds: [{ kind: 'venue_booking_created', enabled: false }],
    });
    await settle();
    live = true;
    await outbox.deliverDue(clock.now());

    expect(sendToUser).not.toHaveBeenCalled();
    expect(await statusesOf('venue_booking_created')).toMatchObject([
      { status: 'skipped', lastError: 'the user turned this kind off' },
    ]);
  });

  it('sends urgent messages without sound during the quiet hours of the recipient', async () => {
    await services.notificationSettings.update(OWNER, { quietHours: { from: '12:00', until: '13:00' } });

    await services.bookings.create(GUEST, { menuItemId: tart.id }, 'miniapp');
    await settle();

    expect(sendToUser.mock.calls.map(([userId, message]) => [userId, message.notify])).toEqual([
      [OWNER, false],
      [GUEST, true],
    ]);
    expect((await queuedNotifications(pool)).map((row) => [row.userId, row.silent])).toEqual([
      [OWNER, true],
      [GUEST, false],
    ]);
  });

  it('moves a report out of the quiet hours to their end', async () => {
    clock.set('2026-09-25T23:30:00+03:00');
    await outbox.enqueue(
      pool,
      { kind: 'venue_report_ready', venue, period: 'day', date: '2026-09-25' },
      clock.now(),
    );

    expect(await statusesOf('venue_report_ready')).toMatchObject([
      { status: 'pending', silent: false, sendAfter: new Date('2026-09-26T09:00:00+03:00') },
    ]);
  });
});
