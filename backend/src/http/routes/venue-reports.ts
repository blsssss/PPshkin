import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { MAX_ANALYTICS_DAYS } from '../../services/analytics.ts';
import type { ReportsService } from '../../services/reports.ts';
import { bearerSecurity, requireAuth, venueActor } from '../auth.ts';
import { describeErrors, ERROR_NOTES } from '../error-notes.ts';
import { errorResponses, IdParams, success } from '../schemas/common.ts';
import {
  CloseoutBody,
  DayReportQuery,
  DealCloseoutSchema,
  ExportAcceptedSchema,
  ExportBody,
  ReportQuery,
  toDealCloseout,
  toVenueReport,
  VenueReportSchema,
} from '../schemas/reports.ts';
import { VenueQuery } from '../schemas/venues.ts';

interface VenueReportRouteOptions {
  reports: ReportsService;
}

const NO_VENUE =
  'venue_not_found (404): заведения ещё нет или оно не из ваших рабочих мест. venue_required (400): у вас несколько заведений, передайте venueId из GET /api/v1/me/workplaces. venue_forbidden (403): роль не позволяет это действие.';

const PERIOD_ERRORS = [
  ERROR_NOTES.validationFailed,
  `invalid_period (400): from позже to или период длиннее ${MAX_ANALYTICS_DAYS} дней.`,
  NO_VENUE,
];

export const venueReportsRoutes: FastifyPluginCallbackZod<VenueReportRouteOptions> = (
  app,
  { reports },
  done,
) => {
  app.get(
    '/venue/reports/day',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getVenueDayReport',
        tags: ['venue'],
        summary: 'Отчёт заведения за день',
        description: [
          'Отчёт «выставлено / продано / списано» за сутки по часовому поясу заведения, по умолчанию за сегодня. Требует права analytics.view.',
          'Горящая позиция относится ко дню своего начала. notClosed показывает закончившиеся позиции без отметки списания.',
          describeErrors(ERROR_NOTES.validationFailed, NO_VENUE),
        ].join(' '),
        security: bearerSecurity,
        querystring: DayReportQuery.extend(VenueQuery.shape),
        response: { 200: success('Отчёт за день', VenueReportSchema), ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) =>
      toVenueReport(await reports.day(venueActor(request, request.query.venueId), request.query.date)),
  );

  app.get(
    '/venue/reports',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getVenueReport',
        tags: ['venue'],
        summary: 'Отчёт заведения за период',
        description: [
          `Отчёт «выставлено / продано / списано» за период from - to включительно, не длиннее ${MAX_ANALYTICS_DAYS} дней. Требует права analytics.view.`,
          describeErrors(...PERIOD_ERRORS),
        ].join(' '),
        security: bearerSecurity,
        querystring: ReportQuery.extend(VenueQuery.shape),
        response: {
          200: success('Отчёт за период', VenueReportSchema),
          ...errorResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) =>
      toVenueReport(await reports.period(venueActor(request, request.query.venueId), request.query)),
  );

  app.put(
    '/venue/deals/:id/closeout',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'closeOutDeal',
        tags: ['venue'],
        summary: 'Отметить списание по горящей позиции',
        description: [
          'Сохраняет, сколько порций закончившейся горящей позиции списали. Отметку можно менять 48 часов после первой. Требует права deal.edit.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            NO_VENUE,
            'deal_not_found (404): позиции нет в этом заведении.',
            'deal_not_finished (409): позиция ещё идёт, дождитесь окончания.',
            'closeout_locked (409): с первой отметки прошло больше 48 часов.',
            'writeoff_too_large (422): списание больше, чем осталось непроданных и незабронированных порций.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        querystring: VenueQuery,
        body: CloseoutBody,
        response: {
          200: success('Отметка сохранена', DealCloseoutSchema),
          ...errorResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request) =>
      toDealCloseout(
        await reports.closeOut(
          venueActor(request, request.query.venueId),
          request.params.id,
          request.body.writtenOff,
          'miniapp',
        ),
      ),
  );

  app.post(
    '/venue/reports/export',
    {
      preValidation: requireAuth,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        operationId: 'exportVenueReport',
        tags: ['venue'],
        summary: 'Отправить файл отчёта в чат с ботом',
        description: [
          'Собирает CSV или PDF за период и отправляет файлом в чат с ботом. Требует права analytics.view. Скачивания в мини-приложении нет: токен API передаётся только заголовком.',
          describeErrors(
            ...PERIOD_ERRORS,
            'messenger_unavailable (503): бот не запущен, файл отправить нельзя, повторите позже.',
          ),
        ].join(' '),
        security: bearerSecurity,
        querystring: VenueQuery,
        body: ExportBody,
        response: {
          202: success('Файл отправляется', ExportAcceptedSchema),
          ...errorResponses(400, 401, 403, 404, 503),
        },
      },
    },
    async (request, reply) => {
      const { format, from, to } = request.body;
      await reports.exportToChat(venueActor(request, request.query.venueId), { from, to }, format);
      return reply.code(202).send({ status: 'sending' as const });
    },
  );

  done();
};
