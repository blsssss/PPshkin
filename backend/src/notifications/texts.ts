import { payload } from '../bot/callbacks.ts';
import { callback, command } from '../bot/keyboards.ts';
import { bold, dayProgress, distance } from '../bot/texts.ts';
import { ROLE_LABELS } from '../bot/venue/texts.ts';
import { dealOverAt } from '../domain/deals.ts';
import type { Booking, Company, Deal, Venue } from '../domain/models.ts';
import type { Role } from '../domain/roles.ts';
import {
  COMPLAINT_REASON_TEXTS,
  SIGNAL_OPEN_COMPLAINTS,
  SIGNAL_REDEEM_RATE,
  SIGNAL_WINDOW_DAYS,
  VENUE_BLOCKED_GUEST_TEXT,
  type AdminComplaint,
  type VenueSignal,
} from '../domain/moderation.ts';
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
  remindNoMore: 'Не напоминать',
  sendNoMore: 'Не присылать',
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
    [
      ...guestBookingButtons(booking),
      [callback(NOTICE_BUTTONS.remindNoMore, payload('nt', 'off', 'booking_reminder'))],
    ],
  );
}

export function bookingCreatedMessage(notice: BookingNotice): OutgoingMessage {
  const { booking, venue } = notice;
  return message(
    [
      bold(`Новая бронь ${booking.code}`),
      `${escapeMarkdown(booking.itemName)}, ${booking.priceRub} ₽`,
      `Действует до ${expiryTime(notice)}`,
    ],
    [[callback(NOTICE_BUTTONS.redeem, payload('vn', 'rd', booking.code, venue.id)), venueBookingsButton()]],
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
    [[venueDealsButton()], [callback(NOTICE_BUTTONS.sendNoMore, payload('nt', 'off', 'venue_deal_ending'))]],
  );
}

export function accountInactiveMessage(): OutgoingMessage {
  return message(
    ['Аккаунт удалится через 14 дней, потому что вы давно не заходили. Чтобы сохранить его, откройте бот.'],
    [],
  );
}

export function bookingVenueBlockedMessage({ booking }: BookingNotice): OutgoingMessage {
  return message(
    [
      bold(VENUE_BLOCKED_GUEST_TEXT),
      `Бронь ${booking.code}: ${escapeMarkdown(booking.itemName)}. Порция возвращена.`,
    ],
    [[command(NOTICE_BUTTONS.pickAnother, 'eat')]],
  );
}

export function venueBlockedMessage(reason: string | null): OutgoingMessage {
  return message(
    [
      bold(`Заведение приостановлено: ${escapeMarkdown(reason ?? 'причина не указана')}`),
      'Горящие позиции сняты, активные брони отменены. Если считаете, что это ошибка, напишите в поддержку.',
    ],
    [],
  );
}

export function venueComplaintMessage(complaint: AdminComplaint, venue: Venue): OutgoingMessage {
  return message(
    [
      bold('Жалоба гостя'),
      COMPLAINT_REASON_TEXTS[complaint.reason],
      ...(complaint.bookingCode === null ? [] : [`Бронь ${complaint.bookingCode}`]),
      formatLocalTime(complaint.createdAt, venue.timezone),
    ],
    [[venueBookingsButton()]],
  );
}

export function complaintCreatedMessage(complaint: AdminComplaint, venue: Venue): OutgoingMessage {
  return message(
    [
      bold(`Новая жалоба №${complaint.id}`),
      `Заведение: ${escapeMarkdown(venue.name)}`,
      ...(complaint.bookingCode === null
        ? []
        : [`Бронь ${complaint.bookingCode}: ${escapeMarkdown(complaint.itemName ?? '')}`]),
      `Причина: ${COMPLAINT_REASON_TEXTS[complaint.reason]}`,
      ...(complaint.text === null ? [] : [escapeMarkdown(complaint.text)]),
      formatLocalTime(complaint.createdAt, venue.timezone),
    ],
    [[callback('Разобрать', payload('ad', 'cl'))]],
  );
}

export function complaintDecidedMessage(complaint: AdminComplaint): OutgoingMessage {
  const verdict =
    complaint.status === 'resolved'
      ? `Мы разобрались с вашей жалобой на «${escapeMarkdown(complaint.venueName)}». Спасибо, что сообщили.`
      : `Мы рассмотрели вашу жалобу на «${escapeMarkdown(complaint.venueName)}» и не нашли нарушения.`;
  return message(
    [verdict, ...(complaint.resolution === null ? [] : [escapeMarkdown(complaint.resolution)])],
    [],
  );
}

export function signalsMessage(signals: readonly VenueSignal[]): OutgoingMessage {
  return message(
    [
      bold(`Заведения, на которые стоит посмотреть, за ${SIGNAL_WINDOW_DAYS} дней`),
      ...signals.map((signal) => {
        const facts = [
          ...(signal.reasons.includes('open_complaints')
            ? [`открытых жалоб: ${signal.openComplaints} (порог ${SIGNAL_OPEN_COMPLAINTS})`]
            : []),
          ...(signal.reasons.includes('low_redeem_rate') && signal.redeemRate !== null
            ? [
                `погашено ${Math.round(signal.redeemRate * 100)}% из ${signal.bookings} броней (порог ${Math.round(SIGNAL_REDEEM_RATE * 100)}%)`,
              ]
            : []),
        ];
        return `- ${escapeMarkdown(signal.name)}: ${facts.join(', ')}`;
      }),
    ],
    [],
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

export function staffJoinedMessage(
  name: string | null,
  role: Role,
  companyName: string,
  venueName: string | null,
): OutgoingMessage {
  const who = name === null ? 'Сотрудник' : escapeMarkdown(name);
  return message(
    [
      bold(`${who} принял приглашение`),
      `${ROLE_LABELS[role]}, ${venueName === null ? 'все заведения' : `«${escapeMarkdown(venueName)}»`}, компания «${escapeMarkdown(companyName)}».`,
    ],
    [],
  );
}

export function staffRemovedMessage(companyName: string, venueName: string | null): OutgoingMessage {
  return message(
    [
      bold(
        venueName === null
          ? `Доступ к заведениям компании «${escapeMarkdown(companyName)}» закрыт`
          : `Доступ к «${escapeMarkdown(venueName)}» закрыт`,
      ),
    ],
    [],
  );
}

export function companyPendingMessage(company: Company): OutgoingMessage {
  return message(
    [
      bold('Компания на проверку'),
      escapeMarkdown(company.name),
      `ИНН ${company.inn ?? 'не указан'}${company.ogrn === null ? '' : `, ОГРН ${company.ogrn}`}`,
      ...(company.okved === null ? [] : [`ОКВЭД ${company.okved}`]),
    ],
    [],
  );
}
