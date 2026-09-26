import { describe, expect, it, vi } from 'vitest';
import { answers, botChat, GUEST_ID, guestWorld, labels, payloads, sent, texts } from '../../../test/bot.ts';
import { fakeDemo } from '../../../test/demo.ts';
import { CONSENT_DOCUMENTS } from '../../domain/consents.ts';
import { sampleVenue } from '../../../test/venues.ts';

const ONBOARDING_DONE =
  'Готово! Пришлите фото блюда или напишите, что съели, например: Сырники 350 или съел борщ. Спросить, что поесть: /eat.';

describe('onboarding', () => {
  it('walks a new guest from /start to the first meal hint', async () => {
    const chat = botChat();

    const greeting = sent(await chat.send('/start'));
    expect(greeting.map((message) => message.text)).toEqual([
      'Привет! Я ППшкин. Записываю еду по фото, примерно считаю калории и подсказываю блюдо в кафе рядом, которое впишется в ваш день.',
      expect.stringContaining('Чтобы вести дневник, нужно ваше согласие на обработку персональных данных.'),
    ]);
    expect(greeting[1]?.text).toContain('Отозвать согласие и удалить данные: /delete.');
    expect(payloads(greeting[1])).toEqual(['cs:pd:ok', 'cs:pd:more']);
    expect(labels(greeting[1])).toEqual(['Согласен', 'Подробнее']);

    const consent = await chat.press('cs:pd:ok');
    expect(answers(consent)).toEqual([
      expect.objectContaining({
        notification: null,
        message: expect.objectContaining({
          text: expect.stringContaining('Согласие получено, спасибо!') as unknown,
          buttons: [],
        }) as unknown,
      }),
    ]);
    expect(chat.world.consents.get('personal_data')).toBe(CONSENT_DOCUMENTS.personal_data.version);
    const offers = sent(consent);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.text).toContain('**Согласие на персональные предложения**');
    expect(offers[0]?.text).toContain('Присылать?');
    expect(labels(offers[0])).toEqual(['Да, присылать', 'Нет, спасибо']);
    expect(payloads(offers[0])).toEqual(['cs:ad:yes:ob', 'cs:ad:no:ob']);

    const declined = await chat.press('cs:ad:no:ob');
    expect(answers(declined)[0]?.message?.text).toBe(
      'Хорошо, без персональных предложений. Включить можно в /profile.',
    );
    expect(chat.world.consents.has('personalized_offers')).toBe(false);
    const goal = sent(declined)[0];
    expect(goal?.text).toBe('Какая у вас цель?');
    expect(labels(goal)).toEqual(['Снизить вес', 'Поддерживать вес', 'Набрать вес', 'Пропустить']);
    expect(payloads(goal)).toEqual(['ob:goal:lose', 'ob:goal:maintain', 'ob:goal:gain', 'ob:goal:skip']);

    const chosenGoal = await chat.press('ob:goal:lose');
    expect(answers(chosenGoal)[0]?.message?.text).toBe('Цель: снизить вес.');
    expect(chat.world.user.goal).toBe('lose');
    const kcal = sent(chosenGoal)[0];
    expect(kcal?.text).toBe(
      'Сколько ккал в день взять за ориентир? Это ориентир для подсказок, а не медицинская норма. Изменить можно в /profile.',
    );
    expect(payloads(kcal)).toEqual([
      'ob:kcal:1600',
      'ob:kcal:1800',
      'ob:kcal:2000',
      'ob:kcal:2200',
      'ob:kcal:2500',
      'ob:kcal:custom',
    ]);
    expect(labels(kcal)).not.toContain('Рассчитать');

    const target = await chat.press('ob:kcal:1800');
    expect(answers(target)[0]?.message?.text).toBe('Ориентир: 1800 ккал в день.');
    expect(chat.world.user.kcalTarget).toBe(1800);
    const location = sent(target)[0];
    expect(location?.text).toBe(
      'Поделитесь местоположением, чтобы я искал места рядом. Храню его с точностью около 1 км. Без него ищу по всему городу.',
    );
    expect(location?.buttons).toEqual([
      [{ type: 'request_geo_location', text: 'Отправить местоположение' }],
      [{ type: 'callback', text: 'Пропустить', payload: 'ob:loc:skip' }],
    ]);
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'onboarding_location' });

    const shared = await chat.location({ lat: 55.78871, lon: 49.12214 });
    expect(texts(shared)).toEqual([
      'Местоположение сохранено, храню его с точностью около 1 км.',
      ONBOARDING_DONE,
    ]);
    expect(labels(sent(shared)[1])).toEqual(['Что поесть?', 'Помощь']);
    expect(payloads(sent(shared)[1])).toEqual(['cmd:eat', 'cmd:help']);
    expect(chat.world.user.location).toEqual({ lat: 55.79, lon: 49.12 });
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
  });

  it('grants personalized offers and lets the guest skip the goal and the location', async () => {
    const chat = botChat({ miniAppEnabled: true });
    await chat.start();
    await chat.press('cs:pd:ok');

    const accepted = await chat.press('cs:ad:yes:ob');
    expect(answers(accepted)[0]?.message?.text).toContain('Согласие получено. Отключить можно в /profile.');
    expect(chat.world.consents.has('personalized_offers')).toBe(true);

    const skipped = await chat.press('ob:goal:skip');
    expect(answers(skipped)[0]?.message?.text).toBe('Хорошо, цель можно указать позже в /profile.');
    expect(chat.world.user.goal).toBeNull();
    expect(sent(skipped)[0]?.buttons.at(-1)).toEqual([{ type: 'open_app', text: 'Рассчитать' }]);

    await chat.press('ob:kcal:2000');
    const done = await chat.press('ob:loc:skip');
    expect(answers(done)[0]?.message?.text).toBe(
      'Хорошо, без местоположения. Отправить его можно позже в /profile.',
    );
    expect(texts(sent(done))).toEqual([ONBOARDING_DONE]);
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
  });

  it('offers a diary sample at the end in demo mode', async () => {
    const chat = botChat({ world: guestWorld({ services: { demo: fakeDemo() } }) });
    await chat.start();
    await chat.press('cs:pd:ok');
    await chat.press('cs:ad:yes:ob');
    await chat.press('ob:goal:skip');
    await chat.press('ob:kcal:2000');

    const [done] = sent(await chat.press('ob:loc:skip'));

    expect(done?.text).toBe(ONBOARDING_DONE);
    expect(payloads(done)).toEqual(['cmd:eat', 'cmd:help', 'of:demo']);
  });

  it('shows the full consent text and accepts it from there', async () => {
    const chat = botChat();
    await chat.start();

    const more = await chat.press('cs:pd:more');
    const [answer] = answers(more);
    expect(answer?.message?.text).toContain('**Согласие на обработку персональных данных**');
    expect(answer?.message?.text).toContain('Срок: до отзыва согласия или удаления аккаунта.');
    expect(answer?.message?.text).toContain('\\(оператор, связь через чат с ботом ППшкин в MAX\\)');
    expect(payloads(answer?.message)).toEqual(['cs:pd:ok']);

    await chat.press('cs:pd:ok');
    expect(chat.world.consents.has('personal_data')).toBe(true);
  });

  it('accepts a custom daily guideline only as a whole number from 1000 to 5000', async () => {
    const chat = botChat();
    await chat.start();
    await chat.press('cs:pd:ok');
    await chat.press('cs:ad:no:ob');
    await chat.press('ob:goal:maintain');
    const custom = await chat.press('ob:kcal:custom');
    expect(answers(custom)[0]?.message?.text).toBe('Напишите число от 1000 до 5000, например 1900.');
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'kcal_input', from: 'ob' });

    for (const wrong of ['900', 'много', '5001', '1900.5']) {
      expect(texts(await chat.send(wrong))).toEqual(['Нужно целое число от 1000 до 5000, например 1900.']);
    }
    expect(chat.world.user.kcalTarget).toBe(2000);

    const accepted = await chat.send('1 900 ккал');
    expect(texts(accepted)).toEqual([
      'Ориентир: 1900 ккал в день.',
      expect.stringContaining('Поделитесь местоположением'),
    ]);
    expect(chat.world.user.kcalTarget).toBe(1900);
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'onboarding_location' });
  });

  it('welcomes back a guest who already agreed', async () => {
    const chat = botChat();
    chat.world.consent('personal_data');

    const again = sent(await chat.send('/start'));
    expect(again.map((message) => message.text)).toEqual([
      'С возвращением! Пришлите фото блюда или напишите, что съели.',
    ]);
    expect(labels(again[0])).toEqual(['Что поесть?', 'Сегодня', 'Профиль']);
    expect(payloads(again[0])).toEqual(['cmd:eat', 'cmd:today', 'cmd:profile']);
  });

  it('keeps a start link that came before the consent and opens it right after', async () => {
    const venue = vi.fn(() => Promise.resolve({ venue: sampleVenue, openNow: true, menu: [], deals: [] }));
    const chat = botChat();
    chat.world.services.catalog.venue = venue;

    const first = await chat.start('v_7');
    expect(sent(first)).toHaveLength(2);
    expect(venue).not.toHaveBeenCalled();
    expect(chat.states.peek(GUEST_ID).pendingStart).toBe('v_7');

    const blocked = await chat.send('/today');
    expect(texts(blocked)).toEqual([expect.stringContaining('Чтобы вести дневник')]);

    const agreed = await chat.press('cs:pd:ok');
    expect(venue).toHaveBeenCalledWith(GUEST_ID, 7);
    expect(texts(sent(agreed))).toEqual([
      expect.stringContaining('**Кофейня «Зерно»**'),
      expect.stringContaining('Присылать?'),
    ]);
    expect(chat.states.peek(GUEST_ID).pendingStart).toBeNull();
  });

  it('continues onboarding when the pending start link fails', async () => {
    const chat = botChat();
    chat.world.services.catalog.venue = () => Promise.reject(new Error('database is down'));
    await chat.start('v_7');

    const agreed = await chat.press('cs:pd:ok');
    expect(texts(sent(agreed))).toEqual([
      'Что-то пошло не так. Попробуйте ещё раз или отправьте /help',
      expect.stringContaining('Присылать?'),
    ]);
    expect(chat.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: GUEST_ID }),
      'start link after consent failed',
    );
  });

  it('asks for the consent again after its text changed and skips the rest of onboarding', async () => {
    const chat = botChat();
    chat.world.consents.set('personal_data', '2020-01-01');

    const blocked = await chat.send('Сырники 350');
    expect(texts(blocked)).toEqual([expect.stringContaining('Чтобы вести дневник')]);
    expect(chat.world.meals).toHaveLength(0);

    const agreed = await chat.press('cs:pd:ok');
    expect(texts(sent(agreed))).toEqual(['С возвращением! Пришлите фото блюда или напишите, что съели.']);
  });

  it('ignores a second tap on an answered consent button', async () => {
    const chat = botChat();
    const [, request] = sent(await chat.start());
    const messageId = request?.messageId ?? null;

    await chat.press('cs:pd:ok', messageId);
    const second = await chat.press('cs:pd:ok', messageId);
    expect(second).toEqual([
      { kind: 'answer', messageId, notification: 'Эта кнопка уже нажата', message: null },
    ]);
    expect(chat.world.consents.has('personalized_offers')).toBe(false);
  });

  it('tells a guest who already agreed on another message that the consent is in place', async () => {
    const chat = botChat();
    const [, first] = sent(await chat.start());
    const [, second] = sent(await chat.start());
    await chat.press('cs:pd:ok', first?.messageId);

    const other = await chat.press('cs:pd:ok', second?.messageId);
    expect(other).toEqual([
      {
        kind: 'answer',
        messageId: second?.messageId,
        notification: 'Согласие уже получено',
        message: null,
      },
    ]);
  });

  it('turns personalized offers off', async () => {
    const chat = botChat();
    chat.world.consent('personal_data', 'personalized_offers');

    const off = await chat.press('cs:ad:off', 'mid.offer');
    expect(answers(off)[0]?.message?.text).toBe(
      'Готово, сам больше ничего не пришлю. Подбор по запросу работает: /eat',
    );
    expect(chat.world.consents.has('personalized_offers')).toBe(false);
  });

  it('treats an unknown origin of the offers answer as a stale button', async () => {
    const chat = botChat();
    chat.world.consent('personal_data');
    const stale = await chat.press('cs:ad:yes:zz', 'mid.old');
    expect(answers(stale)[0]?.notification).toBe('Кнопка устарела');
    expect(chat.world.consents.has('personalized_offers')).toBe(false);
  });

  it('treats unknown goals and guideline values as stale buttons', async () => {
    const chat = botChat();
    chat.world.consent('personal_data');
    expect(answers(await chat.press('ob:goal:fly', 'mid.old'))[0]?.notification).toBe('Кнопка устарела');
    expect(answers(await chat.press('ob:kcal:999', 'mid.old'))[0]?.notification).toBe('Кнопка устарела');
    expect(chat.world.user.goal).toBeNull();
    expect(chat.world.user.kcalTarget).toBe(2000);
  });

  it('answers /help with what the bot can do', async () => {
    const chat = botChat();
    const [help] = sent(await chat.send('/help'));
    expect(help?.text).toContain('**Что я умею**');
    for (const command of ['/eat', '/today', '/bookings', '/profile', '/delete']) {
      expect(help?.text).toContain(command);
    }
    expect(help?.text).toContain('*Калорийность приблизительная, это не медицинская рекомендация.*');
    expect(payloads(help)).toEqual(['cmd:eat', 'cmd:today', 'cmd:profile']);
  });
});
