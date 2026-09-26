import { describe, expect, it } from 'vitest';
import {
  answers,
  botChat,
  GUEST_ID,
  labels,
  payloads,
  sent,
  texts,
  type BotChat,
} from '../../../test/bot.ts';
import { forbidden } from '../../shared/errors.ts';
import { EMPTY_CHAT_STATE } from '../state.ts';

function consentedChat(options: Parameters<typeof botChat>[0] = {}): BotChat {
  const chat = botChat(options);
  chat.world.consent('personal_data');
  return chat;
}

const DEFAULT_PROFILE = [
  '**Профиль**',
  'Ориентир: 2000 ккал в день',
  'Цель: не указана',
  'Персональные предложения: выключены',
  'Местоположение: не указано',
].join('\n');

describe('/profile', () => {
  it('shows the settings with a toggle for each of them', async () => {
    const chat = consentedChat();

    const [profile] = sent(await chat.send('/profile'));

    expect(profile?.text).toBe(DEFAULT_PROFILE);
    expect(profile?.buttons).toEqual([
      [
        { type: 'callback', text: 'Ориентир', payload: 'pf:kcal' },
        { type: 'callback', text: 'Цель', payload: 'pf:goal' },
      ],
      [{ type: 'callback', text: 'Предложения: включить', payload: 'pf:ad:on' }],
      [{ type: 'request_geo_location', text: 'Отправить местоположение' }],
      [{ type: 'callback', text: 'Удалить аккаунт', payload: 'ac:del' }],
    ]);
  });

  it('shows a filled profile with the offers switch and the disliked list', async () => {
    const chat = consentedChat();
    chat.world.consent('personalized_offers');
    Object.assign(chat.world.user, {
      kcalTarget: 1800,
      goal: 'gain',
      dislikedTags: ['fish', 'spicy'],
      location: { lat: 55.79, lon: 49.12 },
      locationUpdatedAt: new Date('2026-09-25T21:30:00Z'),
    });

    const [profile] = sent(await chat.send('/profile'));

    expect(profile?.text).toBe(
      [
        '**Профиль**',
        'Ориентир: 1800 ккал в день',
        'Цель: набрать вес',
        'Персональные предложения: включены',
        'Местоположение: обновлено 26 сентября',
        'Не предлагать: рыба, острое',
      ].join('\n'),
    );
    expect(labels(profile)).toEqual([
      'Ориентир',
      'Цель',
      'Предложения: выключить',
      'Обновить местоположение',
      'Сбросить список «Не предлагать»',
      'Удалить аккаунт',
    ]);
    expect(payloads(profile)).toContain('cs:ad:off');
  });

  it('changes the guideline in place', async () => {
    const chat = consentedChat({ miniAppEnabled: true });
    await chat.send('/profile');

    const options = await chat.press('pf:kcal');
    const [question] = answers(options);
    expect(question?.message?.text).toBe(
      'Сколько ккал в день взять за ориентир? Это ориентир для подсказок, а не медицинская норма.',
    );
    expect(payloads(question?.message)).toEqual([
      'pf:kcal:1600',
      'pf:kcal:1800',
      'pf:kcal:2000',
      'pf:kcal:2200',
      'pf:kcal:2500',
      'pf:kcal:custom',
    ]);
    expect(labels(question?.message)).toContain('Рассчитать');

    const chosen = await chat.press('pf:kcal:2200');
    expect(answers(chosen)[0]?.message?.text).toContain('Ориентир: 2200 ккал в день');
    expect(chat.world.user.kcalTarget).toBe(2200);
  });

  it('takes a custom guideline typed as text and shows the profile again', async () => {
    const chat = consentedChat();
    await chat.send('/profile');
    await chat.press('pf:kcal');

    const custom = await chat.press('pf:kcal:custom');
    expect(answers(custom)[0]?.message?.text).toBe('Напишите число от 1000 до 5000, например 1900.');
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'kcal_input', from: 'pf' });

    const [profile] = sent(await chat.send('2700'));
    expect(profile?.text).toContain('Ориентир: 2700 ккал в день');
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
  });

  it('changes or keeps the goal', async () => {
    const chat = consentedChat();
    await chat.send('/profile');

    const question = await chat.press('pf:goal');
    expect(answers(question)[0]?.message?.text).toBe('Какая у вас цель?');
    expect(payloads(answers(question)[0]?.message)).toEqual([
      'pf:goal:lose',
      'pf:goal:maintain',
      'pf:goal:gain',
      'pf:goal:skip',
    ]);

    const chosen = await chat.press('pf:goal:maintain');
    expect(answers(chosen)[0]?.message?.text).toContain('Цель: поддерживать вес');

    await chat.press('pf:goal');
    const kept = await chat.press('pf:goal:skip');
    expect(answers(kept)[0]?.message?.text).toContain('Цель: поддерживать вес');
    expect(chat.world.user.goal).toBe('maintain');
  });

  it('shows the offers consent text before turning offers on', async () => {
    const chat = consentedChat();
    await chat.send('/profile');

    const question = await chat.press('pf:ad:on');
    const [answer] = answers(question);
    expect(answer?.message?.text).toContain('**Согласие на персональные предложения**');
    expect(answer?.message?.text).toContain('Не чаще 2 раз в день.');
    expect(labels(answer?.message)).toEqual(['Согласен получать', 'Отмена']);
    expect(chat.world.consents.has('personalized_offers')).toBe(false);

    const agreed = await chat.press('cs:ad:yes:pf');
    expect(answers(agreed)[0]?.message?.text).toContain('Персональные предложения: включены');
    expect(chat.world.consents.has('personalized_offers')).toBe(true);
  });

  it('returns to the profile when the guest cancels the offers consent', async () => {
    const chat = consentedChat();
    await chat.send('/profile');
    await chat.press('pf:ad:on');

    const cancelled = await chat.press('cs:ad:no:pf');

    expect(answers(cancelled)[0]?.message?.text).toBe(DEFAULT_PROFILE);
    expect(chat.world.consents.has('personalized_offers')).toBe(false);
  });

  it('resets the disliked list', async () => {
    const chat = consentedChat();
    chat.world.user.dislikedTags = ['fish'];
    await chat.send('/profile');

    const reset = await chat.press('pf:tags:reset');

    expect(answers(reset)[0]?.message?.text).toBe(DEFAULT_PROFILE);
    expect(chat.world.user.dislikedTags).toEqual([]);
  });

  it('updates the location from a shared point', async () => {
    const chat = consentedChat();

    const updated = await chat.location({ lat: 55.796389, lon: 49.108891 });

    expect(texts(updated)).toEqual(['Местоположение обновлено, храню его с точностью около 1 км.']);
    expect(chat.world.user.location).toEqual({ lat: 55.8, lon: 49.11 });
  });

  it.each(['pf:kcal:12', 'pf:kcal:abc', 'pf:goal:fly', 'pf:ad:off', 'pf:tags:add', 'pf'])(
    'treats %s as a stale button',
    async (payload) => {
      const chat = consentedChat();
      expect(answers(await chat.press(payload, 'mid.old'))[0]?.notification).toBe('Кнопка устарела');
    },
  );
});

describe('/delete', () => {
  const QUESTION =
    'Удалить аккаунт и все данные: дневник, настройки, согласия? Активные брони отменятся. Это необратимо.';

  it('deletes the account after confirmation and forgets the dialog', async () => {
    const chat = consentedChat();
    chat.world.addMeal('Сырники', 350);
    await chat.send('Непонятно что');
    expect(chat.states.peek(GUEST_ID).flow).not.toBeNull();

    const [question] = sent(await chat.send('/delete'));
    expect(question?.text).toBe(QUESTION);
    expect(question?.buttons).toEqual([
      [
        { type: 'callback', text: 'Да, удалить', payload: 'ac:del_ok' },
        { type: 'callback', text: 'Отмена', payload: 'ac:del_no' },
      ],
    ]);

    const deleted = await chat.press('ac:del_ok');
    expect(answers(deleted)[0]?.message?.text).toBe('Данные удалены. Чтобы начать заново, отправьте /start.');
    expect(chat.world.services.account.deleteAccount).toHaveBeenCalledWith(GUEST_ID);
    expect(chat.world.meals).toHaveLength(0);
    expect(chat.states.peek(GUEST_ID)).toEqual(EMPTY_CHAT_STATE);

    const again = await chat.press('ac:del_ok', question?.messageId);
    expect(answers(again)[0]?.notification).toBe('Эта кнопка уже нажата');
    expect(chat.world.services.account.deleteAccount).toHaveBeenCalledTimes(1);

    expect(texts(await chat.send('Сырники 350'))).toEqual([expect.stringContaining('Чтобы вести дневник')]);
  });

  it('keeps everything when the guest cancels', async () => {
    const chat = consentedChat();
    await chat.send('/delete');

    const kept = await chat.press('ac:del_no');

    expect(answers(kept)[0]?.message?.text).toBe('Хорошо, ничего не удаляю.');
    expect(chat.world.services.account.deleteAccount).not.toHaveBeenCalled();
  });

  it('asks from the profile in place and works without a consent', async () => {
    const chat = botChat();
    const question = await chat.press('ac:del', 'mid.profile');
    expect(answers(question)[0]?.message?.text).toBe(QUESTION);
    expect(texts(await chat.send('/delete'))).toEqual([QUESTION]);
  });

  it('refuses to delete a demo account', async () => {
    const chat = consentedChat();
    chat.world.services.account.deleteAccount = () =>
      Promise.reject(forbidden('demo_account_protected', 'Demo accounts are shared and cannot be deleted'));
    await chat.send('/delete');

    const refused = await chat.press('ac:del_ok');

    expect(refused).toEqual([
      expect.objectContaining({
        kind: 'answer',
        notification: 'Демо-аккаунт удалить нельзя.',
        message: null,
      }),
    ]);
    expect(chat.logger.error).not.toHaveBeenCalled();
  });
});
