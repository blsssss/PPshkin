import type { Schemas } from '../../api/client.ts';

export type NotificationSettings = Schemas['NotificationSettings'];
export type NotificationKindSetting = NotificationSettings['kinds'][number];
export type NotificationKind = NotificationKindSetting['kind'];
export type QuietHours = NonNullable<NotificationSettings['quietHours']>;

export const DEFAULT_QUIET_HOURS: QuietHours = { from: '22:00', until: '09:00' };

export const NOTIFICATION_LABELS: Record<NotificationKind, { label: string; hint: string }> = {
  booking_confirmed: {
    label: 'Бронь подтверждена',
    hint: 'Код и QR в чат, если бронировали в мини-приложении',
  },
  booking_reminder: { label: 'Напоминание о брони', hint: 'За 10 минут до конца брони' },
  booking_redeemed: { label: 'Бронь получена', hint: 'Что записано в дневник и сколько осталось на сегодня' },
  booking_expired: { label: 'Бронь истекла', hint: 'Если не успели забрать' },
  venue_booking_created: { label: 'Новая бронь', hint: 'Код, позиция и срок' },
  venue_booking_cancelled: { label: 'Гость отменил бронь', hint: 'Порция возвращается в продажу' },
  venue_booking_expired: { label: 'Гость не пришёл', hint: 'Бронь истекла, порция вернулась в продажу' },
  venue_deal_sold_out: {
    label: 'Позиция забронирована целиком',
    hint: 'Все порции горящей позиции забронированы',
  },
  venue_deal_ending: { label: 'Горящая позиция скоро закончится', hint: 'За 30 минут, если остались порции' },
  venue_report_ready: { label: 'Итоги дня и недели', hint: 'Закрытие дня и отчёт за неделю' },
  menu_import_done: { label: 'Разбор меню', hint: 'Приходит всегда после загрузки меню' },
};

export interface NotificationGroups {
  guest: NotificationKindSetting[];
  venue: NotificationKindSetting[];
}

export function groupKinds(settings: NotificationSettings): NotificationGroups {
  return {
    guest: settings.kinds.filter((item) => item.audience === 'guest'),
    venue: settings.kinds.filter((item) => item.audience === 'venue'),
  };
}

export function enabledSummary(settings: NotificationSettings): string {
  const editable = settings.kinds.filter((item) => item.editable);
  const enabled = editable.filter((item) => item.enabled).length;
  return enabled === 0 ? 'Все выключены' : `Включено ${String(enabled)} из ${String(editable.length)}`;
}

const STEP_MINUTES = 30;

export const QUIET_TIME_OPTIONS: readonly string[] = Array.from(
  { length: (24 * 60) / STEP_MINUTES },
  (_, index) => {
    const minutes = index * STEP_MINUTES;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  },
);

export function quietHoursCaption(quietHours: QuietHours, timezone: string): string {
  return `С ${quietHours.from} до ${quietHours.until} сообщения о бронях приходят без звука, итоги дня после ${quietHours.until}. Часовой пояс: ${timezone}`;
}

export function quietHoursError(quietHours: QuietHours): string | null {
  return quietHours.from === quietHours.until ? 'Начало и конец тихих часов должны отличаться' : null;
}
