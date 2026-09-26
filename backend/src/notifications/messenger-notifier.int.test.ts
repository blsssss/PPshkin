import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedGuest } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { fakeLogger } from '../../test/max-api.ts';
import { testConfig } from '../../test/services.ts';
import { seedDeal, seedMenuItem, seedVenue } from '../../test/venues.ts';
import { createServices } from '../container.ts';
import type { Messenger } from '../ports/messenger.ts';
import { createRecognition } from '../recognition/index.ts';
import type { Services } from '../services/index.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { createMessengerNotifier } from './messenger-notifier.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const OWNER = 202;
const GUEST = 101;
const HOUR = 3_600_000;

const notStubbed = (name: string) => () => Promise.reject(new Error(`${name} is not stubbed`));
const sendToUser = vi.fn<Messenger['sendToUser']>(() => Promise.resolve({ messageId: 'mid.1' }));
const messenger: Messenger = {
  sendToUser,
  editMessage: notStubbed('editMessage'),
  answerCallback: notStubbed('answerCallback'),
  uploadImage: notStubbed('uploadImage'),
  sendTyping: notStubbed('sendTyping'),
  downloadFile: notStubbed('downloadFile'),
};
const config = testConfig();
const background = createBackgroundTasks({ error: () => undefined });
const notifier = createMessengerNotifier({
  messenger: () => messenger,
  diaryDay: (userId) => services.diary.day(userId),
  logger: fakeLogger(),
});
const services: Services = createServices({
  config,
  pool,
  clock,
  recognition: createRecognition({
    apiKey: undefined,
    baseUrl: config.CHADGPT_BASE_URL,
    visionModel: config.CHADGPT_MODEL,
    fallbackModel: config.CHADGPT_FALLBACK_MODEL,
    timeoutMs: config.CHADGPT_TIMEOUT_MS,
    menuTimeoutMs: config.CHADGPT_MENU_TIMEOUT_MS,
  }),
  background,
  notifier,
});

beforeEach(async () => {
  await resetDatabase(pool);
  sendToUser.mockClear();
});

afterAll(async () => {
  await closeTestPool();
});

describe('booking notifications through the container', () => {
  it('tells the owner about the booking and the guest about the redeemed dish in the diary', async () => {
    const venue = await seedVenue(pool, OWNER);
    const eclair = await seedMenuItem(pool, venue.id);
    const deal = await seedDeal(pool, eclair, {
      priceRub: 120,
      startsAt: new Date(clock.now().getTime() - HOUR),
      endsAt: new Date(clock.now().getTime() + 5 * HOUR),
    });
    await seedGuest(pool, GUEST, new Date('2026-09-24T09:00:00Z'));

    const { booking } = await services.bookings.create(GUEST, { menuItemId: eclair.id, dealId: deal.id });
    await background.idle();
    await services.bookings.redeem(OWNER, booking.code);
    await background.idle();

    expect(sendToUser.mock.calls.map(([userId, message]) => [userId, message.text])).toEqual([
      [OWNER, `**Новая бронь ${booking.code}**\nЭклер, 120 ₽\nДействует до 13:00`],
      [
        GUEST,
        'Приятного аппетита! В дневник записано: Эклер, около 330 ккал.\nСегодня около 330 из 2000 ккал, осталось около 1670 ккал',
      ],
    ]);
  });
});
