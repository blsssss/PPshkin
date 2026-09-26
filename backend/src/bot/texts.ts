import { MAX_ACTIVE_BOOKINGS } from '../domain/bookings.ts';
import { CONSENT_DOCUMENTS } from '../domain/consents.ts';
import type { Macros } from '../domain/models.ts';
import type { Goal } from '../domain/vocabulary.ts';
import { escapeMarkdown } from '../integrations/max/messenger.ts';
import { clip } from '../recognition/normalize.ts';
import { plural } from '../shared/plural.ts';

export const MESSAGE_LIMIT = 4000;
export const TITLE_IN_BUTTON_LIMIT = 40;
export const TITLE_IN_LIST_LIMIT = 60;

export type PluralForms = readonly [one: string, few: string, many: string];

export const RECORD_FORMS: PluralForms = ['запись', 'записи', 'записей'];
const DISH_FORMS: PluralForms = ['блюдо', 'блюда', 'блюд'];
export const OFFER_FORMS: PluralForms = ['предложение', 'предложения', 'предложений'];
const ACTIVE_BOOKING_FORMS: PluralForms = ['активная бронь', 'активные брони', 'активных броней'];

export const GOAL_LABELS: Record<Goal, string> = {
  lose: 'снизить вес',
  maintain: 'поддерживать вес',
  gain: 'набрать вес',
};

export const BUTTONS = {
  agree: 'Согласен',
  more: 'Подробнее',
  offersYes: 'Да, присылать',
  offersNo: 'Нет, спасибо',
  offersAgree: 'Согласен получать',
  cancel: 'Отмена',
  skip: 'Пропустить',
  customKcal: 'Своё число',
  calculate: 'Рассчитать',
  sendLocation: 'Отправить местоположение',
  updateLocation: 'Обновить местоположение',
  help: 'Помощь',
  eat: 'Что поесть?',
  bookings: 'Мои брони',
  today: 'Сегодня',
  profile: 'Профиль',
  correct: 'Верно',
  allCorrect: 'Всё верно',
  fix: 'Исправить',
  remove: 'Удалить',
  manual: 'Ввести вручную',
  yes: 'Да',
  no: 'Нет',
  removeLast: 'Удалить последнюю запись',
  openDiary: 'Открыть дневник',
  target: 'Ориентир',
  goal: 'Цель',
  offersOn: 'Предложения: включить',
  offersOff: 'Предложения: выключить',
  resetDisliked: 'Сбросить список «Не предлагать»',
  deleteAccount: 'Удалить аккаунт',
  confirmDelete: 'Да, удалить',
  route: 'Маршрут',
  venueInApp: 'Меню и все предложения',
  openInApp: 'Открыть в мини-приложении',
} as const;

export const NOTICES = {
  opening: 'Открываю',
  staleButton: 'Кнопка устарела',
  pressedButton: 'Эта кнопка уже нажата',
  consentFirst: 'Сначала нужно согласие на обработку данных',
  consentAlready: 'Согласие уже получено',
  fixWaiting: 'Жду исправление',
  mealDeleted: 'Запись удалена',
  tryAgain: 'Не получилось, попробуйте ещё раз',
} as const;

export const SOMETHING_WENT_WRONG = 'Что-то пошло не так. Попробуйте ещё раз или отправьте /help';

const POSITION_GONE = 'Позиция больше недоступна. Посмотрим другое: /eat';
const RECORD_GONE = 'Не нашёл: запись уже удалена или устарела.';
const BOOKING_INACTIVE = 'Бронь уже не активна.';

const ERROR_TEXTS: Readonly<Record<string, string>> = {
  too_many_bookings: `У вас уже ${MAX_ACTIVE_BOOKINGS} ${plural(MAX_ACTIVE_BOOKINGS, ACTIVE_BOOKING_FORMS)}. Лишнюю можно отменить в /bookings.`,
  booking_exists: 'Это предложение уже забронировано вами, код в /bookings.',
  deal_sold_out: 'Эту позицию уже разобрали. Посмотрим другое: /eat',
  deal_not_active: 'Предложение уже закончилось. Посмотрим другое: /eat',
  venue_closed: 'Заведение сейчас закрыто, бронь не получится. Посмотрим другое: /eat',
  menu_item_unavailable: POSITION_GONE,
  menu_item_not_found: POSITION_GONE,
  deal_not_found: POSITION_GONE,
  venue_not_found: POSITION_GONE,
  booking_not_found: RECORD_GONE,
  offer_not_found: RECORD_GONE,
  booking_not_active: BOOKING_INACTIVE,
  booking_expired: BOOKING_INACTIVE,
  offer_already_accepted: 'По этому предложению уже есть бронь, код в /bookings.',
  meal_not_found: RECORD_GONE,
  demo_account_protected: 'Демо-аккаунт удалить нельзя.',
  demo_diary_exists: 'Пример уже добавлен',
  demo_mode_disabled: 'Демо-режим на сервере выключен.',
  validation_failed: 'Проверьте ввод и попробуйте ещё раз.',
  eaten_at_out_of_range: 'Проверьте ввод и попробуйте ещё раз.',
};

export function errorText(code: string): string | null {
  return Object.hasOwn(ERROR_TEXTS, code) ? (ERROR_TEXTS[code] ?? null) : null;
}

export const GREETING =
  'Привет! Я ППшкин. Записываю еду по фото, примерно считаю калории и подсказываю блюдо в кафе рядом, которое впишется в ваш день.';

export const CONSENT_REQUEST = [
  'Чтобы вести дневник, нужно ваше согласие на обработку персональных данных.',
  'Храню идентификатор и имя в MAX, записи о еде и оценки калорий, настройки и примерное местоположение (около 1 км), если вы им поделитесь.',
  'Фото еды отправляю в сервис распознавания без ваших данных и не храню.',
  'Отозвать согласие и удалить данные: /delete.',
].join(' ');

export const CONSENT_ACCEPTED = `${CONSENT_REQUEST}\n\nСогласие получено, спасибо!`;

export function bold(text: string): string {
  return `**${escapeMarkdown(text)}**`;
}

function documentText(kind: keyof typeof CONSENT_DOCUMENTS): string {
  const { title, text } = CONSENT_DOCUMENTS[kind];
  return `${bold(title)}\n\n${escapeMarkdown(text)}`;
}

export function splitText(text: string, limit = MESSAGE_LIMIT): string[] {
  const parts: string[] = [];
  let current = '';
  for (const paragraph of text.split('\n\n')) {
    const next = current === '' ? paragraph : `${current}\n\n${paragraph}`;
    if (next.length <= limit) {
      current = next;
      continue;
    }
    if (current !== '') parts.push(current);
    let rest = paragraph;
    while (rest.length > limit) {
      parts.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    current = rest;
  }
  if (current !== '') parts.push(current);
  return parts;
}

export const personalDataDocument = (): string[] => splitText(documentText('personal_data'));

const OFFERS_DOCUMENT = documentText('personalized_offers');

export const OFFERS_QUESTION = `${OFFERS_DOCUMENT}\n\nПрисылать? Это необязательно, дневник работает и без этого.`;
export const OFFERS_ACCEPTED = `${OFFERS_DOCUMENT}\n\nСогласие получено. Отключить можно в /profile.`;
export const OFFERS_DECLINED = 'Хорошо, без персональных предложений. Включить можно в /profile.';
export const OFFERS_OFF = 'Готово, сам больше ничего не пришлю. Подбор по запросу работает: /eat';

export const GOAL_QUESTION = 'Какая у вас цель?';
export const GOAL_SKIPPED = 'Хорошо, цель можно указать позже в /profile.';

export function goalChosen(goal: Goal): string {
  return `Цель: ${GOAL_LABELS[goal]}.`;
}

const KCAL_QUESTION =
  'Сколько ккал в день взять за ориентир? Это ориентир для подсказок, а не медицинская норма.';

export function kcalQuestion(fromOnboarding: boolean): string {
  return fromOnboarding ? `${KCAL_QUESTION} Изменить можно в /profile.` : KCAL_QUESTION;
}

export function kcalChosen(kcal: number): string {
  return `Ориентир: ${kcal} ккал в день.`;
}

export const KCAL_PROMPT = 'Напишите число от 1000 до 5000, например 1900.';
export const KCAL_INVALID = 'Нужно целое число от 1000 до 5000, например 1900.';

export const LOCATION_QUESTION =
  'Поделитесь местоположением, чтобы я искал места рядом. Храню его с точностью около 1 км. Без него ищу по всему городу.';
export const LOCATION_SKIPPED = 'Хорошо, без местоположения. Отправить его можно позже в /profile.';
export const LOCATION_SAVED = 'Местоположение сохранено, храню его с точностью около 1 км.';
export const LOCATION_UPDATED = 'Местоположение обновлено, храню его с точностью около 1 км.';

export const ONBOARDING_DONE =
  'Готово! Пришлите фото блюда или напишите, что съели, например: Сырники 350 или съел борщ. Спросить, что поесть: /eat.';
export const WELCOME_BACK = 'С возвращением! Пришлите фото блюда или напишите, что съели.';

export const DISCLAIMER = '*Калорийность приблизительная, это не медицинская рекомендация.*';

export const HELP = [
  bold('Что я умею'),
  'Записываю еду: пришлите фото блюда или напишите, что съели. Например: Сырники 350, Латте 180 ккал или съел борщ.',
  'Подбираю блюдо рядом, которое впишется в ваш день: /eat',
  'Показываю, сколько съедено за день: /today',
  'Брони с кодом и QR: /bookings',
  'Ориентир калорий, цель и настройки: /profile',
  'Удаляю аккаунт и все данные: /delete',
  '',
  DISCLAIMER,
].join('\n');

export const SHORT_HELP = 'Я понимаю фото еды и текст, например: Сырники 350. Все возможности: /help';

export const LOOKING_AT_PHOTO = 'Смотрю на фото, это до 15 секунд...';
export const FIRST_PHOTO_ONLY = 'Беру первое фото, остальные пришлите по одному.';
export const COUNTING = 'Считаю калории, это до 15 секунд...';
export const PHOTO_TOO_LARGE = 'Фото слишком большое. Пришлите фото до 15 МБ.';
export const PHOTO_DOWNLOAD_FAILED = 'Не получилось загрузить фото. Пришлите его ещё раз.';
export const RATE_LIMITED =
  'Слишком много запросов подряд. Попробуйте через час или запишите вручную, например: Сырники 350';
export const UNCERTAIN =
  'Не уверен, что это. Выберите вариант или напишите название и калории, например: Плов 450';
export const NOT_FOOD_PHOTO =
  'Похоже, на фото не еда. Пришлите фото блюда или напишите, что съели, например: Сырники 350';
export const NOT_FOOD_TEXT = 'Похоже, это не еда. Напишите, что съели, например: Сырники 350';
export const PHOTO_RECOGNITION_OFF =
  'Распознавание фото сейчас выключено. Напишите, что съели, например: Сырники 350';
export const TEXT_RECOGNITION_OFF =
  'Распознавание сейчас выключено. Напишите название и калории, например: Сырники 350';
export const UNSUPPORTED_IMAGE = 'Не получилось открыть фото. Пришлите обычное фото в JPEG или PNG.';
export const RECOGNITION_FAILED =
  'Сервис распознавания не ответил. Попробуйте через минуту или напишите вручную, например: Сырники 350';
export const MANUAL_PROMPT = 'Напишите название и калории, например: Сырники 350';
export const MANUAL_INVALID = 'Не понял. Напишите название и калории числом, например: Сырники 350';
export const FIX_PROMPT =
  'Напишите название и калории, например: Борщ 300. Если название верное, достаточно числа: 300';
export const FIX_INVALID =
  'Не понял. Напишите название и калории, например: Борщ 300, или только калории: 300';
export const MEAL_DELETED = 'Запись удалена.';
export const MEAL_RECORDED = 'Записано.';
export const INPUT_CANCELLED = 'Хорошо, отменил. Пришлите фото блюда или напишите, что съели.';

export const FIXED_HEADER = 'Исправил:';

export function loggedHeader(count: number): string {
  return count === 1 ? 'Записал:' : `Записал ${dishCount(count)}:`;
}

export function dayProgress(eaten: number, target: number, remaining: number): string {
  const progress = `Сегодня около ${eaten} из ${target} ккал`;
  return remaining > 0
    ? `${progress}, осталось около ${remaining} ккал`
    : `${progress}, ориентир на день набран`;
}

export function todayTitle(date: string): string {
  return bold(`Сегодня, ${date}`);
}

export function todayTotal(eaten: number, target: number, remaining: number): string {
  const total = `Итого около ${eaten} ккал из ${target}`;
  return remaining > 0 ? `${total}, осталось около ${remaining}` : `${total}, ориентир на день набран`;
}

export function todayEmpty(target: number): string {
  return `Пока ничего не записано. Пришлите фото блюда или напишите, что съели, например: Сырники 350\nОриентир на день: ${target} ккал`;
}

export function countingFor(text: string): string {
  return `Считаю калории: «${escapeMarkdown(text)}». Это до 15 секунд...`;
}

export function confirmText(text: string): string {
  return `Записать «${escapeMarkdown(text)}» в дневник?`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function truncate(text: string, limit: number): string {
  const trimmed = text.trim();
  return Array.from(trimmed).length <= limit ? trimmed : `${clip(trimmed, limit - 1)}…`;
}

export function kcalRange(kcalMin: number, kcalMax: number): string {
  return kcalMin === kcalMax ? `около ${kcalMin} ккал` : `${kcalMin}-${kcalMax} ккал`;
}

export function rub(amount: number): string {
  return `${amount} ₽`;
}

const kilometers = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function distance(meters: number): string {
  const rounded = Math.max(50, Math.round(meters / 50) * 50);
  return rounded < 1000 ? `${rounded} м` : `${kilometers.format(meters / 1000)} км`;
}

const DATE_STYLES = {
  calendar: { day: 'numeric', month: 'long' },
  short: { day: '2-digit', month: '2-digit' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function formatDate(instant: Date, timeZone: string, style: keyof typeof DATE_STYLES): string {
  const key = `${style} ${timeZone}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('ru-RU', { ...DATE_STYLES[style], timeZone });
    dateFormatters.set(key, formatter);
  }
  return formatter.format(instant);
}

export function calendarDate(instant: Date, timeZone: string): string {
  return formatDate(instant, timeZone, 'calendar');
}

export function shortDate(instant: Date, timeZone: string): string {
  return formatDate(instant, timeZone, 'short');
}

export function localDateLabel(date: string): string {
  return calendarDate(new Date(`${date}T12:00:00Z`), 'UTC');
}

function clockTime(value: string): string {
  return value.slice(0, 5);
}

const MACRO_LABELS = [
  ['Б', 'proteinG'],
  ['Ж', 'fatG'],
  ['У', 'carbsG'],
] as const;

export function macros(values: Macros): string | null {
  const parts = MACRO_LABELS.flatMap(([label, field]) => {
    const grams = values[field];
    return grams === null ? [] : [`${label} ${Math.round(grams)} г`];
  });
  return parts.length > 0 ? parts.join(', ') : null;
}

export function limitedLines(lines: readonly string[], limit: number, forms: PluralForms): string[] {
  if (lines.length <= limit) return [...lines];
  const rest = lines.length - limit;
  return [...lines.slice(0, limit), `и ещё ${rest} ${plural(rest, forms)}`];
}

function dishCount(count: number): string {
  return `${count} ${plural(count, DISH_FORMS)}`;
}

export interface ProfileFacts {
  kcalTarget: number;
  goal: Goal | null;
  offersEnabled: boolean;
  locationUpdated: string | null;
  disliked: readonly string[];
}

export function profileText(facts: ProfileFacts): string {
  return [
    bold('Профиль'),
    `Ориентир: ${facts.kcalTarget} ккал в день`,
    `Цель: ${facts.goal ? GOAL_LABELS[facts.goal] : 'не указана'}`,
    `Персональные предложения: ${facts.offersEnabled ? 'включены' : 'выключены'}`,
    `Местоположение: ${facts.locationUpdated ? `обновлено ${facts.locationUpdated}` : 'не указано'}`,
    ...(facts.disliked.length > 0 ? [`Не предлагать: ${facts.disliked.join(', ')}`] : []),
  ].join('\n');
}

export const DELETE_QUESTION =
  'Удалить аккаунт и все данные: дневник, настройки, согласия? Активные брони отменятся. Это необратимо.';
export const ACCOUNT_DELETED = 'Данные удалены. Чтобы начать заново, отправьте /start.';
export const ACCOUNT_KEPT = 'Хорошо, ничего не удаляю.';

export const OFFER_ENDED = 'Это предложение уже закончилось.';
export const NO_DEALS = 'Сейчас горящих предложений нет.';
export const DEMO_VENUE = '*Заведение и меню тестовые*';
export const SAMPLE_MEAL = '(пример)';
export const DEALS_TITLE = bold('Горящие предложения');

export function venueSummary(category: string, address: string): string {
  return `${category}, ${escapeMarkdown(address)}`;
}

export function openingStatus(openNow: boolean, opensAt: string, closesAt: string): string {
  if (clockTime(opensAt) === clockTime(closesAt)) return 'Открыто круглосуточно';
  return openNow
    ? `Сейчас открыто до ${clockTime(closesAt)}`
    : `Сейчас закрыто, откроется в ${clockTime(opensAt)}`;
}

export function dealPrice(priceRub: number, regularRub: number, kcal: number): string {
  return `${rub(priceRub)} вместо ${rub(regularRub)}, около ${kcal} ккал`;
}

export function dealAvailability(until: string, left: number): string {
  return `до ${until}, осталось ${left} шт.`;
}

export function venuePlace(name: string, address: string, distanceM: number | null): string {
  const place = `${escapeMarkdown(name)}, ${escapeMarkdown(address)}`;
  return distanceM === null ? place : `${place}, ${distance(distanceM)} от вас`;
}
