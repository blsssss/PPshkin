import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  DEFAULT_ANALYTICS_DAYS,
  MAX_ANALYTICS_DAYS,
  type AnalyticsService,
} from '../../services/analytics.ts';
import { VENUE_HISTORY_DAYS, VENUE_HISTORY_LIMIT, type BookingsService } from '../../services/bookings.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { describeErrors, ERROR_NOTES } from '../error-notes.ts';
import { AnalyticsQuery, toVenueAnalytics, VenueAnalyticsSchema } from '../schemas/analytics.ts';
import {
  BookingListSchema,
  BookingSchema,
  RedeemBody,
  toBooking,
  VenueBookingListQuery,
} from '../schemas/bookings.ts';
import { errorResponses, success } from '../schemas/common.ts';

interface VenueBookingRouteOptions {
  bookings: BookingsService;
  analytics: AnalyticsService;
}

const NO_VENUE = 'venue_not_found (404): заведения ещё нет, предложите создать его через POST /api/v1/venue.';

export const venueBookingsRoutes: FastifyPluginCallbackZod<VenueBookingRouteOptions> = (
  app,
  { bookings, analytics },
  done,
) => {
  app.get(
    '/venue/bookings',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'listVenueBookings',
        tags: ['venue'],
        summary: 'Брони заведения',
        description: [
          'status=active: действующие брони, первой та, что истекает раньше.',
          `status=history: погашенные, отменённые и истёкшие за последние ${VENUE_HISTORY_DAYS} дней, сначала последние, не больше ${VENUE_HISTORY_LIMIT}.`,
          'С date в обоих случаях только брони, созданные в эти сутки по часовому поясу заведения.',
          'Брони, время которых вышло, перед ответом переводятся в expired. Данных гостя в бронях нет, для выдачи достаточно кода.',
          describeErrors(
            'validation_failed (400): status active или history, date в формате YYYY-MM-DD.',
            NO_VENUE,
          ),
        ].join(' '),
        security: bearerSecurity,
        querystring: VenueBookingListQuery,
        response: { 200: success('Брони', BookingListSchema), ...errorResponses(400, 401, 404) },
      },
    },
    async (request) => ({
      items: (await bookings.listForVenue(userId(request), request.query)).map(toBooking),
    }),
  );

  app.post(
    '/venue/bookings/redeem',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'redeemBooking',
        tags: ['venue'],
        summary: 'Погасить бронь',
        description: [
          'Гасит бронь по коду, который назвал гость, или по QR-коду: отсканируйте его через WebApp.openCodeReader и отправьте value как есть.',
          'Погашение не зависит от часов работы и от того, снято ли горящее предложение: порция уже зарезервирована за гостем.',
          'Погашенное блюдо записывается в дневник гостя.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            NO_VENUE,
            'booking_not_found (404): брони с таким кодом в заведении нет, проверьте код.',
            'booking_expired (409): время брони вышло, порция вернулась в продажу, гостю нужно забронировать заново.',
            'booking_not_active (409): бронь уже погашена или отменена гостем.',
          ),
        ].join(' '),
        security: bearerSecurity,
        body: RedeemBody,
        response: {
          200: success('Бронь погашена', BookingSchema),
          ...errorResponses(400, 401, 404, 409, 413, 415),
        },
      },
    },
    async (request) => toBooking(await bookings.redeem(userId(request), request.body.code)),
  );

  app.get(
    '/venue/analytics',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getVenueAnalytics',
        tags: ['venue'],
        summary: 'Аналитика заведения',
        description: [
          `Итоги за период from - to включительно по часовому поясу заведения, по умолчанию последние ${DEFAULT_ANALYTICS_DAYS} дней включая сегодня.`,
          'Сколько предложений заведения показано гостям и принято, сколько броней создано, погашено, истекло и отменено, выручка и проданные горящие порции, лучшие позиции и показатели по дням.',
          'Брони, время которых вышло, перед подсчётом переводятся в expired.',
          describeErrors(
            'validation_failed (400): передайте from и to в формате YYYY-MM-DD.',
            `invalid_period (400): from позже to или период длиннее ${MAX_ANALYTICS_DAYS} дней.`,
            NO_VENUE,
          ),
        ].join(' '),
        security: bearerSecurity,
        querystring: AnalyticsQuery,
        response: { 200: success('Аналитика', VenueAnalyticsSchema), ...errorResponses(400, 401, 404) },
      },
    },
    async (request) => toVenueAnalytics(await analytics.get(userId(request), request.query)),
  );

  done();
};
