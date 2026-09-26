import { ApiError, NETWORK_ERROR, TIMEOUT_ERROR } from './errors.ts';

export const NOT_FOUND_TEXT = 'Не нашли';

export const MESSAGES: Record<string, string> = {
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
