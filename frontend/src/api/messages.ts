import { ApiError, NETWORK_ERROR, TIMEOUT_ERROR } from './errors.ts';

const NOT_FOUND_TEXT = 'Не нашли';

const MESSAGES: Record<string, string> = {
  [NETWORK_ERROR]: 'Нет соединения с сервером',
  [TIMEOUT_ERROR]: 'Сервер отвечает слишком долго',
  validation_failed: 'Проверьте введённые данные',
  invalid_token: 'Не удалось войти через MAX',
  unauthorized: 'Не удалось войти через MAX',
  init_data_expired: 'Сессия устарела. Закройте мини-приложение и откройте его снова',
  init_data_malformed: 'Не удалось войти через MAX',
  init_data_bad_signature: 'Не удалось войти через MAX',
  init_data_no_user: 'Не удалось войти через MAX',
  route_not_found: NOT_FOUND_TEXT,
  image_required: 'Выберите фото',
  image_empty: 'Выберите фото',
  invalid_multipart: 'Не удалось отправить фото, попробуйте ещё раз',
  image_too_large: 'Фото больше 10 МБ, выберите файл поменьше',
  upload_too_many_parts: 'Отправьте одно фото за раз',
  unsupported_image_type: 'Нужен файл JPEG, PNG или WebP',
  multipart_required: 'Нужен файл JPEG, PNG или WebP',
  auth_unavailable: 'Сервис временно недоступен',
  internal_error: 'Что-то пошло не так',
  consent_required: 'Сначала дайте согласие на обработку данных',
  user_not_found: 'Аккаунт удалён, войдите заново',
  demo_account_protected: 'Демо-аккаунт удалить нельзя, он общий для всех проверяющих',
  consent_version_outdated: 'Текст согласия обновился, прочитайте и подтвердите его снова',
  delete_account_instead: 'Чтобы отозвать согласие на обработку данных, удалите аккаунт',
  invalid_timezone: 'Этот часовой пояс не поддерживается, выберите из списка',
  eaten_at_out_of_range: 'Время приёма пищи должно быть в пределах последних 7 дней',
  meal_not_found: 'Запись не найдена, возможно, её уже удалили',
  offer_not_found: 'Предложение больше недоступно, обновите подборку',
  offer_already_accepted: 'По этому предложению уже есть бронь',
  venue_not_found: 'Заведение не найдено',
  venue_exists: 'У вас уже есть заведение',
  demo_mode_disabled: 'Демо-режим на сервере выключен',
  demo_account: 'Под демо-учёткой это действие недоступно, откройте мини-приложение в MAX',
  menu_item_not_found: 'Позиция не найдена, возможно, её уже удалили',
  menu_item_unavailable: 'Позиция сейчас не продаётся',
  import_not_found: 'Импорт не найден',
  import_in_progress: 'Предыдущее меню ещё распознаётся',
  import_limit_reached: 'Сегодня загружено 20 меню, это дневной лимит',
  import_already_applied: 'Эти позиции уже добавлены в меню',
  import_not_ready: 'Меню ещё распознаётся, подождите',
  deal_not_found: 'Предложение не найдено, обновите список',
  deal_exists: 'По этой позиции уже есть горящее предложение',
  deal_finished: 'Предложение уже завершено или снято, изменить его нельзя',
  deal_price_not_lower: 'Цена со скидкой должна быть ниже обычной цены',
  deal_window_invalid: 'Время окончания должно быть в ближайшие 24 часа',
  deal_quantity_invalid: 'Остаток не может быть больше исходного количества',
  deal_not_active: 'Предложение уже закончилось',
  deal_sold_out: 'Все порции уже разобрали',
  venue_closed: 'Заведение сейчас закрыто',
  too_many_bookings: 'У вас уже 3 активные брони. Используйте или отмените одну из них',
  booking_exists: 'Вы уже забронировали это предложение',
  booking_not_found: 'Бронь не найдена',
  booking_expired: 'Срок брони истёк',
  booking_not_active: 'Бронь уже погашена или отменена',
  invalid_period: 'Неверный период',
};

const STATUS_MESSAGES: Record<number, string> = {
  400: 'Проверьте введённые данные',
  401: 'Не удалось войти через MAX',
  403: 'Это действие недоступно',
  404: NOT_FOUND_TEXT,
  409: 'Данные изменились, обновите экран',
  413: 'Файл слишком большой',
  415: 'Нужен файл JPEG, PNG или WebP',
  422: 'Проверьте введённые данные',
  429: 'Слишком много запросов, повторите позже',
};

function rateLimitMessage(error: ApiError): string {
  return error.retryAfterSeconds !== null && error.retryAfterSeconds > 0
    ? `Слишком много запросов, повторите через ${error.retryAfterSeconds} с`
    : 'Слишком много запросов, повторите позже';
}

export function userMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return MESSAGES.internal_error ?? 'Что-то пошло не так';
  if (error.code === 'rate_limited' || error.status === 429) return rateLimitMessage(error);
  const byCode = MESSAGES[error.code];
  if (byCode !== undefined) return byCode;
  if (error.status === 404 && error.code.endsWith('_not_found')) return NOT_FOUND_TEXT;
  const byStatus = STATUS_MESSAGES[error.status];
  if (byStatus !== undefined) return byStatus;
  if (error.status >= 500) return error.status === 500 ? 'Что-то пошло не так' : 'Сервис временно недоступен';
  return 'Что-то пошло не так';
}

export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status === 429 || error.status >= 500;
}
