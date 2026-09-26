import { describe, expect, it } from 'vitest';
import { problem } from '../../test/http.ts';
import { ApiError, NETWORK_ERROR, TIMEOUT_ERROR, apiErrorFromResponse, parseRetryAfter } from './errors.ts';
import { isRetryable, userMessage } from './messages.ts';

function error(status: number, code: string, retryAfterSeconds: number | null = null) {
  return new ApiError({ status, code, retryAfterSeconds });
}

describe('userMessage', () => {
  it.each([
    [0, NETWORK_ERROR, 'Нет соединения с сервером'],
    [0, TIMEOUT_ERROR, 'Сервер отвечает слишком долго'],
    [400, 'validation_failed', 'Проверьте введённые данные'],
    [401, 'init_data_expired', 'Сессия устарела. Закройте мини-приложение и откройте его снова'],
    [401, 'init_data_malformed', 'Не удалось войти через MAX'],
    [401, 'init_data_bad_signature', 'Не удалось войти через MAX'],
    [401, 'init_data_no_user', 'Не удалось войти через MAX'],
    [404, 'route_not_found', 'Не нашли'],
    [404, 'meal_not_found', 'Не нашли'],
    [400, 'image_required', 'Выберите фото'],
    [400, 'image_empty', 'Выберите фото'],
    [400, 'invalid_multipart', 'Не удалось отправить фото, попробуйте ещё раз'],
    [413, 'image_too_large', 'Фото больше 10 МБ, выберите файл поменьше'],
    [413, 'upload_too_many_parts', 'Отправьте одно фото за раз'],
    [415, 'unsupported_image_type', 'Нужен файл JPEG, PNG или WebP'],
    [415, 'multipart_required', 'Нужен файл JPEG, PNG или WebP'],
    [503, 'auth_unavailable', 'Сервис временно недоступен'],
    [503, 'something_else', 'Сервис временно недоступен'],
    [500, 'internal_error', 'Что-то пошло не так'],
  ])('status %i code %s', (status, code, text) => {
    expect(userMessage(error(status, code))).toBe(text);
  });

  it('counts down from Retry-After on 429', () => {
    expect(userMessage(error(429, 'rate_limited', 12))).toBe('Слишком много запросов, повторите через 12 с');
    expect(userMessage(error(429, 'rate_limited'))).toBe('Слишком много запросов, повторите позже');
  });

  it('falls back to the status for unknown codes', () => {
    expect(userMessage(error(409, 'brand_new_conflict'))).toBe('Данные изменились, обновите экран');
    expect(userMessage(error(403, 'brand_new_forbidden'))).toBe('Это действие недоступно');
    expect(userMessage(error(502, 'bad_gateway'))).toBe('Сервис временно недоступен');
  });

  it('never exposes raw errors', () => {
    expect(userMessage(new Error('SELECT * FROM users'))).toBe('Что-то пошло не так');
    expect(userMessage('boom')).toBe('Что-то пошло не так');
  });

  it('knows which errors are worth retrying', () => {
    expect(isRetryable(error(0, NETWORK_ERROR))).toBe(true);
    expect(isRetryable(error(503, 'auth_unavailable'))).toBe(true);
    expect(isRetryable(error(400, 'validation_failed'))).toBe(false);
  });
});

describe('problem+json parsing', () => {
  it('maps errors[].path to fields and keeps the first message', async () => {
    const parsed = await apiErrorFromResponse(
      problem(400, 'validation_failed', {
        errors: [
          { path: 'body.title', message: 'Required' },
          { path: 'body.title', message: 'Second' },
          { path: 'body.items.3.priceRub', message: 'Too low' },
        ],
      }),
    );
    expect(parsed.fieldErrors).toEqual({ title: 'Required', 'items.3.priceRub': 'Too low' });
  });

  it('survives a non-JSON body', async () => {
    const parsed = await apiErrorFromResponse(new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(parsed).toMatchObject({ status: 502, code: 'http_502', fieldErrors: {} });
  });

  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
    const inTenSeconds = new Date(Date.now() + 10_000).toUTCString();
    expect(parseRetryAfter(inTenSeconds)).toBeGreaterThanOrEqual(9);
  });
});
