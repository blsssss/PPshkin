import { describe, expect, it, vi } from 'vitest';
import { answers, botChat, GUEST_ID, labels, payloads, sent, texts } from '../../../test/bot.ts';
import { eclairOffer, offersWorld } from '../../../test/offers.ts';
import { fakeServices } from '../../../test/services.ts';
import { BAUMANA } from '../../../test/venues.ts';
import type { ModerationService } from '../../services/moderation.ts';
import { conflict } from '../../shared/errors.ts';

async function finishedBooking(overrides: Partial<ModerationService> = {}) {
  const world = offersWorld();
  world.user.location = BAUMANA;
  world.user.locationUpdatedAt = world.clock.now();
  const createComplaint = vi.fn<ModerationService['createComplaint']>(() =>
    Promise.resolve({
      id: 1,
      venueId: eclairOffer.venue.id,
      bookingId: 31,
      reason: 'not_served',
      status: 'open',
      createdAt: world.clock.now(),
      resolvedAt: null,
    }),
  );
  world.services.moderation = { ...fakeServices().moderation, createComplaint, ...overrides };
  const chat = botChat({ world, api: { uploadImage: () => Promise.resolve('qr-token') } });
  await world.bookings.create(GUEST_ID, { menuItemId: eclairOffer.item.id }, 'bot');
  await world.bookings.cancel(GUEST_ID, 31);
  return { chat, createComplaint };
}

describe('a problem with a booking in the bot', () => {
  it('offers the problem button for a finished booking in the history', async () => {
    const { chat } = await finishedBooking();
    const replies = sent(await chat.send('/bookings'));
    const history = replies.at(-1);
    expect(history?.text).toContain('История');
    expect(labels(history)).toEqual(['Проблема с бронью: K7M2QX']);
    expect(payloads(history)).toEqual(['cp:new:31']);
  });

  it('asks for the reason and files the complaint about that booking', async () => {
    const { chat, createComplaint } = await finishedBooking();
    const history = sent(await chat.send('/bookings')).at(-1);
    const asked = await chat.press('cp:new:31', history?.messageId);
    const question = answers(asked)[0]?.message;
    expect(question?.text).toBe('Что случилось с бронью?');
    expect(labels(question)).toEqual([
      'Не выдали заказ по брони',
      'Цена на кассе другая',
      'Заведение было закрыто',
      'Блюда не было в наличии',
      'Качество блюда',
      'Неверные сведения о заведении или меню',
      'Другое',
      'Отмена',
    ]);
    const done = await chat.press('cp:r:31:not_served', history?.messageId);
    expect(createComplaint).toHaveBeenCalledWith(GUEST_ID, {
      venueId: eclairOffer.venue.id,
      bookingId: 31,
      reason: 'not_served',
    });
    expect(texts(done)).toEqual(['Спасибо, разберёмся. Итог пришлю сообщением.']);
  });

  it('explains a duplicate and a daily limit without a generic error', async () => {
    for (const [code, text] of [
      ['complaint_exists', 'Жалоба на эту бронь уже отправлена.'],
      ['complaint_limit', 'Сегодня отправлено максимум жалоб, повторите завтра.'],
    ] as const) {
      const { chat } = await finishedBooking({
        createComplaint: () => Promise.reject(conflict(code, code)),
      });
      const history = sent(await chat.send('/bookings')).at(-1);
      expect(texts(await chat.press('cp:r:31:other', history?.messageId))).toEqual([text]);
    }
  });

  it('treats an unknown reason and a cancellation as stale or harmless', async () => {
    const { chat, createComplaint } = await finishedBooking();
    const history = sent(await chat.send('/bookings')).at(-1);
    const stale = await chat.press('cp:r:31:rude', history?.messageId);
    expect(answers(stale)[0]?.notification).toBe('Кнопка устарела');
    const cancelled = await chat.press('cp:x', history?.messageId);
    expect(texts(cancelled)).toEqual(['Хорошо, ничего не отправляю.']);
    expect(createComplaint).not.toHaveBeenCalled();
  });
});
