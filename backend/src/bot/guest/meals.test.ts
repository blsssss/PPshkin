import { describe, expect, it, vi } from 'vitest';
import {
  answers,
  botChat,
  CHAT_ID,
  estimate,
  GUEST_ID,
  guestWorld,
  labels,
  payloads,
  sent,
  texts,
  type BotChat,
  type Outgoing,
} from '../../../test/bot.ts';
import { DownloadTooLargeError, MaxApiError } from '../../integrations/max/errors.ts';
import type { MealLogResult } from '../../services/diary.ts';

function consentedChat(options: Parameters<typeof botChat>[0] = {}): BotChat {
  const chat = botChat(options);
  chat.world.consent('personal_data');
  return chat;
}

function edits(outgoing: readonly Outgoing[]) {
  return outgoing.flatMap((item) => (item.kind === 'edit' ? [item] : []));
}

const CANCELLED = 'Хорошо, отменил. Пришлите фото блюда или напишите, что съели.';

const SINGLE_LOGGED = [
  'Записал: **Борщ со сметаной**, 300-360 ккал',
  'Б 12 г, Ж 15 г, У 25 г',
  'Сегодня около 330 из 2000 ккал, осталось около 1670 ккал',
].join('\n');

describe('food photos', () => {
  it('shows a placeholder, downloads the first photo and replaces the placeholder with the result', async () => {
    const chat = consentedChat();
    chat.world.recognizePhoto.mockImplementation(() => chat.world.logged({}));

    const replies = await chat.photo();

    const [placeholder] = sent(replies);
    expect(placeholder?.text).toBe('Смотрю на фото, это до 15 секунд...');
    expect(chat.api.sendAction).toHaveBeenCalledWith(CHAT_ID, 'typing_on');
    expect(chat.api.download).toHaveBeenCalledWith('https://files.max.example/photo-0.jpg', 15 * 1024 * 1024);
    expect(chat.world.recognizePhoto).toHaveBeenCalledWith(Buffer.from('jpeg bytes'));
    const [result] = edits(replies);
    expect(result?.messageId).toBe(placeholder?.messageId);
    expect(result?.text).toBe(SINGLE_LOGGED);
    expect(result?.buttons).toEqual([
      [
        { type: 'callback', text: 'Верно', payload: 'ml:ok:1' },
        { type: 'callback', text: 'Исправить', payload: 'ml:fix:1' },
        { type: 'callback', text: 'Удалить', payload: 'ml:del:1' },
      ],
    ]);
  });

  it('takes only the first of several photos', async () => {
    const chat = consentedChat();
    chat.world.recognizePhoto.mockImplementation(() => chat.world.logged({}));

    const replies = await chat.photo(3);

    expect(sent(replies)[0]?.text).toBe(
      'Беру первое фото, остальные пришлите по одному.\nСмотрю на фото, это до 15 секунд...',
    );
    expect(chat.api.download).toHaveBeenCalledTimes(1);
  });

  it('lists several dishes with a pair of buttons for each', async () => {
    const chat = consentedChat();
    chat.world.recognizePhoto.mockImplementation(() =>
      chat.world.logged(
        {},
        { title: 'Хлеб ржаной', kcalMin: 80, kcalMax: 80, proteinG: 2, fatG: 1, carbsG: 15 },
      ),
    );

    const [result] = edits(await chat.photo());

    expect(result?.text).toBe(
      [
        'Записал 2 блюда:',
        '**Борщ со сметаной**, 300-360 ккал',
        '**Хлеб ржаной**, около 80 ккал',
        'Б 14 г, Ж 16 г, У 40 г',
        'Сегодня около 410 из 2000 ккал, осталось около 1590 ккал',
      ].join('\n'),
    );
    expect(labels(result)).toEqual([
      'Исправить: Борщ со сметаной',
      'Удалить: Борщ со сметаной',
      'Исправить: Хлеб ржаной',
      'Удалить: Хлеб ржаной',
      'Всё верно',
    ]);
    expect(payloads(result)).toEqual(['ml:fix:1', 'ml:del:1:m', 'ml:fix:2', 'ml:del:2:m', 'ml:ok:1.2']);
  });

  it('escapes dish names in the text but not in the buttons', async () => {
    const chat = consentedChat();
    chat.world.recognizePhoto.mockImplementation(() =>
      chat.world.logged({ title: 'Суп *дня* [new]' }, { title: 'Салат_2 (большой)' }),
    );

    const [result] = edits(await chat.photo());

    expect(result?.text).toContain('**Суп \\*дня\\* \\[new\\]**');
    expect(result?.text).toContain('**Салат\\_2 \\(большой\\)**');
    expect(labels(result)).toContain('Исправить: Суп *дня* [new]');
  });

  it('offers candidates when unsure and logs the picked one', async () => {
    const chat = consentedChat();
    const candidates = [
      estimate({ title: 'Плов', kcalMin: 400, kcalMax: 550, confidence: 0.3 }),
      estimate({ title: 'Рис с мясом', kcalMin: 350, kcalMax: 420, confidence: 0.2, tags: ['rice', 'meat'] }),
    ];
    chat.world.recognizePhoto.mockResolvedValue({ status: 'uncertain', candidates, basis: 'Не видно' });

    const replies = await chat.photo();
    const [placeholder] = sent(replies);
    const [result] = edits(replies);
    expect(result?.text).toBe(
      'Не уверен, что это. Выберите вариант или напишите название и калории, например: Плов 450',
    );
    expect(result?.buttons).toEqual([
      [{ type: 'callback', text: 'Плов, 400-550 ккал', payload: 'ml:pick:0' }],
      [{ type: 'callback', text: 'Рис с мясом, 350-420 ккал', payload: 'ml:pick:1' }],
      [{ type: 'callback', text: 'Ввести вручную', payload: 'ml:manual' }],
    ]);
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({
      name: 'meal_candidates',
      messageId: placeholder?.messageId,
      candidates: [{ title: 'Плов' }, { title: 'Рис с мясом', tags: ['rice', 'meat'] }],
    });

    const picked = await chat.press('ml:pick:1');

    expect(chat.world.meals).toMatchObject([
      { title: 'Рис с мясом', kcalMin: 350, kcalMax: 420, proteinG: 12, tags: ['rice', 'meat'] },
    ]);
    const [answer] = answers(picked);
    expect(answer?.messageId).toBe(placeholder?.messageId);
    expect(answer?.message?.text).toContain('Записал: **Рис с мясом**, 350-420 ккал');
    expect(payloads(answer?.message)).toEqual(['ml:ok:1', 'ml:fix:1', 'ml:del:1']);
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
  });

  it('refuses candidates of an older message', async () => {
    const chat = consentedChat();
    chat.world.recognizePhoto.mockResolvedValue({
      status: 'uncertain',
      candidates: [estimate({ title: 'Плов', confidence: 0.2 })],
      basis: '',
    });
    const [first] = sent(await chat.photo());
    await chat.photo();

    const stale = await chat.press('ml:pick:0', first?.messageId);

    expect(stale).toEqual([
      { kind: 'answer', messageId: first?.messageId, notification: 'Кнопка устарела', message: null },
    ]);
    expect(chat.world.meals).toHaveLength(0);
  });

  it.each<[string, MealLogResult, string]>([
    [
      'not food',
      { status: 'not_food', basis: 'Кошка' },
      'Похоже, на фото не еда. Пришлите фото блюда или напишите, что съели, например: Сырники 350',
    ],
    [
      'disabled recognition',
      { status: 'unavailable', reason: 'disabled' },
      'Распознавание фото сейчас выключено. Напишите, что съели, например: Сырники 350',
    ],
    [
      'an unreadable image',
      { status: 'unavailable', reason: 'unsupported_image' },
      'Не получилось открыть фото. Пришлите обычное фото в JPEG или PNG.',
    ],
    [
      'a timeout',
      { status: 'unavailable', reason: 'timeout' },
      'Сервис распознавания не ответил. Попробуйте через минуту или напишите вручную, например: Сырники 350',
    ],
    [
      'a used up quota',
      { status: 'unavailable', reason: 'quota_exceeded' },
      'Сервис распознавания не ответил. Попробуйте через минуту или напишите вручную, например: Сырники 350',
    ],
  ])('explains %s and offers manual entry', async (_case, result, text) => {
    const chat = consentedChat();
    chat.world.recognizePhoto.mockResolvedValue(result);

    const [reply] = edits(await chat.photo());

    expect(reply?.text).toBe(text);
    expect(payloads(reply)).toEqual(['ml:manual']);
  });

  it('sends the result as a new message when the placeholder cannot be edited', async () => {
    const chat = consentedChat({
      api: {
        editMessage: vi.fn(() => Promise.reject(new MaxApiError(400, 'bad.request', 'message is gone'))),
      },
    });
    chat.world.recognizePhoto.mockImplementation(() => chat.world.logged({}));

    const replies = await chat.photo();

    expect(texts(replies)).toEqual(['Смотрю на фото, это до 15 секунд...', SINGLE_LOGGED]);
    expect(chat.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: GUEST_ID }),
      'placeholder could not be replaced, sending anew',
    );
  });

  it('explains a photo that is too large or could not be downloaded', async () => {
    const tooLarge = consentedChat({
      api: { download: vi.fn(() => Promise.reject(new DownloadTooLargeError(15 * 1024 * 1024))) },
    });
    expect(edits(await tooLarge.photo())[0]?.text).toBe('Фото слишком большое. Пришлите фото до 15 МБ.');
    expect(tooLarge.world.recognizePhoto).not.toHaveBeenCalled();

    const broken = consentedChat({
      api: { download: vi.fn(() => Promise.reject(new MaxApiError(0, 'network.error', 'offline'))) },
    });
    const [reply] = edits(await broken.photo());
    expect(reply?.text).toBe('Не получилось загрузить фото. Пришлите его ещё раз.');
    expect(payloads(reply)).toEqual(['ml:manual']);
    expect(broken.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: GUEST_ID }),
      'food photo download failed',
    );
  });

  it('turns the placeholder into an apology when logging fails and keeps the photo out of the log', async () => {
    const chat = consentedChat();
    chat.world.recognizePhoto.mockRejectedValue(new Error('connection terminated'));

    const replies = await chat.photo();

    expect(edits(replies)[0]?.text).toBe('Что-то пошло не так. Попробуйте ещё раз или отправьте /help');
    expect(chat.logger.error).toHaveBeenCalledWith(
      { userId: GUEST_ID, event: 'message', err: expect.any(Error) as unknown },
      'bot handler failed',
    );
    expect(JSON.stringify(chat.logger.error.mock.calls)).not.toContain('photo-0.jpg');
  });

  it('limits recognitions to 20 an hour and never limits manual entry', async () => {
    const chat = consentedChat();
    chat.world.recognizePhoto.mockResolvedValue({ status: 'not_food', basis: '' });
    for (let index = 0; index < 20; index += 1) await chat.photo();
    expect(chat.world.recognizePhoto).toHaveBeenCalledTimes(20);

    const limited = await chat.send('съел борщ');
    expect(texts(limited)).toEqual([
      'Слишком много запросов подряд. Попробуйте через час или запишите вручную, например: Сырники 350',
    ]);
    expect(payloads(sent(limited)[0])).toEqual(['ml:manual']);
    expect(texts(await chat.photo())[0]).toContain('Слишком много запросов подряд');
    expect(chat.world.recognizeText).not.toHaveBeenCalled();
    expect(chat.api.download).toHaveBeenCalledTimes(20);

    expect(texts(await chat.send('Сырники 350'))[0]).toContain('Записал: **Сырники**');

    chat.world.clock.advance(60 * 60_000);
    await chat.photo();
    expect(chat.world.recognizePhoto).toHaveBeenCalledTimes(21);
  });
});

describe('logged meal buttons', () => {
  async function loggedChat() {
    const chat = consentedChat();
    chat.world.recognizePhoto.mockImplementation(() => chat.world.logged({}));
    const [placeholder] = sent(await chat.photo());
    return { chat, messageId: placeholder?.messageId ?? null };
  }

  it('keeps the text and removes the buttons when the guest confirms', async () => {
    const { chat, messageId } = await loggedChat();

    const confirmed = await chat.press('ml:ok:1');
    expect(confirmed).toEqual([
      {
        kind: 'answer',
        messageId,
        notification: null,
        message: { text: SINGLE_LOGGED, buttons: [], images: [] },
      },
    ]);

    const again = await chat.press('ml:del:1', messageId);
    expect(answers(again)[0]?.notification).toBe('Эта кнопка уже нажата');
    expect(chat.world.meals).toHaveLength(1);
  });

  it('closes the buttons of meals that are gone', async () => {
    const { chat, messageId } = await loggedChat();
    chat.world.meals.splice(0);

    expect(await chat.press('ml:ok:1')).toEqual([
      {
        kind: 'answer',
        messageId,
        notification: null,
        message: { text: 'Записано.', buttons: [], images: [] },
      },
    ]);
    expect(answers(await chat.press('ml:ok:1', messageId))[0]?.notification).toBe('Эта кнопка уже нажата');
  });

  it('closes the buttons of a meal logged before the local midnight', async () => {
    const chat = consentedChat({ world: guestWorld({ now: '2026-09-26T20:58:00Z' }) });
    chat.world.recognizePhoto.mockImplementation(() => chat.world.logged({}));
    await chat.photo();
    chat.world.clock.advance(5 * 60_000);

    const confirmed = await chat.press('ml:ok:1');

    expect(answers(confirmed)[0]?.message).toEqual({ text: 'Записано.', buttons: [], images: [] });
    expect(chat.world.meals).toHaveLength(1);
  });

  it('deletes the meal and says so in place', async () => {
    const { chat, messageId } = await loggedChat();

    const deleted = await chat.press('ml:del:1');

    expect(answers(deleted)).toEqual([
      {
        kind: 'answer',
        messageId,
        notification: null,
        message: { text: 'Запись удалена.', buttons: [], images: [] },
      },
    ]);
    expect(chat.world.meals).toHaveLength(0);
  });

  it('corrects the name and calories or only the calories', async () => {
    const { chat } = await loggedChat();

    const fix = await chat.press('ml:fix:1');
    expect(answers(fix)[0]?.notification).toBe('Жду исправление');
    expect(sent(fix)).toEqual([
      expect.objectContaining({
        text: 'Напишите название и калории, например: Борщ 300. Если название верное, достаточно числа: 300',
        buttons: [[{ type: 'callback', text: 'Отмена', payload: 'ml:cancel:fix:1' }]],
      }),
    ]);
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'meal_fix', mealId: 1 });

    const [invalid] = sent(await chat.send('Борщ 9000'));
    expect(invalid?.text).toBe(
      'Не понял. Напишите название и калории, например: Борщ 300, или только калории: 300',
    );
    expect(payloads(invalid)).toEqual(['ml:cancel:fix:1']);
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'meal_fix', mealId: 1 });

    const fixed = sent(await chat.send('Борщ 300'));
    expect(fixed[0]?.text).toBe(
      [
        'Исправил: **Борщ**, около 300 ккал',
        'Б 12 г, Ж 15 г, У 25 г',
        'Сегодня около 300 из 2000 ккал, осталось около 1700 ккал',
      ].join('\n'),
    );
    expect(payloads(fixed[0])).toEqual(['ml:ok:1:f', 'ml:fix:1', 'ml:del:1']);
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();

    await chat.press('ml:fix:1');
    const [kcalOnly] = sent(await chat.send('250 ккал'));
    expect(kcalOnly?.text).toContain('Исправил: **Борщ**, около 250 ккал');

    const confirmed = await chat.press('ml:ok:1:f', kcalOnly?.messageId);
    expect(answers(confirmed)[0]?.message).toEqual({ text: kcalOnly?.text, buttons: [], images: [] });
  });

  it('lets other food through while a correction is awaited', async () => {
    const { chat } = await loggedChat();
    chat.world.recognizeText.mockImplementation(() => chat.world.logged({ title: 'Борщ' }));
    await chat.press('ml:fix:1');

    const recognized = await chat.send('съел борщ со сметаной');

    expect(chat.world.recognizeText).toHaveBeenCalledWith('съел борщ со сметаной');
    expect(edits(recognized)[0]?.text).toContain('Записал: **Борщ**');
    expect(chat.world.meals.map((meal) => meal.title)).toEqual(['Борщ со сметаной', 'Борщ']);

    await chat.press('ml:fix:1');
    expect(texts(await chat.send('Ёжик в тумане'))).toEqual(['Записать «Ёжик в тумане» в дневник?']);
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'meal_text_confirm' });
  });

  it('cancels a correction and logs the next text as a new meal', async () => {
    const { chat } = await loggedChat();
    const [prompt] = sent(await chat.press('ml:fix:1'));

    const older = await chat.press('ml:cancel:fix:2', 'mid.old');
    expect(answers(older)[0]?.message?.text).toBe(CANCELLED);
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'meal_fix', mealId: 1 });

    const cancelled = await chat.press('ml:cancel:fix:1', prompt?.messageId);
    expect(answers(cancelled)).toEqual([
      {
        kind: 'answer',
        messageId: prompt?.messageId,
        notification: null,
        message: { text: CANCELLED, buttons: [], images: [] },
      },
    ]);
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();

    await chat.send('Сырники 350');
    expect(chat.world.meals.map((meal) => meal.title)).toEqual(['Борщ со сметаной', 'Сырники']);
  });

  it('reports a correction of a meal that was deleted meanwhile', async () => {
    const { chat } = await loggedChat();
    await chat.press('ml:fix:1');
    chat.world.meals.splice(0);

    expect(texts(await chat.send('Борщ 300'))).toEqual(['Не нашёл: запись уже удалена или устарела.']);
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
  });

  it('drops a pending correction when the meal is deleted', async () => {
    const { chat } = await loggedChat();
    await chat.press('ml:fix:1');
    await chat.press('ml:del:1');
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
  });

  it('deletes one of several dishes without closing the message', async () => {
    const chat = consentedChat();
    chat.world.recognizePhoto.mockImplementation(() =>
      chat.world.logged({}, { title: 'Хлеб', kcalMin: 80, kcalMax: 80 }),
    );
    await chat.photo();

    const deleted = await chat.press('ml:del:2:m');
    expect(answers(deleted)[0]?.notification).toBe('Запись удалена');
    expect(chat.world.meals.map((meal) => meal.title)).toEqual(['Борщ со сметаной']);

    const confirmed = await chat.press('ml:ok:1.2');
    expect(answers(confirmed)[0]?.message?.text).toBe(SINGLE_LOGGED);
  });

  it('reports a deletion of a meal that is already gone', async () => {
    const { chat } = await loggedChat();
    chat.world.meals.splice(0);
    const deleted = await chat.press('ml:del:1');
    expect(deleted).toEqual([
      expect.objectContaining({ notification: 'Не нашёл: запись уже удалена или устарела.', message: null }),
    ]);
  });

  it.each([
    'ml:ok:x',
    'ml:ok:1.2.3.4.5.6',
    'ml:fix:0',
    'ml:del:-1',
    'ml:pick:9',
    'ml:cancel',
    'ml:cancel:zz',
    'ml:cancel:fix:x',
    'ml:unknown',
    'ml',
  ])('treats %s as a stale button', async (payload) => {
    const chat = consentedChat();
    const replies = await chat.press(payload, 'mid.old');
    expect(replies).toEqual([
      { kind: 'answer', messageId: 'mid.old', notification: 'Кнопка устарела', message: null },
    ]);
  });
});

describe('text messages', () => {
  it.each([
    ['Сырники 350', 'Сырники', 350],
    ['Латте 180 ккал', 'Латте', 180],
    ['Съела сырники со сметаной 420', 'Сырники со сметаной', 420],
    ['на завтрак овсянка 300ккал', 'Овсянка', 300],
  ])('logs "%s" as %s with %i kcal', async (input, title, kcal) => {
    const chat = consentedChat();

    const [reply] = sent(await chat.send(input));

    expect(chat.world.meals).toMatchObject([{ title, kcalMin: kcal, kcalMax: kcal, source: 'manual' }]);
    expect(reply?.text).toBe(
      [
        `Записал: **${title}**, около ${kcal} ккал`,
        `Сегодня около ${kcal} из 2000 ккал, осталось около ${2000 - kcal} ккал`,
      ].join('\n'),
    );
    expect(payloads(reply)).toEqual(['ml:ok:1', 'ml:fix:1', 'ml:del:1']);
    expect(chat.world.recognizeText).not.toHaveBeenCalled();
  });

  it.each(['съел борщ', 'Поела плов с курицей', 'На обед суп и салат', 'выпил латте'])(
    'recognizes "%s" as a description of food',
    async (input) => {
      const chat = consentedChat();
      chat.world.recognizeText.mockImplementation(() => chat.world.logged({}));

      const replies = await chat.send(input);

      expect(chat.world.recognizeText).toHaveBeenCalledWith(input);
      expect(sent(replies)[0]?.text).toBe('Считаю калории, это до 15 секунд...');
      expect(edits(replies)[0]?.text).toBe(SINGLE_LOGGED);
    },
  );

  it('explains text that is not food', async () => {
    const chat = consentedChat();
    chat.world.recognizeText.mockResolvedValue({ status: 'not_food', basis: '' });
    expect(edits(await chat.send('съел домашнее задание'))[0]?.text).toBe(
      'Похоже, это не еда. Напишите, что съели, например: Сырники 350',
    );
    chat.world.recognizeText.mockResolvedValue({ status: 'unavailable', reason: 'disabled' });
    expect(edits(await chat.send('съел борщ'))[0]?.text).toBe(
      'Распознавание сейчас выключено. Напишите название и калории, например: Сырники 350',
    );
  });

  it.each(['привет', 'Спасибо!', 'помощь', 'help', 'Меню', 'я', 'а'.repeat(501)])(
    'answers "%s" with help',
    async (input) => {
      const chat = consentedChat();
      const [reply] = sent(await chat.send(input));
      expect(reply?.text).toContain('**Что я умею**');
      expect(chat.world.meals).toHaveLength(0);
    },
  );

  it('asks before recognizing other text and recognizes it on yes', async () => {
    const chat = consentedChat();
    chat.world.recognizeText.mockImplementation(() => chat.world.logged({ title: 'Ёжик' }));

    const [question] = sent(await chat.send('ёжик в тумане'));
    expect(question?.text).toBe('Записать «ёжик в тумане» в дневник?');
    expect(question?.buttons).toEqual([
      [
        { type: 'callback', text: 'Да', payload: 'ml:text:yes' },
        { type: 'callback', text: 'Нет', payload: 'ml:text:no' },
      ],
    ]);
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({
      name: 'meal_text_confirm',
      text: 'ёжик в тумане',
      messageId: question?.messageId,
    });

    const accepted = await chat.press('ml:text:yes');
    expect(answers(accepted)[0]?.message?.text).toBe('Считаю калории: «ёжик в тумане». Это до 15 секунд...');
    const [result] = edits(accepted);
    expect(result?.messageId).toBe(question?.messageId);
    expect(result?.text).toContain('Записал: **Ёжик**');
    expect(chat.world.recognizeText).toHaveBeenCalledWith('ёжик в тумане');
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
  });

  it('keeps the buttons of the result that replaced the question', async () => {
    const chat = consentedChat();
    chat.world.recognizeText.mockImplementation(() => chat.world.logged({ title: 'Ёжик' }));
    const [question] = sent(await chat.send('ёжик в тумане'));
    await chat.press('ml:text:yes');

    expect(answers(await chat.press('ml:fix:1', question?.messageId))[0]?.notification).toBe(
      'Жду исправление',
    );
    expect(answers(await chat.press('ml:del:1', question?.messageId))[0]?.message?.text).toBe(
      'Запись удалена.',
    );
    expect(chat.world.meals).toHaveLength(0);

    const [again] = sent(await chat.send('ёжик в тумане'));
    await chat.press('ml:text:yes', again?.messageId);
    const confirmed = await chat.press('ml:ok:2', again?.messageId);
    expect(answers(confirmed)[0]?.message).toEqual({
      text: expect.stringContaining('Записал: **Ёжик**') as unknown,
      buttons: [],
      images: [],
    });
  });

  it('logs a candidate picked on the result that replaced the question', async () => {
    const chat = consentedChat();
    chat.world.recognizeText.mockResolvedValue({
      status: 'uncertain',
      candidates: [estimate({ title: 'Плов', confidence: 0.3 })],
      basis: '',
    });
    const [question] = sent(await chat.send('ёжик в тумане'));
    await chat.press('ml:text:yes');

    const picked = await chat.press('ml:pick:0', question?.messageId);

    expect(answers(picked)[0]?.message?.text).toContain('Записал: **Плов**');
    expect(chat.world.meals).toMatchObject([{ title: 'Плов' }]);
  });

  it('shows help when the guest says no', async () => {
    const chat = consentedChat();
    await chat.send('что-то непонятное');

    const declined = await chat.press('ml:text:no');

    expect(answers(declined)[0]?.message?.text).toContain('**Что я умею**');
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
    expect(chat.world.recognizeText).not.toHaveBeenCalled();
  });

  it('refuses yes on an older question', async () => {
    const chat = consentedChat();
    const [first] = sent(await chat.send('первый текст'));
    await chat.send('второй текст');

    const stale = await chat.press('ml:text:yes', first?.messageId);

    expect(answers(stale)[0]?.notification).toBe('Кнопка устарела');
    expect(chat.world.recognizeText).not.toHaveBeenCalled();
  });

  it('keeps the question when recognition is over the limit', async () => {
    const chat = consentedChat();
    chat.world.recognizeText.mockResolvedValue({ status: 'not_food', basis: '' });
    for (let index = 0; index < 20; index += 1) await chat.send('съел что-то');
    await chat.send('ёжик в тумане');

    const limited = await chat.press('ml:text:yes');

    expect(answers(limited)[0]?.message?.text).toContain('Слишком много запросов подряд');
    expect(chat.world.recognizeText).toHaveBeenCalledTimes(20);
  });

  it('takes manual entry after the button and insists on a number', async () => {
    const chat = consentedChat();
    chat.world.recognizePhoto.mockResolvedValue({ status: 'not_food', basis: '' });
    await chat.photo();

    const manual = await chat.press('ml:manual');
    expect(answers(manual)[0]?.message).toEqual({
      text: 'Напишите название и калории, например: Сырники 350',
      buttons: [[{ type: 'callback', text: 'Отмена', payload: 'ml:cancel:manual' }]],
      images: [],
    });
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'meal_manual' });

    const [invalid] = sent(await chat.send('Плов 9000'));
    expect(invalid?.text).toBe('Не понял. Напишите название и калории числом, например: Сырники 350');
    expect(payloads(invalid)).toEqual(['ml:cancel:manual']);
    const logged = await chat.send('Плов 450');
    expect(texts(logged)[0]).toContain('Записал: **Плов**, около 450 ккал');
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
  });

  it('handles text without a number during manual entry as usual text', async () => {
    const chat = consentedChat();
    await chat.press('ml:manual', 'mid.old');

    expect(texts(await chat.send('Ёжик в тумане'))).toEqual(['Записать «Ёжик в тумане» в дневник?']);
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({
      name: 'meal_text_confirm',
      text: 'Ёжик в тумане',
    });
  });

  it('cancels manual entry', async () => {
    const chat = consentedChat();
    await chat.press('ml:manual', 'mid.old');

    const cancelled = await chat.press('ml:cancel:manual');

    expect(answers(cancelled)[0]?.message).toEqual({ text: CANCELLED, buttons: [], images: [] });
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
    expect(answers(await chat.press('ml:cancel:manual', 'mid.old'))[0]?.notification).toBe(
      'Эта кнопка уже нажата',
    );
  });

  it('lets a photo through while waiting for manual entry', async () => {
    const chat = consentedChat();
    await chat.press('ml:manual', 'mid.old');
    chat.world.recognizePhoto.mockImplementation(() => chat.world.logged({}));

    expect(edits(await chat.photo())[0]?.text).toBe(SINGLE_LOGGED);
  });
});

describe('/today', () => {
  it('invites to log the first meal on an empty day', async () => {
    const chat = consentedChat();
    const [today] = sent(await chat.send('/today'));
    expect(today?.text).toBe(
      [
        '**Сегодня, 26 сентября**',
        'Пока ничего не записано. Пришлите фото блюда или напишите, что съели, например: Сырники 350',
        'Ориентир на день: 2000 ккал',
      ].join('\n'),
    );
    expect(today?.buttons).toEqual([[{ type: 'callback', text: 'Что поесть?', payload: 'cmd:eat' }]]);
  });

  it('lists meals with local times, totals and macros', async () => {
    const chat = consentedChat({ miniAppEnabled: true });
    const breakfast = chat.world.addMeal('Сырники', 380, 450, new Date('2026-09-26T05:40:00Z'));
    Object.assign(breakfast, { proteinG: 20, fatG: 15, carbsG: 40 });
    chat.world.addMeal('Борщ', 300, 300, new Date('2026-09-26T08:10:00Z'));

    const [today] = sent(await chat.send('/today'));

    expect(today?.text).toBe(
      [
        '**Сегодня, 26 сентября**',
        '08:40 **Сырники**, 380-450 ккал',
        '11:10 **Борщ**, около 300 ккал',
        '',
        'Итого около 715 ккал из 2000, осталось около 1285',
        'Б 20 г, Ж 15 г, У 40 г',
      ].join('\n'),
    );
    expect(today?.buttons).toEqual([
      [{ type: 'callback', text: 'Что поесть?', payload: 'cmd:eat' }],
      [{ type: 'callback', text: 'Удалить последнюю запись', payload: 'ml:del:2:t' }],
      [{ type: 'open_app', text: 'Открыть дневник' }],
    ]);
  });

  it('shortens a long day and tells when the guideline is reached', async () => {
    const chat = consentedChat();
    for (let index = 0; index < 23; index += 1) chat.world.addMeal(`Перекус ${index + 1}`, 100);

    const [today] = sent(await chat.send('/today'));

    expect(today?.text).toContain('**Перекус 20**');
    expect(today?.text).not.toContain('**Перекус 21**');
    expect(today?.text).toContain('и ещё 3 записи');
    expect(today?.text).toContain('Итого около 2300 ккал из 2000, ориентир на день набран');
    expect(today?.text).not.toContain('Б 0 г');
    expect(payloads(today)).toEqual(['cmd:eat', 'ml:del:23:t']);
  });

  it('deletes the latest meal and refreshes the day in place', async () => {
    const chat = consentedChat();
    chat.world.addMeal('Сырники', 400);
    chat.world.addMeal('Борщ', 300);
    await chat.send('/today');

    const refreshed = await chat.press('ml:del:2:t');

    const [answer] = answers(refreshed);
    expect(answer?.message?.text).toContain('**Сырники**, около 400 ккал');
    expect(answer?.message?.text).not.toContain('Борщ');
    expect(payloads(answer?.message)).toEqual(['cmd:eat', 'ml:del:1:t']);
  });

  it('is reachable from the menu buttons', async () => {
    const chat = consentedChat();
    const replies = await chat.press('cmd:today', 'mid.menu');
    expect(answers(replies)[0]?.notification).toBe('Открываю');
    expect(sent(replies)[0]?.text).toContain('**Сегодня, 26 сентября**');
  });
});
