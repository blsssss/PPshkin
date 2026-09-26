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

  it.each([
    ['user_not_found', 'Аккаунт удалён, войдите заново'],
    ['demo_account_protected', 'Демо-аккаунт удалить нельзя, он общий для всех проверяющих'],
    ['consent_version_outdated', 'Текст согласия обновился, прочитайте и подтвердите его снова'],
    ['delete_account_instead', 'Чтобы отозвать согласие на обработку данных, удалите аккаунт'],
    ['invalid_timezone', 'Этот часовой пояс не поддерживается, выберите из списка'],
    ['eaten_at_out_of_range', 'Время приёма пищи должно быть в пределах последних 7 дней'],
    ['meal_not_found', 'Запись не найдена, возможно, её уже удалили'],
    ['offer_not_found', 'Предложение больше недоступно, обновите подборку'],
    ['offer_already_accepted', 'По этому предложению уже есть бронь'],
    ['venue_not_found', 'Заведение не найдено'],
    ['venue_exists', 'У вас уже есть заведение'],
    ['demo_mode_disabled', 'Демо-режим на сервере выключен'],
    ['demo_account', 'Под демо-учёткой это действие недоступно, откройте мини-приложение в MAX'],
    ['menu_item_not_found', 'Позиция не найдена, возможно, её уже удалили'],
    ['menu_item_unavailable', 'Позиция сейчас не продаётся'],
    ['import_not_found', 'Импорт не найден'],
    ['import_in_progress', 'Предыдущее меню ещё распознаётся'],
    ['import_limit_reached', 'Сегодня загружено 20 меню, это дневной лимит'],
    ['import_already_applied', 'Эти позиции уже добавлены в меню'],
    ['import_not_ready', 'Меню ещё распознаётся, подождите'],
    ['deal_not_found', 'Предложение не найдено, обновите список'],
    ['deal_exists', 'По этой позиции уже есть горящее предложение'],
    ['deal_finished', 'Предложение уже завершено или снято, изменить его нельзя'],
    ['deal_price_not_lower', 'Цена со скидкой должна быть ниже обычной цены'],
    ['deal_window_invalid', 'Время окончания должно быть в ближайшие 24 часа'],
    ['deal_quantity_invalid', 'Остаток не может быть больше исходного количества'],
    ['deal_not_active', 'Предложение уже закончилось'],
    ['deal_sold_out', 'Все порции уже разобрали'],
    ['venue_closed', 'Заведение сейчас закрыто'],
    ['too_many_bookings', 'У вас уже 3 активные брони. Используйте или отмените одну из них'],
    ['booking_exists', 'Вы уже забронировали это предложение'],
    ['booking_not_found', 'Бронь не найдена'],
    ['booking_expired', 'Срок брони истёк'],
    ['booking_not_active', 'Бронь уже погашена или отменена'],
    ['invalid_period', 'Неверный период'],
  ])('has the base text for %s', (code, text) => {
    expect(userMessage(error(400, code))).toBe(text);
  });

  it.each([
    [400, 'Проверьте введённые данные'],
    [401, 'Не удалось войти через MAX'],
    [403, 'Это действие недоступно'],
    [404, 'Не нашли'],
    [409, 'Данные изменились, обновите экран'],
    [413, 'Файл слишком большой'],
    [415, 'Нужен файл JPEG, PNG или WebP'],
    [422, 'Проверьте введённые данные'],
    [500, 'Что-то пошло не так'],
    [502, 'Сервис временно недоступен'],
  ])('falls back to the status %i text for an unknown code', (status, text) => {
    expect(userMessage(error(status, 'brand_new_code'))).toBe(text);
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
