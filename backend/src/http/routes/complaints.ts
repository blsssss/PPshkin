import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { COMPLAINTS_PER_DAY } from '../../domain/moderation.ts';
import type { ModerationService } from '../../services/moderation.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { describeErrors, ERROR_NOTES } from '../error-notes.ts';
import { errorResponses, success } from '../schemas/common.ts';
import { ComplaintBody, ComplaintListSchema, ComplaintSchema, toComplaint } from '../schemas/moderation.ts';

export const complaintsRoutes: FastifyPluginCallbackZod<{ moderation: ModerationService }> = (
  app,
  { moderation },
  done,
) => {
  app.post(
    '/complaints',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'createComplaint',
        tags: ['complaints'],
        summary: 'Пожаловаться на заведение или бронь',
        description: [
          'Жалоба уходит администраторам. Заведение не видит, кто пожаловался: после решения администратора сотрудники получают только причину, код брони и время.',
          `Не больше ${String(COMPLAINTS_PER_DAY)} жалоб в сутки на гостя, одна жалоба на бронь.`,
          describeErrors(
            ERROR_NOTES.validationFailed,
            'venue_not_found (404): заведения нет или оно скрыто от гостя.',
            'booking_not_found (404): брони нет, она чужая или относится к другому заведению.',
            'complaint_exists (409): на эту бронь жалоба уже подана.',
            `complaint_limit (409): уже ${String(COMPLAINTS_PER_DAY)} жалоб за последние сутки, повторите позже.`,
          ),
        ].join(' '),
        security: bearerSecurity,
        body: ComplaintBody,
        response: {
          201: success('Жалоба принята', ComplaintSchema),
          ...errorResponses(400, 401, 404, 409),
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(toComplaint(await moderation.createComplaint(userId(request), request.body))),
  );

  app.get(
    '/complaints',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'listMyComplaints',
        tags: ['complaints'],
        summary: 'Мои жалобы',
        description: 'Жалобы гостя и их статус, сначала новые.',
        security: bearerSecurity,
        response: { 200: success('Жалобы гостя', ComplaintListSchema), ...errorResponses(401) },
      },
    },
    async (request) => ({
      items: (await moderation.listComplaints(userId(request))).map(toComplaint),
    }),
  );

  done();
};
