import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ModerationService } from '../../services/moderation.ts';
import { notFound } from '../../shared/errors.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { describeErrors, ERROR_NOTES } from '../error-notes.ts';
import { errorResponses, IdParams, success } from '../schemas/common.ts';
import { CompanySchema, CreatedInviteSchema, toCompany, toCreatedInvite } from '../schemas/companies.ts';
import {
  AdminComplaintListSchema,
  AdminComplaintQuery,
  AdminComplaintSchema,
  BlockBody,
  BlockStateSchema,
  CompanyDecisionBody,
  CompanyReviewListSchema,
  CompanyReviewQuery,
  ResolutionBody,
  toAdminComplaint,
} from '../schemas/moderation.ts';

const NOT_ADMIN = 'not_found (404): вы не администратор, метод скрыт.';

export const adminRoutes: FastifyPluginCallbackZod<{ moderation: ModerationService }> = (
  app,
  { moderation },
  done,
) => {
  async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await requireAuth(request, reply);
    if (!moderation.isAdmin(userId(request))) throw notFound('not_found', 'Not found');
  }

  app.get(
    '/admin/companies',
    {
      preValidation: requireAdmin,
      schema: {
        operationId: 'listCompaniesForReview',
        tags: ['admin'],
        summary: 'Компании на проверке',
        description: [
          'Не больше 50 компаний. По умолчанию только ожидающие решения (pending).',
          describeErrors(ERROR_NOTES.validationFailed, NOT_ADMIN),
        ].join(' '),
        security: bearerSecurity,
        querystring: CompanyReviewQuery,
        response: { 200: success('Компании', CompanyReviewListSchema), ...errorResponses(400, 401, 404) },
      },
    },
    async (request) => ({
      items: (await moderation.listCompaniesForReview(userId(request), request.query.verification)).map(
        toCompany,
      ),
    }),
  );

  app.post(
    '/admin/companies/:id/verification',
    {
      preValidation: requireAdmin,
      schema: {
        operationId: 'decideCompanyVerification',
        tags: ['admin'],
        summary: 'Подтвердить или отклонить компанию',
        description: [
          'Меняет verification, verification_note и verified_at, владельцы компании получают сообщение с итогом. При отклонении note обязателен: его увидит владелец.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            NOT_ADMIN,
            'company_not_found (404): компании нет.',
            'not_pending (409): компания не ждёт решения, обновите список.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        body: CompanyDecisionBody,
        response: { 200: success('Компания', CompanySchema), ...errorResponses(400, 401, 404, 409) },
      },
    },
    async (request) =>
      toCompany(
        await moderation.decideCompanyVerification(userId(request), request.params.id, request.body, 'api'),
      ),
  );

  app.post(
    '/admin/companies/:id/invites',
    {
      preValidation: requireAdmin,
      schema: {
        operationId: 'createOwnerInviteAsAdmin',
        tags: ['admin'],
        summary: 'Приглашение владельца компании',
        description: [
          'Для компании, которая осталась без владельца. Роль owner, приглашение на всю компанию, действует 72 часа. Ссылки показываются один раз.',
          describeErrors(
            NOT_ADMIN,
            'company_not_found (404): компании нет.',
            'invite_limit (409): не больше 20 действующих приглашений на компанию.',
            'bot_unavailable (503): бот не запущен, ссылки собрать нельзя.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        response: {
          201: success('Приглашение создано', CreatedInviteSchema),
          ...errorResponses(401, 404, 409, 503),
        },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          toCreatedInvite(
            await moderation.createOwnerInviteAsAdmin(userId(request), request.params.id, 'api'),
          ),
        ),
  );

  app.get(
    '/admin/complaints',
    {
      preValidation: requireAdmin,
      schema: {
        operationId: 'listComplaintsForReview',
        tags: ['admin'],
        summary: 'Жалобы на рассмотрении',
        description: [
          'Не больше 50 жалоб, сначала новые. По умолчанию только открытые.',
          describeErrors(ERROR_NOTES.validationFailed, NOT_ADMIN),
        ].join(' '),
        security: bearerSecurity,
        querystring: AdminComplaintQuery,
        response: { 200: success('Жалобы', AdminComplaintListSchema), ...errorResponses(400, 401, 404) },
      },
    },
    async (request) => ({
      items: (await moderation.listForReview(userId(request), request.query.status)).map(toAdminComplaint),
    }),
  );

  app.post(
    '/admin/complaints/:id/resolution',
    {
      preValidation: requireAdmin,
      schema: {
        operationId: 'resolveComplaint',
        tags: ['admin'],
        summary: 'Решить жалобу',
        description: [
          'Гость получает итог сообщением. При resolved сотрудники заведения получают причину, код брони и время без данных гостя.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            NOT_ADMIN,
            'complaint_not_found (404): жалобы нет.',
            'already_resolved (409): решение уже принято.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        body: ResolutionBody,
        response: { 200: success('Жалоба', AdminComplaintSchema), ...errorResponses(400, 401, 404, 409) },
      },
    },
    async (request) =>
      toAdminComplaint(
        await moderation.resolveComplaint(userId(request), request.params.id, request.body, 'api'),
      ),
  );

  app.post(
    '/admin/venues/:id/block',
    {
      preValidation: requireAdmin,
      schema: {
        operationId: 'blockVenue',
        tags: ['admin'],
        summary: 'Заблокировать заведение',
        description: [
          'В одной транзакции: заведение пропадает из каталога, подбора и броней, горящие позиции снимаются, активные брони отменяются с возвратом порций, гости и сотрудники получают сообщения.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            NOT_ADMIN,
            'venue_not_found (404): заведения нет.',
            'already_blocked (409): заведение уже заблокировано.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        body: BlockBody,
        response: {
          200: success('Заведение заблокировано', BlockStateSchema),
          ...errorResponses(400, 401, 404, 409),
        },
      },
    },
    async (request) => {
      await moderation.blockVenue(userId(request), request.params.id, request.body.reason, 'api');
      return { blocked: true };
    },
  );

  app.post(
    '/admin/venues/:id/unblock',
    {
      preValidation: requireAdmin,
      schema: {
        operationId: 'unblockVenue',
        tags: ['admin'],
        summary: 'Снять блокировку заведения',
        description: [
          'Возвращает заведение в каталог. Снятые горящие позиции и отменённые брони не восстанавливаются.',
          describeErrors(
            NOT_ADMIN,
            'venue_not_found (404): заведения нет.',
            'not_blocked (409): заведение не заблокировано.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        response: { 200: success('Блокировка снята', BlockStateSchema), ...errorResponses(401, 404, 409) },
      },
    },
    async (request) => {
      await moderation.unblockVenue(userId(request), request.params.id, 'api');
      return { blocked: false };
    },
  );

  app.post(
    '/admin/users/:id/block',
    {
      preValidation: requireAdmin,
      schema: {
        operationId: 'blockUser',
        tags: ['admin'],
        summary: 'Заблокировать пользователя',
        description: [
          'Брони и создание заведений запрещены (403 user_blocked), активные брони отменяются. Дневник и удаление аккаунта работают.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            NOT_ADMIN,
            'user_not_found (404): пользователя нет.',
            'already_blocked (409): пользователь уже заблокирован.',
            'cannot_block_admin (409): администратора заблокировать нельзя.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        body: BlockBody,
        response: {
          200: success('Пользователь заблокирован', BlockStateSchema),
          ...errorResponses(400, 401, 404, 409),
        },
      },
    },
    async (request) => {
      await moderation.blockUser(userId(request), request.params.id, request.body.reason, 'api');
      return { blocked: true };
    },
  );

  app.post(
    '/admin/users/:id/unblock',
    {
      preValidation: requireAdmin,
      schema: {
        operationId: 'unblockUser',
        tags: ['admin'],
        summary: 'Снять блокировку пользователя',
        description: describeErrors(
          NOT_ADMIN,
          'user_not_found (404): пользователя нет.',
          'not_blocked (409): пользователь не заблокирован.',
        ),
        security: bearerSecurity,
        params: IdParams,
        response: { 200: success('Блокировка снята', BlockStateSchema), ...errorResponses(401, 404, 409) },
      },
    },
    async (request) => {
      await moderation.unblockUser(userId(request), request.params.id, 'api');
      return { blocked: false };
    },
  );

  done();
};
