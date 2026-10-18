import { payload } from '../bot/callbacks.ts';
import { callback, command } from '../bot/keyboards.ts';
import { bold, dayProgress, distance } from '../bot/texts.ts';
import { dealOverAt } from '../domain/deals.ts';
import type { Booking, Deal, Venue } from '../domain/models.ts';
import { minutesLeft } from '../domain/notifications.ts';
import { escapeMarkdown } from '../integrations/max/messenger.ts';
import type { Button, OutgoingMessage } from '../ports/messenger.ts';
import type { DiaryDay } from '../services/diary.ts';
import type { RecommendedOffer } from '../services/recommendations.ts';
import { plural } from '../shared/plural.ts';
import { formatLocalTime } from '../shared/time.ts';

export interface BookingNotice {
  booking: Booking;
  venue: Venue;
}

export interface DealNotice {
  deal: Deal;
  venue: Venue;
  itemName: string;
}

const NOTICE_BUTTONS = {
  redeem: 'Погасить',
  venueBookings: 'Все брони',
  bookings: 'Брони',
  deals: 'Горящие позиции',
  showQr: 'Показать QR',
  cancel: 'Отменить',
  today: 'Дневник за сегодня',
  pickAnother: 'Подобрать другое',
  book: 'Забронировать',
  notToday: 'Не сегодня',
  unsubscribe: 'Отписаться',
} as const;

const MINUTE_FORMS = ['минуту', 'минуты', 'минут'] as const;

const PROACTIVE_OFFER_TITLE = 'Подсказка по вашему дневнику';

const PORTION_RETURNED = 'Порция вернулась в горящее предложение.';

function message(lines: readonly string[], buttons: Button[][]): OutgoingMessage {
  return { text: lines.join('\n'), format: 'markdown', notify: true, buttons };
}

function expiryTime({ booking, venue }: BookingNotice): string {
  return formatLocalTime(booking.expiresAt, venue.timezone);
}

function place(venue: Venue): string {
  return `${escapeMarkdown(venue.name)}, ${escapeMarkdown(venue.address)}`;
}

function venueBookingsButton(text: string = NOTICE_BUTTONS.venueBookings): Button {
  return callback(text, payload('vn', 'bk'));
}

function venueDealsButton(): Button {
  return callback(NOTICE_BUTTONS.deals, payload('vn', 'deals'));
}

function guestBookingButtons(booking: Booking): Button[][] {
  return [
    [
      callback(NOTICE_BUTTONS.showQr, payload('bk', 'qr', booking.id)),
      callback(NOTICE_BUTTONS.cancel, payload('bk', 'cancel', booking.id)),
    ],
  ];
}

export function bookingConfirmedMessage(notice: BookingNotice): OutgoingMessage {
  const { booking, venue } = notice;
  return message(
    [
      bold(`Бронь ${booking.code} подтверждена`),
      `${escapeMarkdown(booking.itemName)}, ${booking.priceRub} ₽`,
      place(venue),
      `Покажите код или QR на кассе до ${expiryTime(notice)}.`,
    ],
    guestBookingButtons(booking),
  );
}

export function bookingReminderMessage(notice: BookingNotice, now: Date): OutgoingMessage {
  const { booking, venue } = notice;
  const minutes = minutesLeft(booking.expiresAt, now);
  return message(
    [
      `Бронь ${booking.code} действует ещё ${minutes} ${plural(minutes, MINUTE_FORMS)}, до ${expiryTime(notice)}: ${escapeMarkdown(booking.itemName)}, ${place(venue)}.`,
    ],
    guestBookingButtons(booking),
  );
}

export function bookingCreatedMessage(notice: BookingNotice): OutgoingMessage {
  const { booking } = notice;
  return message(
    [
      bold(`Новая бронь ${booking.code}`),
      `${escapeMarkdown(booking.itemName)}, ${booking.priceRub} ₽`,
      `Действует до ${expiryTime(notice)}`,
    ],
    [[callback(NOTICE_BUTTONS.redeem, payload('vn', 'rd', booking.code)), venueBookingsButton()]],
  );
}

export function bookingCancelledMessage({ booking }: BookingNotice): OutgoingMessage {
  return message(
    [
      `Гость отменил бронь ${booking.code}: ${escapeMarkdown(booking.itemName)}.`,
      ...(booking.dealId === null ? [] : [PORTION_RETURNED]),
    ],
    [[venueBookingsButton()]],
  );
}

export function venueBookingExpiredMessage(notice: BookingNotice, portionReturned: boolean): OutgoingMessage {
  const { booking } = notice;
  return message(
    [
      `Бронь ${booking.code} истекла в ${expiryTime(notice)}: ${escapeMarkdown(booking.itemName)}. Гость не пришёл.`,
      ...(portionReturned ? [PORTION_RETURNED] : []),
    ],
    [[venueBookingsButton()]],
  );
}

export function bookingRedeemedMessage({ booking }: BookingNotice, day: DiaryDay | null): OutgoingMessage {
  return message(
    [
      `Приятного аппетита! В дневник записано: ${escapeMarkdown(booking.itemName)}, около ${booking.kcal} ккал.`,
      ...(day === null ? [] : [dayProgress(day.totals.kcal, day.targetKcal, day.remainingKcal)]),
    ],
    [[command(NOTICE_BUTTONS.today, 'today')]],
  );
}

export function bookingExpiredMessage(notice: BookingNotice): OutgoingMessage {
  const { booking, venue } = notice;
  return message(
    [
      `Бронь ${booking.code} истекла в ${expiryTime(notice)}: ${escapeMarkdown(booking.itemName)}, ${escapeMarkdown(venue.name)}. Код больше не действует.`,
    ],
    [[command(NOTICE_BUTTONS.pickAnother, 'eat')]],
  );
}

export function dealSoldOutMessage({ deal, itemName }: DealNotice): OutgoingMessage {
  return message(
    [
      `Горящая позиция забронирована целиком: ${escapeMarkdown(itemName)}, ${deal.quantityTotal} шт. по ${deal.priceRub} ₽. Новые брони появятся, только если гость отменит свою или она истечёт.`,
    ],
    [[venueBookingsButton(NOTICE_BUTTONS.bookings), venueDealsButton()]],
  );
}

export function dealEndingMessage({ deal, venue, itemName }: DealNotice): OutgoingMessage {
  const until = formatLocalTime(dealOverAt(deal, venue), venue.timezone);
  return message(
    [
      `Горящая позиция «${escapeMarkdown(itemName)}» закончится в ${until}, осталось ${deal.quantityLeft} из ${deal.quantityTotal}. Продлить до закрытия можно в кабинете.`,
    ],
    [[venueDealsButton()]],
  );
}

export function proactiveOfferMessage(offer: RecommendedOffer): OutgoingMessage {
  const { item, venue, deal, explanation } = offer;
  const summary = [
    `${offer.priceRub} ₽`,
    `около ${offer.kcal} ккал`,
    ...(offer.distanceM === null ? [] : [`${distance(offer.distanceM)} от вас`]),
  ];
  return message(
    [
      PROACTIVE_OFFER_TITLE,
      '',
      bold(explanation.headline),
      escapeMarkdown(item.name),
      place(venue),
      summary.join(', '),
      '',
      'Почему:',
      ...[...explanation.facts, ...explanation.calculations].map((line) => `- ${escapeMarkdown(line)}`),
      ...explanation.assumptions.map((line) => `*${escapeMarkdown(line)}*`),
    ],
    [
      [callback(NOTICE_BUTTONS.book, payload('bk', 'new', item.id, deal?.deal.id ?? 0, offer.offerId))],
      [
        callback(NOTICE_BUTTONS.notToday, payload('of', 'nt', offer.offerId)),
        callback(NOTICE_BUTTONS.unsubscribe, payload('cs', 'ad', 'off')),
      ],
    ],
  );
}
