import { describe, expect, it } from 'vitest';
import { answers } from '../../../test/bot.ts';
import { analyticsFor, OWNER_ID, venueChat, type VenueChat } from '../../../test/venue-bot.ts';

const PERIOD_BUTTONS = [
  { type: 'callback', text: 'Сегодня', payload: 'vn:stats:today' },
  { type: 'callback', text: '7 дней', payload: 'vn:stats:week' },
];
const HOME = { type: 'callback', text: 'Главное меню', payload: 'vn:home' };

function ownerChat(options: Parameters<typeof venueChat>[0] = {}): VenueChat {
  const chat = venueChat(options);
  chat.fake.seedVenue();
  return chat;
}

describe('venue statistics', () => {
  it('shows today in the time zone of the venue', async () => {
    const chat = ownerChat({ now: '2026-09-25T21:30:00Z' });

    const [reply] = answers(await chat.press('vn:stats:today', 'mid.home'));

    expect(chat.fake.services.analytics.get).toHaveBeenCalledWith(OWNER_ID, {
      from: '2026-09-26',
      to: '2026-09-26',
    });
    expect(reply?.message?.text).toBe(
      [
        '**Статистика за сегодня, 26 сентября**',
        'Показов в подборе: 42, принято: 9 (21%)',
        'Броней: 9, погашено 7 (78%), истекло 1, отменено 1',
        'Выручка по погашенным броням: 1540 ₽',
        'Горящее: продано 5 шт. на 600 ₽',
        'Топ: Эклер (3), Капучино (2)',
      ].join('\n'),
    );
    expect(reply?.message?.buttons).toEqual([PERIOD_BUTTONS, [HOME]]);
  });

  it('shows the last seven days with the default period', async () => {
    const chat = ownerChat({ miniAppEnabled: true });

    const [reply] = answers(await chat.press('vn:stats:week', 'mid.stats'));

    expect(chat.fake.services.analytics.get).toHaveBeenCalledWith(OWNER_ID, {});
    expect(reply?.message?.text).toMatch(/^\*\*Статистика за 7 дней, 20-26 сентября\*\*\n/);
    expect(reply?.message?.buttons).toEqual([
      PERIOD_BUTTONS,
      [{ type: 'open_app', text: 'Открыть кабинет' }],
      [HOME],
    ]);
  });

  it('spells a period across two months', async () => {
    const chat = ownerChat({ now: '2026-10-02T09:00:00Z' });

    const [reply] = answers(await chat.press('vn:stats:week', 'mid.stats'));

    expect(reply?.message?.text).toMatch(/^\*\*Статистика за 7 дней, 26 сентября - 2 октября\*\*\n/);
  });

  it('rounds the rates and skips an empty top', async () => {
    const chat = ownerChat();
    chat.fake.state.analytics = analyticsFor({
      offersShown: 0,
      offersAccepted: 0,
      acceptRate: 0,
      bookingsCreated: 3,
      bookingsRedeemed: 2,
      redeemRate: 0.67,
      bookingsExpired: 0,
      bookingsCancelled: 1,
      revenueRub: 0,
      surplusUnitsSold: 0,
      surplusRevenueRub: 0,
      topItems: [],
    });

    const [reply] = answers(await chat.press('vn:stats:today', 'mid.home'));

    expect(reply?.message?.text).toBe(
      [
        '**Статистика за сегодня, 26 сентября**',
        'Показов в подборе: 0, принято: 0 (0%)',
        'Броней: 3, погашено 2 (67%), истекло 0, отменено 1',
        'Выручка по погашенным броням: 0 ₽',
        'Горящее: продано 0 шт. на 0 ₽',
      ].join('\n'),
    );
  });

  it('escapes item names in the top', async () => {
    const chat = ownerChat();
    chat.fake.state.analytics = analyticsFor({
      topItems: [{ menuItemId: 1, name: 'Торт *Прага*', redeemed: 4, revenueRub: 800 }],
    });

    const [reply] = answers(await chat.press('vn:stats:today', 'mid.home'));

    expect(reply?.message?.text).toContain('Топ: Торт \\*Прага\\* (4)');
  });

  it('ignores an unknown period', async () => {
    const chat = ownerChat();

    expect(answers(await chat.press('vn:stats:year', 'mid.home'))[0]?.notification).toBe('Кнопка устарела');
    expect(chat.fake.services.analytics.get).not.toHaveBeenCalled();
  });
});
