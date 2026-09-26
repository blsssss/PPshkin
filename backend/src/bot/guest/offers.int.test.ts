import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { answers, botChat, GUEST_ID, guestWorld, labels, sent, texts } from '../../../test/bot.ts';
import { closeTestPool, resetDatabase, testPool } from '../../../test/database.ts';
import { testConfig } from '../../../test/services.ts';
import { BAUMANA, seedDeal, seedMenuItem, seedUser, seedVenue } from '../../../test/venues.ts';
import { createServices } from '../../container.ts';
import { CONSENT_DOCUMENTS } from '../../domain/consents.ts';
import type { ConsentKind } from '../../domain/vocabulary.ts';
import type { Recognition } from '../../ports/recognition.ts';
import * as consents from '../../repositories/consents.ts';
import * as meals from '../../repositories/meals.ts';
import { createBackgroundTasks } from '../../shared/background.ts';
import { createBot } from '../index.ts';
import { createChatStateStore } from '../state.ts';

const pool = testPool();

beforeEach(async () => {
  await resetDatabase(pool);
});

afterAll(async () => {
  await closeTestPool();
});

const NOW = '2026-09-26T13:00:00Z';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const recognition: Recognition = {
  dishes: {
    fromPhoto: () =>
      Promise.resolve({
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
      }),
    fromText: () => Promise.reject(new Error('text is not used here')),
  },
  menus: {
    fromPhoto: () => Promise.reject(new Error('menus are not used by the guest bot')),
    fromText: () => Promise.reject(new Error('menus are not used by the guest bot')),
  },
};

async function seedGuest(now: Date): Promise<void> {
  await seedUser(pool, GUEST_ID, BAUMANA);
  await pool.query('update users set location_updated_at = $2 where id = $1', [
    GUEST_ID,
    new Date(now.getTime() - HOUR_MS),
  ]);
  for (const kind of ['personal_data', 'personalized_offers'] satisfies ConsentKind[]) {
    await consents.grant(
      pool,
      GUEST_ID,
      kind,
      CONSENT_DOCUMENTS[kind].version,
      'bot',
      new Date(now.getTime() - 5 * DAY_MS),
    );
  }
  for (const daysAgo of [1, 2, 3]) {
    const day = now.getTime() - daysAgo * DAY_MS;
    await meals.insert(pool, {
      userId: GUEST_ID,
      title: 'Суп дня',
      kcalMin: 350,
      kcalMax: 400,
      proteinG: 15,
      fatG: 12,
      carbsG: 40,
      tags: ['soup'],
      source: 'manual',
      confidence: null,
      eatenAt: new Date(day - 3 * HOUR_MS),
    });
    await meals.insert(pool, {
      userId: GUEST_ID,
      title: 'Чизкейк',
      kcalMin: 300,
      kcalMax: 320,
      proteinG: 6,
      fatG: 20,
      carbsG: 28,
      tags: ['dessert', 'sweet', 'cheese'],
      source: 'manual',
      confidence: null,
      eatenAt: new Date(day),
    });
  }
}

async function seedCafe(now: Date) {
  const venue = await seedVenue(pool, 202, { name: 'Кофейня «Точка»', location: BAUMANA });
  const cheesecake = await seedMenuItem(pool, venue.id, {
    name: 'Чизкейк Нью-Йорк',
    priceRub: 290,
    kcal: 310,
    tags: ['dessert', 'sweet', 'cheese'],
  });
  const deal = await seedDeal(pool, cheesecake, {
    priceRub: 170,
    quantity: 3,
    startsAt: new Date(now.getTime() - HOUR_MS),
    endsAt: new Date(now.getTime() + 4 * HOUR_MS),
  });
  return { venue, cheesecake, deal };
}

async function firstRow<Row>(sql: string, values: unknown[]): Promise<Row | undefined> {
  const { rows } = await pool.query<Row & Record<string, unknown>>(sql, values);
  return rows[0];
}

function realChat() {
  const world = guestWorld({ now: NOW });
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
  const uploadImage = vi.fn((_data: Buffer, _name: string, _type: string) => Promise.resolve('qr-token'));
  const states = createChatStateStore(pool);
  const chat = botChat({
    world,
    pool,
    api: { uploadImage },
    createHandler: (deps) => createBot({ ...deps, states }),
  });
  return { chat, uploadImage, states };
}

describe('guest offers on Postgres', () => {
  it('goes from a food photo to a suggestion, a booking with QR and its cancellation', async () => {
    const now = new Date(NOW);
    await seedGuest(now);
    const { cheesecake, deal } = await seedCafe(now);
    const { chat, uploadImage, states } = realChat();

    const logged = await chat.photo();
    const suggestion = sent(logged).at(-1);
    expect(texts(logged)[1]).toContain('Записал: **Борщ со сметаной**');
    expect(suggestion?.text).toContain('**Можно позволить десерт**\nЧизкейк Нью-Йорк');
    expect(suggestion?.text).toContain(
      'Кофейня «Точка», ул. Баумана, 36\n170 ₽, около 310 ккал, 50 м от вас',
    );
    expect(suggestion?.text).toContain('- Скидка 41%: 170 ₽ вместо 290 ₽, до 20:00');
    expect(labels(suggestion)).toEqual([
      'Забронировать',
      'Другое',
      'Не сегодня',
      'Не люблю такое',
      'Маршрут',
      'Не присылать подсказки',
    ]);
    const offer = await firstRow<{ id: number; channel: string; status: string }>(
      'select id, channel, status from offers where user_id = $1',
      [GUEST_ID],
    );
    expect(offer).toMatchObject({ channel: 'bot', status: 'shown' });
    const stored = await states.load(GUEST_ID);
    expect(stored.contextualOfferOn).toBe('2026-09-26');
    expect(stored.offerQueue?.cards.map((card) => card.offerId)).toEqual([offer?.id]);

    const booked = await chat.press(`bk:new:${cheesecake.id}:${deal.id}:${offer?.id ?? 0}`);
    expect(answers(booked)[0]?.message).toMatchObject({ text: suggestion?.text, buttons: [] });
    const [booking] = sent(booked);
    const saved = await firstRow<{ id: number; code: string; offer_id: number }>(
      'select id, code, offer_id from bookings where user_id = $1',
      [GUEST_ID],
    );
    expect(saved?.offer_id).toBe(offer?.id);
    expect(booking?.text).toBe(
      [
        `**Бронь ${saved?.code ?? ''}**`,
        'Чизкейк Нью-Йорк, 170 ₽',
        'Кофейня «Точка», ул. Баумана, 36',
        'Действует до 17:00. Покажите код или QR на кассе.',
      ].join('\n'),
    );
    expect(booking?.images).toEqual(['qr-token']);
    const [png, filename] = uploadImage.mock.calls[0] ?? [];
    expect(png?.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
    expect(filename).toBe(`booking-${saved?.code ?? ''}.png`);
    expect(await firstRow('select status from offers where id = $1', [offer?.id])).toEqual({
      status: 'accepted',
    });
    expect(await firstRow('select quantity_left from deals where id = $1', [deal.id])).toEqual({
      quantity_left: 2,
    });

    const question = await chat.press(`bk:cancel:${saved?.id ?? 0}`, booking?.messageId);
    expect(answers(question)[0]?.message?.text).toBe(`Отменить бронь ${saved?.code ?? ''}?`);
    const cancelled = await chat.press(`bk:cancel_ok:${saved?.id ?? 0}`, booking?.messageId);
    expect(answers(cancelled)[0]?.message?.text).toBe(`Бронь ${saved?.code ?? ''} отменена.`);
    expect(await firstRow('select status from bookings where id = $1', [saved?.id])).toEqual({
      status: 'cancelled',
    });
    expect(await firstRow('select quantity_left from deals where id = $1', [deal.id])).toEqual({
      quantity_left: 3,
    });

    expect(texts(await chat.send('/bookings'))).toEqual([
      'Активных броней нет. Подобрать блюдо: /eat',
      '**История**\n26.09 Чизкейк Нью-Йорк, Кофейня «Точка»: отменена',
    ]);
  });

  it('asks for a location, searches nearby and hides a disliked tag', async () => {
    const now = new Date(NOW);
    await seedGuest(now);
    await pool.query(
      'update users set location_lat = null, location_lon = null, location_updated_at = null where id = $1',
      [GUEST_ID],
    );
    await seedCafe(now);
    const { chat, states } = realChat();

    expect(texts(await chat.send('/eat'))).toEqual(['Где вы? Отправьте местоположение, чтобы искать рядом.']);
    const [card] = sent(await chat.location({ lat: 55.788712, lon: 49.122134 }));
    expect(card?.text).toContain('Чизкейк Нью-Йорк');
    expect(card?.text).toContain('от вас');
    expect((await states.load(GUEST_ID)).flow).toBeNull();

    const disliked = await chat.press(labelPayload(card, 'Не люблю такое'), card?.messageId);
    expect(answers(disliked)[0]?.message?.text).toBe('Понял, это блюдо больше не предложу.');
    await chat.press('pf:tag:add:cheese:dessert,sweet,cheese');
    expect(await firstRow('select disliked_tags from users where id = $1', [GUEST_ID])).toEqual({
      disliked_tags: ['cheese'],
    });
    expect(
      await firstRow("select status, decline_reason from offers where user_id = $1 and status <> 'shown'", [
        GUEST_ID,
      ]),
    ).toEqual({ status: 'declined', decline_reason: 'dislike' });

    const [after] = sent(await chat.send('/eat'));
    expect(after?.text).toContain('Сейчас рядом нет подходящих блюд');
  });
});

function labelPayload(screen: ReturnType<typeof sent>[number] | undefined, label: string): string {
  const button = screen?.buttons.flat().find((candidate) => candidate.text === label);
  if (button?.payload === undefined) throw new Error(`No button ${label}`);
  return button.payload;
}
