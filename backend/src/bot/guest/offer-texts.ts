import type { BookingStatus } from '../../domain/vocabulary.ts';
import { escapeMarkdown } from '../../integrations/max/messenger.ts';
import { plural } from '../../shared/plural.ts';
import { bold, distance } from '../texts.ts';

const MEAL_FORMS = ['приём', 'приёма', 'приёмов'] as const;

export const OFFER_BUTTONS = {
  book: 'Забронировать',
  other: 'Другое',
  notToday: 'Не сегодня',
  dislike: 'Не люблю такое',
  elsewhere: 'Я в другом месте',
  anywhere: 'Искать по всему городу',
  howToLog: 'Как записать еду',
  stopHints: 'Не присылать подсказки',
  showQr: 'Показать QR',
  cancelBooking: 'Отменить бронь',
  confirmCancel: 'Да, отменить',
  keepBooking: 'Нет',
} as const;

export const OFFER_NOTICES = {
  booking: 'Бронирую',
  noMoreOffers: 'Больше вариантов рядом сейчас нет. Загляните позже.',
  qrFailed: 'Не получилось показать QR. Покажите код на кассе.',
  dislikedFull: 'Список «Не предлагать» заполнен. Сбросить его можно в /profile.',
} as const;

export const WHERE_ARE_YOU = 'Где вы? Отправьте местоположение, чтобы искать рядом.';
export const PROFILE_EMPTY = 'Пока в дневнике нет записей. Пришлите фото еды, и я начну подбирать под вас.';
export const WHY = 'Почему:';
export const NOT_TODAY_ACCEPTED = 'Хорошо, сегодня это не предложу.';
export const DISLIKE_ACCEPTED = 'Понял, это блюдо больше не предложу.';
export const NO_ACTIVE_BOOKINGS = 'Активных броней нет. Подобрать блюдо: /eat';
export const HISTORY_TITLE = bold('История');

const BOOKING_STATUS_LABELS: Record<Exclude<BookingStatus, 'active'>, string> = {
  redeemed: 'погашена',
  cancelled: 'отменена',
  expired: 'истекла',
};

export function budgetExhausted(remainingKcal: number): string {
  return `На сегодня ориентир почти набран: осталось около ${remainingKcal} ккал. Новые блюда сегодня не предлагаю. Ориентир можно изменить в /profile.`;
}

export function nothingFits(remainingKcal: number, nearby: boolean): string {
  const where = nearby ? 'Сейчас рядом нет' : 'Сейчас нет';
  return `${where} подходящих блюд: заведения закрыты или блюда больше вашего остатка (около ${remainingKcal} ккал).`;
}

export function profileCollecting(mealsUntilReady: number): string {
  const more =
    mealsUntilReady > 0
      ? `запишите ещё ${mealsUntilReady} ${plural(mealsUntilReady, MEAL_FORMS)} пищи`
      : 'записывайте еду ещё пару дней';
  return `Профиль вкусов ещё собирается: ${more}, и подбор станет точнее`;
}

export function offerFacts(priceRub: number, kcal: number, distanceM: number | null): string {
  const facts = `${priceRub} ₽, около ${kcal} ккал`;
  return distanceM === null ? facts : `${facts}, ${distance(distanceM)} от вас`;
}

export function dislikedNow(labels: readonly string[]): string {
  return `Не предлагаю: ${labels.join(', ')}. Сбросить можно в /profile.`;
}

export function dislikeTag(label: string): string {
  return `Не предлагать: ${label}`;
}

export function bookDeal(itemName: string, priceRub: number): string {
  return `${OFFER_BUTTONS.book}: ${itemName}, ${priceRub} ₽`;
}

export function bookingTitle(code: string): string {
  return bold(`Бронь ${code}`);
}

export function bookingItem(itemName: string, priceRub: number): string {
  return `${escapeMarkdown(itemName)}, ${priceRub} ₽`;
}

export function bookingValidUntil(time: string): string {
  return `Действует до ${time}. Покажите код или QR на кассе.`;
}

export function cancelQuestion(code: string): string {
  return `Отменить бронь ${code}?`;
}

export function bookingCancelled(code: string): string {
  return `Бронь ${code} отменена.`;
}

export function bookingInactive(code: string): string {
  return `Бронь ${code} уже не активна.`;
}

export function historyLine(
  date: string,
  itemName: string,
  venueName: string,
  status: Exclude<BookingStatus, 'active'>,
): string {
  return `${date} ${escapeMarkdown(itemName)}, ${escapeMarkdown(venueName)}: ${BOOKING_STATUS_LABELS[status]}`;
}

const shortDateFormatters = new Map<string, Intl.DateTimeFormat>();

export function shortDate(instant: Date, timeZone: string): string {
  let formatter = shortDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone });
    shortDateFormatters.set(timeZone, formatter);
  }
  return formatter.format(instant);
}
