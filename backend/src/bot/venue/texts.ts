import type { MenuItem, ParsedMenuItem, Venue } from '../../domain/models.ts';
import { MENU_CATEGORY_LABELS, VENUE_CATEGORY_LABELS } from '../../domain/vocabulary.ts';
import { escapeMarkdown } from '../../integrations/max/messenger.ts';
import { DEFAULT_ANALYTICS_DAYS, type VenueAnalytics } from '../../services/analytics.ts';
import type { BookingView } from '../../services/bookings.ts';
import type { DealView } from '../../services/deals.ts';
import { plural } from '../../shared/plural.ts';
import { formatLocalTime } from '../../shared/time.ts';
import {
  bold,
  DEMO_VENUE,
  limitedLines,
  localDateLabel,
  MESSAGE_LIMIT,
  OFFER_FORMS,
  TITLE_IN_LIST_LIMIT,
  truncate,
} from '../texts.ts';
import type { VenueDraft } from './flows.ts';
import { DEAL_QUANTITY_LIMIT, MENU_TEXT_LIMIT, VENUE_ADDRESS_LIMIT, VENUE_NAME_LIMIT } from './input.ts';

type PluralForms = readonly [one: string, few: string, many: string];

const ITEM_FORMS: PluralForms = ['позиция', 'позиции', 'позиций'];
const ITEM_OBJECT_FORMS: PluralForms = ['позицию', 'позиции', 'позиций'];
const ADDED_FORMS: PluralForms = ['Добавлена', 'Добавлено', 'Добавлено'];
const SKIPPED_FORMS: PluralForms = ['пропущена', 'пропущено', 'пропущено'];
const BOOKING_FORMS: PluralForms = ['бронь', 'брони', 'броней'];
const DAY_FORMS: PluralForms = ['день', 'дня', 'дней'];

const MENU_LINES_LIMIT = 60;
const IMPORT_LINES_LIMIT = 30;
const DEAL_LINES_LIMIT = 20;
const BOOKING_LINES_LIMIT = 20;
const SKIPPED_NAMES_LIMIT = 10;

export const VENUE_BUTTONS = {
  create: 'Создать заведение',
  menu: 'Меню',
  deals: 'Горящее',
  bookings: 'Брони',
  redeem: 'Погасить код',
  stats: 'Статистика',
  openApp: 'Открыть кабинет',
  home: 'Главное меню',
  upload: 'Загрузить меню',
  later: 'Позже',
  sendPoint: 'Отправить точку',
  checkOnMap: 'Проверить на карте',
  confirmCreate: 'Создать',
  restart: 'Заново',
  allDay: 'Круглосуточно',
  otherHours: 'Другие',
  applyAll: 'Добавить всё',
  openImport: 'Открыть в кабинете',
  uploadAgain: 'Загрузить заново',
  retry: 'Попробовать ещё раз',
  newDeal: 'Новое горящее предложение',
  publishDeal: 'Выставить горящее',
  anotherDeal: 'Ещё одно',
  back: 'Назад',
  more: 'Ещё',
  otherQuantity: 'Другое',
  customPrice: 'Своя цена',
  oneHour: '1 час',
  twoHours: '2 часа',
  untilClosing: 'До закрытия',
  publish: 'Опубликовать',
  stopDeal: 'Снять',
  confirmStop: 'Да, снять',
  redeemBooking: 'Погасить',
  redeemMore: 'Погасить ещё',
  today: 'Сегодня',
  week: '7 дней',
} as const;

export const VENUE_ERROR_TEXTS = {
  venue_not_found: 'Сначала подключите заведение: /venue',
  venue_exists: 'У вас уже есть заведение',
  import_in_progress: 'Предыдущее меню ещё распознаётся, подождите немного',
  import_limit_reached:
    'Сегодня загружено 20 меню, это дневной лимит. Добавьте позиции в кабинете или попробуйте завтра',
  import_already_applied: 'Это меню уже добавлено',
  import_not_ready: 'Меню ещё распознаётся, подождите немного',
  import_not_found: 'Это меню не найдено, загрузите его заново',
  deal_exists: 'На эту позицию уже есть горящее предложение',
  deal_price_not_lower: 'Цена со скидкой должна быть ниже обычной',
  deal_window_invalid: 'Время окончания должно быть в ближайшие 24 часа',
  menu_item_unavailable: 'Позиция скрыта от гостей, включите её в кабинете',
  menu_item_not_found: 'Позиция уже удалена, обновите список',
  deal_not_found: 'Позиция уже удалена, обновите список',
  booking_not_found: 'Бронь с таким кодом не найдена в вашем заведении',
  booking_expired: 'Срок брони истёк. Гость может оформить новую',
  booking_not_active: 'Бронь уже погашена или отменена',
} as const;

export type VenueErrorCode = keyof typeof VENUE_ERROR_TEXTS;

export const WIZARD_STALE = 'Мастер устарел, начните заново';

export const CONNECT_VENUE =
  'Подключите заведение: гости рядом увидят ваши блюда и горящие предложения в подборе, а брони придут сюда.';

export const NAME_QUESTION = 'Как называется заведение? Так его увидят гости.';
export const ADDRESS_QUESTION = 'Адрес для гостей, например: ул. Баумана, 36';
export const POINT_QUESTION = [
  'Отправьте точку заведения: нажмите кнопку, находясь в заведении, или пришлите координаты текстом, например: 55.7887, 49.1221.',
  'В Яндекс Картах координаты копируются нажатием на место.',
].join(' ');
export const CATEGORY_QUESTION = 'Что за заведение?';
export const HOURS_QUESTION = 'Часы работы?';
export const HOURS_PROMPT =
  'Напишите часы работы, например: 07:30-20:00. Если закрываетесь после полуночи, так и пишите: 18:00-02:00.';
export const NAME_INVALID = `Название нужно текстом, от 1 до ${VENUE_NAME_LIMIT} символов.`;
export const ADDRESS_INVALID = `Адрес нужен текстом, от 1 до ${VENUE_ADDRESS_LIMIT} символов.`;
export const POINT_INVALID =
  'Не понял координаты. Нужны широта от -90 до 90 и долгота от -180 до 180 через запятую, например: 55.7887, 49.1221';
export const HOURS_INVALID = 'Не понял часы работы. Напишите так: 08:00-22:00';
export const CHOOSE_BUTTON = 'Выберите вариант кнопкой.';
export const VENUE_CREATED = 'Заведение создано. Следующий шаг: загрузите меню, это займёт минуту.';
export const CREATE_CANCELLED = 'Хорошо, отменил. Подключить заведение можно в любой момент: /venue';

export const MENU_EMPTY = 'Меню пока пустое. Загрузите его фотографией или текстом.';
export const UPLOAD_PROMPT =
  'Пришлите фото меню (одно, чётко и целиком) или вставьте текст меню: каждая позиция с новой строки, с ценой, например: Эклер 150 г 200 ₽';
export const UPLOAD_CANCELLED = 'Хорошо, меню не загружаю.';
export const MENU_PHOTO_TOO_LARGE = 'Фото слишком большое, пришлите до 10 МБ';
export const MENU_TEXT_TOO_LONG = `Текст меню длиннее ${MENU_TEXT_LIMIT} символов, пришлите его частями.`;
export const MENU_TEXT_WITHOUT_PRICES =
  'Не вижу цен. Вставьте текст меню: каждая позиция с новой строки, с ценой, например: Эклер 150 г 200 ₽';
export const RECOGNIZING_PHOTO = 'Распознаю меню, обычно это 15-30 секунд. Пришлю результат сюда.';
export const RECOGNIZING_TEXT = 'Разбираю меню, это несколько секунд.';
export const IMPORT_TIMEOUT = 'Распознавание затянулось. Попробуйте ещё раз или откройте кабинет.';
export const IMPORT_FAILED = 'Не получилось распознать меню, попробуйте ещё раз.';
const ESTIMATE_NOTE = 'Калорийность оценочная, её можно поправить в кабинете.';
export const NO_PRICES = 'Ни у одной позиции нет цены. Пришлите меню с ценами или добавьте их в кабинете.';

export const NO_DEALS =
  'Нет горящих позиций. Отметьте то, что осталось к вечеру, со скидкой: гости рядом увидят это в подборе.';
export const DEAL_GONE = 'Это предложение уже снято или закончилось.';
export const DEAL_STOPPED = 'Снято с продажи. Уже оформленные брони действуют.';
const ITEM_QUESTION = 'Что выставляем?';
export const NO_ITEMS = 'В меню нет доступных позиций. Сначала загрузите меню.';
export const ALL_ITEMS_ON_DEAL = 'На все доступные позиции уже есть горящие предложения.';
export const ITEM_GONE = 'Эта позиция уже недоступна, выберите другую.';
export const QUANTITY_QUESTION = 'Сколько порций?';
export const QUANTITY_PROMPT = `Напишите, сколько порций продаём: от 1 до ${DEAL_QUANTITY_LIMIT}.`;
export const QUANTITY_INVALID = `Нужно целое число от 1 до ${DEAL_QUANTITY_LIMIT}, например 7.`;
export const DISCOUNT_QUESTION = 'Какая скидка?';
export const UNTIL_QUESTION = 'До скольки продаём?';
export const VENUE_CLOSED_WARNING =
  'Заведение сейчас закрыто по часам работы: гости не смогут забронировать до открытия.';
export const DEAL_CANCELLED = 'Хорошо, ничего не публикую.';

const NO_BOOKINGS = 'Активных броней нет.';
export const CODE_PROMPT = 'Введите код с экрана гостя: 6 символов, например K7M2QX';
export const CODE_INVALID = 'Код состоит из 6 латинских букв и цифр, попробуйте ещё раз';
export const CODE_RETRY = 'Проверьте код и введите его ещё раз.';
export const REDEEM_KEPT = 'Хорошо, бронь не погашена.';
export const STAFF_ONLY = 'Эта ссылка для сотрудников заведения.';

function rub(amount: number): string {
  return `${amount} ₽`;
}

function itemName(name: string): string {
  return escapeMarkdown(truncate(name, TITLE_IN_LIST_LIMIT));
}

function counted(value: number, forms: PluralForms): string {
  return `${value} ${plural(value, forms)}`;
}

export function withNote(note: string, text: string): string {
  return `${note}\n\n${text}`;
}

function guestLink(url: string): string {
  return `[${escapeMarkdown(url)}](${url})`;
}

function openingHours(opensAt: string, closesAt: string): string {
  return opensAt === closesAt ? 'круглосуточно' : `${opensAt}-${closesAt}`;
}

export function hoursLabel(opensAt: string, closesAt: string): string {
  const hours = openingHours(opensAt, closesAt);
  return closesAt < opensAt ? `${hours}, закрытие после полуночи` : hours;
}

interface HomeFacts {
  venue: Venue;
  openNow: boolean;
  activeBookings: number;
  liveDeals: number;
  guestUrl: string;
}

export function homeText({ venue, openNow, activeBookings, liveDeals, guestUrl }: HomeFacts): string {
  const place = [escapeMarkdown(venue.address), openingHours(venue.opensAt, venue.closesAt)];
  if (venue.opensAt !== venue.closesAt) place.push(openNow ? 'сейчас открыто' : 'сейчас закрыто');
  return [
    bold(venue.name),
    place.join(', '),
    ...(venue.isDemo ? [DEMO_VENUE] : []),
    `Активных броней: ${activeBookings}, горящих позиций: ${liveDeals}`,
    `Ссылка для гостей: ${guestLink(guestUrl)}`,
  ].join('\n');
}

export function venueSummary(draft: Required<VenueDraft>): string {
  const { name, address, location, category, opensAt, closesAt } = draft;
  return [
    bold('Проверьте данные'),
    `Название: ${escapeMarkdown(name)}`,
    `Адрес: ${escapeMarkdown(address)}`,
    `Точка: ${location.lat}, ${location.lon}`,
    `Тип: ${VENUE_CATEGORY_LABELS[category]}`,
    `Часы работы: ${hoursLabel(opensAt, closesAt)}`,
  ].join('\n');
}

function menuItemLine(item: MenuItem): string {
  const line = `${itemName(item.name)}, ${rub(item.priceRub)}, ${item.kcal} ккал`;
  return item.isAvailable ? line : `${line} (скрыто)`;
}

function menuLines(items: readonly MenuItem[]): string[] {
  return items.flatMap((item, index) => {
    const heading =
      items[index - 1]?.category === item.category ? [] : ['', `*${MENU_CATEGORY_LABELS[item.category]}*`];
    return [...heading, menuItemLine(item)];
  });
}

export function menuText(items: readonly MenuItem[]): string {
  const render = (shown: number) => {
    const rest = items.length - shown;
    return [
      bold(`Меню: ${counted(items.length, ITEM_FORMS)}`),
      ...menuLines(items.slice(0, shown)),
      ...(rest > 0 ? ['', `и ещё ${rest}, полный список в кабинете`] : []),
    ].join('\n');
  };
  let shown = Math.min(items.length, MENU_LINES_LIMIT);
  let text = render(shown);
  while (text.length > MESSAGE_LIMIT && shown > 1) {
    shown -= 1;
    text = render(shown);
  }
  return text;
}

export function hasPrice(item: ParsedMenuItem): item is ParsedMenuItem & { priceRub: number } {
  return item.priceRub !== null && item.priceRub > 0;
}

function parsedItemLine(item: ParsedMenuItem): string {
  const price = hasPrice(item) ? rub(item.priceRub) : 'цена не распознана';
  return `${itemName(item.name)}, ${price}, около ${item.kcal} ккал`;
}

export function importReadyText(items: readonly ParsedMenuItem[]): string {
  const unpriced = items.filter((item) => !hasPrice(item)).length;
  return [
    `Распознал ${counted(items.length, ITEM_OBJECT_FORMS)}:`,
    ...limitedLines(items.map(parsedItemLine), IMPORT_LINES_LIMIT, ITEM_FORMS),
    '',
    ...(unpriced > 0
      ? [`Без цены: ${unpriced}. Такие позиции не добавлю, цену можно указать в кабинете.`]
      : []),
    ESTIMATE_NOTE,
  ].join('\n');
}

export function importAppliedText(added: number, skipped: readonly string[]): string {
  const result = `${plural(added, ADDED_FORMS)} ${counted(added, ITEM_FORMS)}.`;
  if (skipped.length === 0) return result;
  const names = skipped.slice(0, SKIPPED_NAMES_LIMIT).map(itemName);
  const rest = skipped.length - names.length;
  const list = rest > 0 ? `${names.join(', ')} и ещё ${rest}` : names.join(', ');
  return `${result} Без цены ${plural(skipped.length, SKIPPED_FORMS)} ${skipped.length}: ${list}. Их можно добавить в кабинете.`;
}

function discountPercent(priceRub: number, regularRub: number): number {
  return Math.round((1 - priceRub / regularRub) * 100);
}

function dealPrice(priceRub: number, regularRub: number): string {
  return `${rub(priceRub)} вместо ${rub(regularRub)} (-${discountPercent(priceRub, regularRub)}%)`;
}

function dealLine({ deal, item }: DealView, timeZone: string): string {
  return [
    `${itemName(item.name)}: ${dealPrice(deal.priceRub, item.priceRub)}`,
    `осталось ${deal.quantityLeft} из ${deal.quantityTotal}`,
    `до ${formatLocalTime(deal.endsAt, timeZone)}`,
  ].join(', ');
}

export function dealsText(views: readonly DealView[], timeZone: string): string {
  const lines = views.map((view) => dealLine(view, timeZone));
  return [bold('Горящие предложения'), ...limitedLines(lines, DEAL_LINES_LIMIT, OFFER_FORMS)].join('\n');
}

export function stopQuestion(name: string): string {
  return `Снять «${itemName(name)}» с продажи?`;
}

export function itemQuestion(page: number, pages: number): string {
  return pages > 1 ? `${ITEM_QUESTION} Страница ${page} из ${pages}.` : ITEM_QUESTION;
}

export function menuItemOption(name: string, priceRub: number): string {
  return `${truncate(name, TITLE_IN_LIST_LIMIT)}, ${rub(priceRub)}`;
}

export function dishHeader(name: string, priceRub: number, quantity?: number): string {
  const parts = [bold(truncate(name, TITLE_IN_LIST_LIMIT)), rub(priceRub)];
  if (quantity !== undefined) parts.push(`${quantity} шт.`);
  return parts.join(', ');
}

export function discountOption(percent: number, priceRub: number): string {
  return `-${percent}%, ${rub(priceRub)}`;
}

export function pricePrompt(maxRub: number): string {
  return `Напишите цену со скидкой в рублях: целое число от 1 до ${maxRub}.`;
}

export function priceInvalid(maxRub: number): string {
  return `Нужно целое число от 1 до ${maxRub}: цена со скидкой ниже обычной.`;
}

export function untilClosingOption(closesAt: string): string {
  return `${VENUE_BUTTONS.untilClosing}, ${closesAt}`;
}

export interface DealOffer {
  itemName: string;
  itemPriceRub: number;
  priceRub: number;
  quantity: number;
}

export function dealOfferText(offer: DealOffer): string {
  return `${itemName(offer.itemName)}: ${dealPrice(offer.priceRub, offer.itemPriceRub)}, ${offer.quantity} шт.`;
}

export function dealSummary(offer: DealOffer, endsAt: Date, timeZone: string): string {
  return `${dealOfferText(offer)}, до ${formatLocalTime(endsAt, timeZone)}`;
}

export function dealQuestion(offer: DealOffer, endsAt: Date, timeZone: string): string {
  return `${dealSummary(offer, endsAt, timeZone)}. Опубликовать?`;
}

export function dealPublished(guestUrl: string): string {
  return `Опубликовано. Гости рядом увидят предложение в подборе. Ссылка для гостей: ${guestLink(guestUrl)}`;
}

function bookingLine({ booking, venue }: BookingView): string {
  const until = formatLocalTime(booking.expiresAt, venue.timezone);
  return `${booking.code}: ${itemName(booking.itemName)}, ${rub(booking.priceRub)}, до ${until}`;
}

export function bookingsText(views: readonly BookingView[]): string {
  if (views.length === 0) return NO_BOOKINGS;
  return [
    bold(`Активные брони: ${views.length}`),
    ...limitedLines(views.map(bookingLine), BOOKING_LINES_LIMIT, BOOKING_FORMS),
  ].join('\n');
}

export function redeemQuestion({ booking }: BookingView): string {
  return `Погасить бронь ${booking.code}: ${itemName(booking.itemName)}, ${rub(booking.priceRub)}? Сверьте код с экраном гостя.`;
}

export function redeemingText(code: string, view: BookingView | undefined): string {
  if (!view) return `Бронь ${code}.`;
  return `Бронь ${code}: ${itemName(view.booking.itemName)}, ${rub(view.booking.priceRub)}.`;
}

export function bookingNotListed(code: string): string {
  return `Бронь с кодом ${escapeMarkdown(code)} не найдена среди активных`;
}

export function redeemedText({ booking }: BookingView): string {
  const redeemed = `Погашено: ${itemName(booking.itemName)}, ${rub(booking.priceRub)}.`;
  return booking.userId === null ? redeemed : `${redeemed} Блюдо добавлено гостю в дневник.`;
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function periodTitle(from: string, to: string): string {
  if (from === to) return `Статистика за сегодня, ${localDateLabel(to)}`;
  const range =
    from.slice(0, 7) === to.slice(0, 7)
      ? `${Number(from.slice(8))}-${localDateLabel(to)}`
      : `${localDateLabel(from)} - ${localDateLabel(to)}`;
  return `Статистика за ${counted(DEFAULT_ANALYTICS_DAYS, DAY_FORMS)}, ${range}`;
}

export function statsText(stats: VenueAnalytics): string {
  const top = stats.topItems.map((item) => `${itemName(item.name)} (${item.redeemed})`);
  const bookings = [
    `Броней: ${stats.bookingsCreated}`,
    `погашено ${stats.bookingsRedeemed} (${percent(stats.redeemRate)})`,
    `истекло ${stats.bookingsExpired}`,
    `отменено ${stats.bookingsCancelled}`,
  ];
  return [
    bold(periodTitle(stats.from, stats.to)),
    `Показов в подборе: ${stats.offersShown}, принято: ${stats.offersAccepted} (${percent(stats.acceptRate)})`,
    bookings.join(', '),
    `Выручка по погашенным броням: ${rub(stats.revenueRub)}`,
    `Горящее: продано ${stats.surplusUnitsSold} шт. на ${rub(stats.surplusRevenueRub)}`,
    ...(top.length > 0 ? [`Топ: ${top.join(', ')}`] : []),
  ].join('\n');
}
