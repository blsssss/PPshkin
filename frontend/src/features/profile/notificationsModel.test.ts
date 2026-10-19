import { describe, expect, it } from 'vitest';
import {
  enabledSummary,
  groupKinds,
  NOTIFICATION_LABELS,
  QUIET_TIME_OPTIONS,
  quietHoursCaption,
  quietHoursError,
  type NotificationSettings,
} from './notificationsModel.ts';

const settings: NotificationSettings = {
  timezone: 'Europe/Moscow',
  quietHours: { from: '22:00', until: '09:00' },
  kinds: [
    { kind: 'booking_confirmed', audience: 'guest', enabled: true, editable: true },
    { kind: 'booking_reminder', audience: 'guest', enabled: false, editable: true },
    { kind: 'venue_booking_created', audience: 'venue', enabled: true, editable: true },
    { kind: 'menu_import_done', audience: 'venue', enabled: true, editable: false },
  ],
};

describe('notifications model', () => {
  it('uses the same labels as the bot', () => {
    expect(NOTIFICATION_LABELS.booking_reminder).toEqual({
      label: 'Напоминание о брони',
      hint: 'За 10 минут до конца брони',
    });
    expect(NOTIFICATION_LABELS.menu_import_done.label).toBe('Разбор меню');
    expect(Object.keys(NOTIFICATION_LABELS)).toHaveLength(11);
  });

  it('splits the kinds into the guest and the venue groups', () => {
    const groups = groupKinds(settings);
    expect(groups.guest.map((item) => item.kind)).toEqual(['booking_confirmed', 'booking_reminder']);
    expect(groups.venue.map((item) => item.kind)).toEqual(['venue_booking_created', 'menu_import_done']);
    expect(groupKinds({ ...settings, kinds: settings.kinds.slice(0, 2) }).venue).toEqual([]);
  });

  it('counts only the kinds the user can switch', () => {
    expect(enabledSummary(settings)).toBe('Включено 2 из 3');
    expect(
      enabledSummary({
        ...settings,
        kinds: settings.kinds.map((item) => ({ ...item, enabled: !item.editable })),
      }),
    ).toBe('Все выключены');
  });

  it('offers times with a 30 minute step', () => {
    expect(QUIET_TIME_OPTIONS).toHaveLength(48);
    expect(QUIET_TIME_OPTIONS.slice(0, 3)).toEqual(['00:00', '00:30', '01:00']);
    expect(QUIET_TIME_OPTIONS.at(-1)).toBe('23:30');
  });

  it('describes the quiet hours with the time zone and checks the interval', () => {
    expect(quietHoursCaption({ from: '22:00', until: '09:00' }, 'Europe/Moscow')).toBe(
      'С 22:00 до 09:00 сообщения о бронях приходят без звука, итоги дня после 09:00. Часовой пояс: Europe/Moscow',
    );
    expect(quietHoursError({ from: '23:00', until: '23:00' })).toBe(
      'Начало и конец тихих часов должны отличаться',
    );
    expect(quietHoursError({ from: '23:00', until: '07:30' })).toBeNull();
  });
});
