import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { BOOKING_HOLD_MINUTES, MAX_ACTIVE_BOOKINGS } from '../../domain/bookings.ts';
import { GUEST_HISTORY_LIMIT, type BookingsService } from '../../services/bookings.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { describeErrors, ERROR_NOTES } from '../error-notes.ts';
import {
  BookingBody,
  BookingListQuery,
  BookingListSchema,
  BookingQrSchema,
  BookingSchema,
  toBooking,
} from '../schemas/bookings.ts';
import { errorResponses, IdParams, success } from '../schemas/common.ts';

const BAD_ID = 'validation_failed (400): id должен быть положительным целым числом.';
const NOT_FOUND = 'booking_not_found (404): брони нет или она принадлежит другому гостю.';

export const bookingsRoutes: FastifyPluginCallbackZod<{ bookings: BookingsService }> = (
  app,
  { bookings },
  done,
) => {
  app.post(
    '/bookings',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'createBooking',
        tags: ['bookings'],
        summary: 'Забронировать блюдо',
        description: [
          'Резервирует порцию в открытом заведении и выдаёт код из 6 символов и QR. Гость показывает код или QR на кассе, заведение гасит бронь, блюдо попадает в дневник гостя.',
          `Бронь действует ${BOOKING_HOLD_MINUTES} минут, но не дольше конца горящего предложения и не дольше закрытия заведения: точное время в expiresAt.`,
          'С dealId одна порция предложения резервируется за гостем по цене предложения и возвращается в продажу при отмене или истечении брони. Без dealId бронь по цене меню.',
          'С offerId предложение из подбора отмечается принятым, даже если гость раньше от него отказался.',
          `У гостя может быть не больше ${MAX_ACTIVE_BOOKINGS} активных броней и одна активная бронь на позицию. Цена и калорийность фиксируются на момент бронирования.`,
          describeErrors(
            ERROR_NOTES.validationFailed,
            ERROR_NOTES.consentRequired,
            ERROR_NOTES.userNotFound,
            'menu_item_not_found (404): позиция убрана из меню или не существует, обновите карточку заведения.',
            'deal_not_found (404): горящего предложения нет или оно на другую позицию.',
            'offer_not_found (404): предложение показано другому гостю или на другую позицию, бронируйте без offerId.',
            'venue_closed (409): заведение сейчас закрыто, покажите часы работы.',
            'deal_not_active (409): горящее предложение снято, закончилось или ещё не началось, предложите бронь по цене меню без dealId.',
            'booking_exists (409): у гостя уже есть активная бронь этой позиции, откройте её из GET /api/v1/bookings.',
            'deal_sold_out (409): порции по предложению закончились, предложите бронь по цене меню без dealId.',
            `too_many_bookings (409): уже ${MAX_ACTIVE_BOOKINGS} активные брони, отмените одну из них или дождитесь, пока заведение её погасит.`,
            'menu_item_unavailable (422): заведение скрыло позицию от гостей.',
          ),
        ].join(' '),
        security: bearerSecurity,
        body: BookingBody,
        response: {
          201: success('Бронь создана', BookingSchema),
          ...errorResponses(400, 401, 403, 404, 409, 413, 415, 422),
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(toBooking(await bookings.create(userId(request), request.body))),
  );

  app.get(
    '/bookings',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'listBookings',
        tags: ['bookings'],
        summary: 'Брони гостя',
        description: [
          'status=active: действующие брони, первой та, что истекает раньше.',
          `status=history: погашенные, отменённые и истёкшие, сначала новые, не больше ${GUEST_HISTORY_LIMIT}.`,
          'Брони, время которых вышло, перед ответом переводятся в expired.',
          describeErrors(ERROR_NOTES.validationFailed),
        ].join(' '),
        security: bearerSecurity,
        querystring: BookingListQuery,
        response: { 200: success('Брони', BookingListSchema), ...errorResponses(400, 401) },
      },
    },
    async (request) => ({
      items: (await bookings.list(userId(request), request.query.status)).map(toBooking),
    }),
  );

  app.get(
    '/bookings/:id',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getBooking',
        tags: ['bookings'],
        summary: 'Бронь',
        description: [
          'Если время брони вышло, она отдаётся со статусом expired.',
          describeErrors(BAD_ID, NOT_FOUND),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        response: { 200: success('Бронь', BookingSchema), ...errorResponses(400, 401, 404) },
      },
    },
    async (request) => toBooking(await bookings.get(userId(request), request.params.id)),
  );

  app.get(
    '/bookings/:id/qr',
    {
      preValidation: requireAuth,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        operationId: 'getBookingQr',
        tags: ['bookings'],
        summary: 'QR-код брони',
        description: [
          'PNG 512 x 512 с QR-кодом qrPayload брони, заведение сканирует его при погашении. Ответ не кэшируется.',
          'Мини-приложение авторизуется заголовком Authorization, поэтому <img src> этот адрес не загрузит.',
          'Загрузите PNG через fetch с заголовком Authorization и покажите через URL.createObjectURL, либо нарисуйте QR на клиенте из поля qrPayload.',
          describeErrors(BAD_ID, NOT_FOUND),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        response: {
          200: { description: 'QR-код брони', content: { 'image/png': { schema: BookingQrSchema } } },
          ...errorResponses(400, 401, 404),
        },
      },
    },
    async (request, reply) => {
      const png = await bookings.qr(userId(request), request.params.id);
      return reply.type('image/png').header('cache-control', 'no-store').send(png);
    },
  );

  app.post(
    '/bookings/:id/cancel',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'cancelBooking',
        tags: ['bookings'],
        summary: 'Отменить бронь',
        description: [
          'Отменяет активную бронь, порция горящего предложения возвращается в продажу.',
          describeErrors(
            BAD_ID,
            NOT_FOUND,
            'booking_not_active (409): бронь уже погашена или отменена, обновите её.',
            'booking_expired (409): время брони вышло, она переведена в expired, порция уже вернулась в продажу.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        response: { 200: success('Бронь отменена', BookingSchema), ...errorResponses(400, 401, 404, 409) },
      },
    },
    async (request) => toBooking(await bookings.cancel(userId(request), request.params.id)),
  );

  done();
};
