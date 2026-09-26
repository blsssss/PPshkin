import { payload } from '../bot/callbacks.ts';
import { callback, command } from '../bot/keyboards.ts';
import { bold, dayProgress, distance } from '../bot/texts.ts';
import { escapeMarkdown } from '../integrations/max/messenger.ts';
import type { Button, OutgoingMessage } from '../ports/messenger.ts';
import type { BookingNotice } from '../ports/notifier.ts';
import type { DiaryDay } from '../services/diary.ts';
import type { RecommendedOffer } from '../services/recommendations.ts';
import { formatLocalTime } from '../shared/time.ts';

const NOTICE_BUTTONS = {
  redeem: 'Погасить',
  venueBookings: 'Все брони',
  today: 'Дневник за сегодня',
  pickAnother: 'Подобрать другое',
  book: 'Забронировать',
  notToday: 'Не сегодня',
  unsubscribe: 'Отписаться',
} as const;

const PROACTIVE_OFFER_TITLE = 'Подсказка по вашему дневнику';

function message(lines: readonly string[], buttons: Button[][]): OutgoingMessage {
  return { text: lines.join('\n'), format: 'markdown', notify: true, buttons };
}

function expiryTime({ booking, venue }: BookingNotice): string {
  return formatLocalTime(booking.expiresAt, venue.timezone);
}

function venueBookingsButton(): Button {
  return callback(NOTICE_BUTTONS.venueBookings, payload('vn', 'bk'));
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
      ...(booking.dealId === null ? [] : ['Порция вернулась в горящее предложение.']),
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
      `${escapeMarkdown(venue.name)}, ${escapeMarkdown(venue.address)}`,
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
