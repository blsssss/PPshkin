import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { answers, botChat, guestWorld, sent, texts } from '../../../test/bot.ts';
import { seedGuest } from '../../../test/bookings.ts';
import { closeTestPool, resetDatabase, testPool } from '../../../test/database.ts';
import { testConfig } from '../../../test/services.ts';
import { OWNER_ID } from '../../../test/venue-bot.ts';
import { createServices } from '../../container.ts';
import { createDedupingHandler } from '../../integrations/max/dedupe.ts';
import { createRecognition } from '../../recognition/index.ts';
import { createBackgroundTasks } from '../../shared/background.ts';
import { createBot } from '../index.ts';
import { createChatStateStore } from '../state.ts';

const pool = testPool();
const GUEST = 303;
const MENU = ['Эклер 80 г 200 ₽', 'Капучино 250 мл 180 ₽'].join('\n');

beforeEach(async () => {
  await resetDatabase(pool);
});

afterAll(async () => {
  await closeTestPool();
});

function realVenueChat() {
  const config = testConfig();
  const world = guestWorld();
  const recognitionTasks = createBackgroundTasks({ error: vi.fn() });
  const services = createServices({
    config,
    pool,
    clock: world.clock,
    recognition: createRecognition({
      apiKey: undefined,
      baseUrl: config.CHADGPT_BASE_URL,
      visionModel: config.CHADGPT_MODEL,
      fallbackModel: config.CHADGPT_FALLBACK_MODEL,
      timeoutMs: config.CHADGPT_TIMEOUT_MS,
      menuTimeoutMs: config.CHADGPT_MENU_TIMEOUT_MS,
    }),
    background: recognitionTasks,
  });
  Object.assign(world.services, services);
  const states = createChatStateStore(pool);
  const chat = botChat({
    world,
    pool,
    createHandler: (deps) => createDedupingHandler(pool, createBot({ ...deps, states })),
  });
  const settle = async () => {
    await recognitionTasks.idle();
    await chat.background.idle();
    return chat.takeOutgoing();
  };
  return { chat, services, states, settle };
}

describe('venue bot on Postgres', () => {
  it('connects a venue, imports the menu, publishes a deal and redeems a booking', async () => {
    const { chat, services, states, settle } = realVenueChat();
    await seedGuest(pool, OWNER_ID, chat.world.clock.now());
    await seedGuest(pool, GUEST, chat.world.clock.now());

    await chat.send('/venue');
    await chat.press('vn:new');
    await chat.send('Кофейня «Зерно»');
    await chat.send('ул. Баумана, 36');
    await chat.location({ lat: 55.788712, lon: 49.122134 });
    await chat.press('vn:new:cat:coffee');
    await chat.press('vn:new:hours:0800_2200');
    const created = await chat.press('vn:new:ok');
    expect(texts(created).at(-1)).toBe(
      'Заведение создано. Следующий шаг: загрузите меню, это займёт минуту.',
    );
    const { rows: venues } = await pool.query(
      'select owner_id, lat, lon, opens_at, closes_at from venues where owner_id = $1',
      [OWNER_ID],
    );
    expect(venues).toEqual([
      { owner_id: OWNER_ID, lat: 55.788712, lon: 49.122134, opens_at: '08:00:00', closes_at: '22:00:00' },
    ]);
    const { rows: owners } = await pool.query('select location_lat from users where id = $1', [OWNER_ID]);
    expect(owners).toEqual([{ location_lat: null }]);

    await chat.press('vn:menu:upload');
    const [started, summary] = sent([...(await chat.send(MENU)), ...(await settle())]);
    expect(started?.text).toBe('Разбираю меню, это несколько секунд.');
    expect(summary?.text).toMatch(/^Распознал 2 позиции:\nЭклер, 200 ₽, около \d+ ккал\nКапучино, 180 ₽, /);

    const applied = await chat.press(summary?.buttons[0]?.[0]?.payload ?? '');
    expect(texts(applied).at(-1)).toBe('Добавлено 2 позиции.');
    const menu = await services.menu.list(OWNER_ID);
    expect(menu.map((item) => [item.name, item.priceRub, item.nutritionSource])).toEqual([
      ['Эклер', 200, 'estimate'],
      ['Капучино', 180, 'estimate'],
    ]);

    await chat.press('vn:dl:new');
    const eclair = menu[0]!;
    await chat.press(`vn:dl:item:${eclair.id}`);
    await chat.press('vn:dl:qty:3');
    await chat.press('vn:dl:disc:40');
    await chat.press('vn:dl:until:120');
    const published = await chat.press('vn:dl:ok');
    expect(texts(published).at(-1)).toMatch(/^Опубликовано\. Гости рядом увидят предложение в подборе\./);
    const [deal] = await services.deals.list(OWNER_ID, 'active');
    expect(deal?.deal).toMatchObject({ priceRub: 120, quantityTotal: 3, quantityLeft: 3 });

    const booking = await services.bookings.create(GUEST, { menuItemId: eclair.id, dealId: deal?.deal.id });
    const [list] = answers(await chat.press('vn:bk', 'mid.home'));
    expect(list?.message?.text).toContain(`${booking.booking.code}: Эклер, 120 ₽, до`);

    await chat.press('vn:redeem', 'mid.home');
    const typed = `${booking.booking.code.slice(0, 3).toLowerCase()} ${booking.booking.code.slice(3).toLowerCase()}`;
    expect(texts(await chat.send(typed))).toEqual([
      'Погашено: Эклер, 120 ₽. Блюдо добавлено гостю в дневник.',
    ]);
    expect(texts(await chat.send('/venue')).at(-1)).toContain('Активных броней: 0, горящих позиций: 1');
    const { rows: meals } = await pool.query('select title, source from meals where user_id = $1', [GUEST]);
    expect(meals).toEqual([{ title: 'Эклер', source: 'booking' }]);
    expect((await states.load(OWNER_ID)).flow).toBeNull();

    const [stats] = answers(await chat.press('vn:stats:today', 'mid.home'));
    expect(stats?.message?.text).toContain('Броней: 1, погашено 1 (100%), истекло 0, отменено 0');
    expect(stats?.message?.text).toContain('Горящее: продано 1 шт. на 120 ₽');
    expect(stats?.message?.text).toContain('Топ: Эклер (1)');
  });
});
