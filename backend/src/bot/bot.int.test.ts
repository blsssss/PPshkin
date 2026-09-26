import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { answers, botChat, GUEST_ID, guestWorld, sent, texts } from '../../test/bot.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { testConfig } from '../../test/services.ts';
import { createServices } from '../container.ts';
import { createDedupingHandler } from '../integrations/max/dedupe.ts';
import type { IncomingEvent } from '../ports/messenger.ts';
import type { DishRecognition, Recognition } from '../ports/recognition.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { createBot } from './index.ts';
import { createChatStateStore } from './state.ts';

const pool = testPool();

beforeEach(async () => {
  await resetDatabase(pool);
});

afterAll(async () => {
  await closeTestPool();
});

const BORSCHT: DishRecognition = {
  status: 'recognized',
  basis: 'Свекольный суп со сметаной',
  model: 'test-model',
  items: [
    {
      title: 'Борщ со сметаной',
      portionG: 350,
      kcalMin: 300,
      kcalMax: 360,
      proteinG: 12,
      fatG: 15,
      carbsG: 25,
      tags: ['soup'],
      confidence: 0.9,
    },
  ],
};

function realChat() {
  const world = guestWorld();
  const recognition: Recognition = {
    dishes: {
      fromPhoto: vi.fn(() => Promise.resolve(BORSCHT)),
      fromText: vi.fn(() => Promise.resolve(BORSCHT)),
    },
    menus: {
      fromPhoto: () => Promise.reject(new Error('menus are not used by the guest bot')),
      fromText: () => Promise.reject(new Error('menus are not used by the guest bot')),
    },
  };
  Object.assign(
    world.services,
    createServices({
      config: testConfig(),
      pool,
      clock: world.clock,
      recognition,
      background: createBackgroundTasks({ error: vi.fn() }),
    }),
  );
  const states = createChatStateStore(pool);
  const chat = botChat({
    world,
    pool,
    createHandler: (deps) => createDedupingHandler(pool, createBot({ ...deps, states })),
  });
  return { chat, recognition, states };
}

async function count(sql: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(sql, [GUEST_ID]);
  return rows[0]?.count ?? 0;
}

describe('guest bot on Postgres', () => {
  it('onboards a guest, logs meals and deletes the account', async () => {
    const { chat, recognition, states } = realChat();

    await chat.send('/start');
    await chat.press('cs:pd:ok');
    await chat.press('cs:ad:no:ob');
    await chat.press('ob:goal:lose');
    await chat.press('ob:kcal:1800');
    await chat.location({ lat: 55.788712, lon: 49.122134 });

    const { rows: users } = await pool.query(
      'select kcal_target, goal, location_lat, location_lon from users where id = $1',
      [GUEST_ID],
    );
    expect(users).toEqual([{ kcal_target: 1800, goal: 'lose', location_lat: 55.79, location_lon: 49.12 }]);
    expect(
      await count(`select count(*)::int as count from consents where user_id = $1 and revoked_at is null`),
    ).toBe(1);
    expect((await states.load(GUEST_ID)).flow).toBeNull();

    const photo = await chat.photo();
    expect(recognition.dishes.fromPhoto).toHaveBeenCalledWith(Buffer.from('jpeg bytes'));
    expect(texts(photo).at(-1)).toContain('Сегодня около 330 из 1800 ккал, осталось около 1470 ккал');

    const manual = await chat.send('Сырники 350');
    expect(texts(manual)[0]).toContain('Сегодня около 680 из 1800 ккал');
    expect(await count('select count(*)::int as count from meals where user_id = $1')).toBe(2);

    await chat.press('ml:del:2');
    const [today] = sent(await chat.send('/today'));
    expect(today?.text).toContain('**Борщ со сметаной**, 300-360 ккал');
    expect(today?.text).not.toContain('Сырники');

    await chat.send('/delete');
    const deleted = await chat.press('ac:del_ok');
    expect(answers(deleted)[0]?.message?.text).toBe('Данные удалены. Чтобы начать заново, отправьте /start.');
    expect(await count('select count(*)::int as count from users where id = $1')).toBe(0);
    expect(await count('select count(*)::int as count from meals where user_id = $1')).toBe(0);
    expect(await count('select count(*)::int as count from chat_states where user_id = $1')).toBe(0);
  });

  it('handles a redelivered event once', async () => {
    const { chat } = realChat();
    const event: IncomingEvent = {
      type: 'message',
      key: 'message_created:mid.guest:1790000000000',
      user: { id: GUEST_ID, firstName: 'Анна', username: null },
      chatId: 5101,
      messageId: 'mid.guest',
      text: '/help',
      photos: [],
      location: null,
    };

    expect(await chat.deliver(event)).toHaveLength(1);
    expect(await chat.deliver(event)).toEqual([]);
    expect(await count('select count(*)::int as count from users where id = $1')).toBe(1);
  });

  it('keeps the dialog state between updates', async () => {
    const { chat, states } = realChat();
    await chat.send('/start');
    await chat.press('cs:pd:ok');

    await chat.send('что-то вкусное');
    expect((await states.load(GUEST_ID)).flow).toMatchObject({
      name: 'meal_text_confirm',
      text: 'что-то вкусное',
    });

    const accepted = await chat.press('ml:text:yes');
    expect(texts(accepted).at(-1)).toContain('Записал: **Борщ со сметаной**');
    expect((await states.load(GUEST_ID)).flow).toBeNull();
  });
});
