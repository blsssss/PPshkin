import { describe, expect, it, vi } from 'vitest';
import { answers, botChat, GUEST_ID, guestWorld, labels, payloads, type BotChat } from '../../../test/bot.ts';
import {
  DEFAULT_QUIET_HOURS,
  isKindEnabled,
  NOTIFICATION_KIND_DESCRIPTIONS,
  settingsKinds,
  type NotificationKind,
  type QuietHours,
} from '../../domain/notifications.ts';
import type {
  NotificationSettings,
  NotificationSettingsService,
} from '../../services/notification-settings.ts';
import { unprocessable } from '../../shared/errors.ts';

function settingsFake(hasVenue: boolean) {
  const disabled = new Set<NotificationKind>();
  let quietHours: QuietHours | null = DEFAULT_QUIET_HOURS;
  const present = (): NotificationSettings => ({
    timezone: 'Europe/Moscow',
    quietHours,
    kinds: settingsKinds(hasVenue).map((kind) => ({
      kind,
      audience: NOTIFICATION_KIND_DESCRIPTIONS[kind].audience,
      editable: NOTIFICATION_KIND_DESCRIPTIONS[kind].editable,
      enabled: isKindEnabled(kind, { disabledKinds: [...disabled], quietHours }),
    })),
  });
  const service: NotificationSettingsService = {
    get: vi.fn(() => Promise.resolve(present())),
    update: vi.fn<NotificationSettingsService['update']>((_userId, patch) => {
      for (const { kind, enabled } of patch.kinds ?? []) {
        const { audience, editable } = NOTIFICATION_KIND_DESCRIPTIONS[kind];
        if (!editable || (audience === 'venue' && !hasVenue)) {
          return Promise.reject(unprocessable('notification_not_editable', 'Not editable'));
        }
        if (enabled) disabled.delete(kind);
        else disabled.add(kind);
      }
      if (patch.quietHours !== undefined) quietHours = patch.quietHours;
      return Promise.resolve(present());
    }),
  };
  return { service, disabled };
}

function chatWith(
  hasVenue = false,
  miniAppEnabled = false,
): { chat: BotChat; fake: ReturnType<typeof settingsFake> } {
  const fake = settingsFake(hasVenue);
  const world = guestWorld({ services: { notificationSettings: fake.service } });
  world.consent('personal_data');
  return { chat: botChat({ world, miniAppEnabled }), fake };
}

const GUEST_TOGGLES = [
  'Бронь подтверждена: вкл',
  'Напоминание о брони: вкл',
  'Бронь получена: вкл',
  'Бронь истекла: вкл',
];

describe('notification buttons in messages', () => {
  it('turns booking reminders off with one tap and keeps the message', async () => {
    const { chat, fake } = chatWith();

    const [answer] = answers(await chat.press('nt:off:booking_reminder', 'mid.reminder'));

    expect(answer).toMatchObject({
      notification: 'Больше не пришлю такие сообщения. Включить снова: /profile, «Уведомления».',
      message: null,
    });
    expect(fake.service.update).toHaveBeenCalledExactlyOnceWith(GUEST_ID, {
      kinds: [{ kind: 'booking_reminder', enabled: false }],
    });
    expect(fake.disabled.has('booking_reminder')).toBe(true);
  });

  it('works without the consent to process data, so anyone can stop the messages', async () => {
    const fake = settingsFake(true);
    const chat = botChat({ world: guestWorld({ services: { notificationSettings: fake.service } }) });

    await chat.press('nt:off:venue_deal_ending', 'mid.deal');

    expect(fake.disabled.has('venue_deal_ending')).toBe(true);
  });

  it('ignores kinds that cannot be turned off and broken buttons', async () => {
    const { chat, fake } = chatWith(true);

    expect(answers(await chat.press('nt:off:menu_import_done', 'mid.a'))[0]?.notification).toBe(
      'Кнопка устарела',
    );
    expect(answers(await chat.press('nt:off:spam', 'mid.b'))[0]?.notification).toBe('Кнопка устарела');
    expect(fake.service.update).not.toHaveBeenCalled();
  });
});

describe('notifications in /profile', () => {
  it('lists only the guest kinds for a guest and toggles them', async () => {
    const { chat, fake } = chatWith();

    const [screen] = answers(await chat.press('nt:ls', 'mid.profile'));
    expect(screen?.message?.text).toBe(
      [
        '**Уведомления**',
        'Тихие часы: 22:00-09:00',
        'В тихие часы сообщения о бронях приходят без звука, итоги дня после их окончания.',
        'Нажмите на тип, чтобы включить или выключить его.',
      ].join('\n'),
    );
    expect(labels(screen?.message)).toEqual([...GUEST_TOGGLES, 'Назад']);
    expect(payloads(screen?.message)).toContain('nt:tg:booking_reminder');

    const [toggled] = answers(await chat.press('nt:tg:booking_reminder', 'mid.profile'));
    expect(labels(toggled?.message)[1]).toBe('Напоминание о брони: выкл');
    expect(fake.disabled.has('booking_reminder')).toBe(true);

    const [again] = answers(await chat.press('nt:tg:booking_reminder', 'mid.profile'));
    expect(labels(again?.message)[1]).toBe('Напоминание о брони: вкл');
  });

  it('adds the venue kinds for an owner, without the menu import that is always sent', async () => {
    const { chat } = chatWith(true);

    const [screen] = answers(await chat.press('nt:ls', 'mid.profile'));

    expect(labels(screen?.message)).toEqual([
      ...GUEST_TOGGLES,
      'Новая бронь: вкл',
      'Гость отменил бронь: вкл',
      'Гость не пришёл: вкл',
      'Позиция забронирована целиком: вкл',
      'Горящая позиция скоро закончится: вкл',
      'Итоги дня и недели: вкл',
      'Назад',
    ]);
  });

  it('opens the mini app screen when the mini app is enabled and goes back to the profile', async () => {
    const { chat } = chatWith(false, true);

    const [screen] = answers(await chat.press('nt:ls', 'mid.profile'));
    expect(screen?.message?.buttons.at(-2)).toEqual([
      { type: 'link', text: 'Настроить', url: 'https://max.ru/ppshkin_bot?startapp=notifications' },
    ]);

    const [profile] = answers(await chat.press('nt:back', 'mid.profile'));
    expect(profile?.message?.text).toMatch(/^\*\*Профиль\*\*/);
  });

  it('shows switched off quiet hours', async () => {
    const { chat, fake } = chatWith();
    await fake.service.update(GUEST_ID, { quietHours: null });

    const [screen] = answers(await chat.press('nt:ls', 'mid.profile'));

    expect(screen?.message?.text.split('\n').slice(1)).toEqual([
      'Тихие часы: выключены',
      'Нажмите на тип, чтобы включить или выключить его.',
    ]);
  });
});
