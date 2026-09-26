import { describe, expect, it } from 'vitest';
import { answers, texts } from '../../../test/bot.ts';
import { OWNER_ID, venueChat } from '../../../test/venue-bot.ts';
import { BOT_COMMANDS } from '../commands.ts';
import type { Flow } from '../state.ts';

const NO_VENUE = 'Сначала подключите заведение: /venue';

describe('venue module', () => {
  it('registers the venue command in the bot menu', () => {
    expect(BOT_COMMANDS).toContainEqual({ name: 'venue', description: 'Кабинет заведения' });
  });

  it.each([
    'vn:menu',
    'vn:menu:upload',
    'vn:imp:apply:5',
    'vn:deals',
    'vn:dl:new',
    'vn:dl:stop:5',
    'vn:dl:stop_ok:5',
    'vn:dl:keep',
    'vn:bk',
    'vn:redeem',
    'vn:rd:K7M2QX',
    'vn:rd_ok:K7M2QX',
    'vn:stats:today',
  ])('sends a user without a venue to /venue from %s', async (payload) => {
    const chat = venueChat();

    const replies = await chat.press(payload, 'mid.old');

    expect(replies).toEqual([
      {
        kind: 'answer',
        messageId: 'mid.old',
        notification: null,
        message: { text: NO_VENUE, buttons: [], images: [] },
      },
    ]);
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
  });

  it('sends a user whose venue is gone to /venue from a wizard step', async () => {
    const chat = venueChat();
    chat.states.put(OWNER_ID, {
      flow: {
        name: 'deal_wizard',
        step: 'quantity',
        page: 1,
        draft: { menuItemId: 11, itemName: 'Эклер', itemPriceRub: 200 },
        messageId: 'mid.wizard',
        expiresAt: '2026-09-26T09:30:00.000Z',
      },
      pendingStart: null,
    });

    const [reply] = answers(await chat.press('vn:dl:qty:5', 'mid.wizard'));

    expect(reply?.message?.text).toBe(NO_VENUE);
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
  });

  it.each<[Flow, 'send' | 'photo']>([
    [{ name: 'menu_upload' }, 'photo'],
    [{ name: 'redeem_input' }, 'send'],
    [
      {
        name: 'deal_wizard',
        step: 'quantity_input',
        page: 1,
        draft: { menuItemId: 11, itemName: 'Эклер', itemPriceRub: 200 },
        messageId: null,
      },
      'send',
    ],
  ])('stops the %j flow when the venue is gone', async (flow, input) => {
    const chat = venueChat();
    chat.states.put(OWNER_ID, {
      flow: { ...flow, expiresAt: '2026-09-26T09:30:00.000Z' },
      pendingStart: null,
    });

    const replies = input === 'photo' ? await chat.photo() : await chat.send('5');

    expect(texts(replies)).toEqual([NO_VENUE]);
    expect(chat.states.peek(OWNER_ID).flow).toBeNull();
    expect(chat.world.recognizePhoto).not.toHaveBeenCalled();
  });

  it('answers unknown venue buttons as stale', async () => {
    const chat = venueChat();
    chat.fake.seedVenue();

    expect(answers(await chat.press('vn:party', 'mid.old'))[0]?.notification).toBe('Кнопка устарела');
    expect(answers(await chat.press('vn:new:party', 'mid.old'))[0]?.notification).toBe('Кнопка устарела');
    expect(answers(await chat.press('vn:imp:reject:5', 'mid.old'))[0]?.notification).toBe('Кнопка устарела');
  });

  it('asks for the personal data consent before any venue button', async () => {
    const chat = venueChat();
    chat.world.consents.clear();

    const replies = await chat.press('vn:bk', 'mid.old');

    expect(answers(replies)[0]?.notification).toBe('Сначала нужно согласие на обработку данных');
    expect(chat.fake.services.bookings.listForVenue).not.toHaveBeenCalled();
  });

  it('lets guest flows keep working next to the venue module', async () => {
    const chat = venueChat();
    chat.fake.seedVenue();

    expect(texts(await chat.send('Сырники 350'))[0]).toContain('Записал: **Сырники**');
    expect(chat.world.meals).toHaveLength(1);
  });
});
