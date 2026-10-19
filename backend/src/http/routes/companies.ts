import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { CompaniesService } from '../../services/companies.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { describeErrors, ERROR_NOTES } from '../error-notes.ts';
import { errorResponses, IdParams, noContent, success } from '../schemas/common.ts';
import {
  CompanyBody,
  CompanyLookupSchema,
  CompanySchema,
  CreatedInviteSchema,
  InviteBody,
  InviteListSchema,
  InviteParams,
  InvitePreviewSchema,
  LookupBody,
  MemberListSchema,
  MemberParams,
  MemberPatchBody,
  MemberSchema,
  TokenBody,
  toCompany,
  toCompanyLookup,
  toCreatedInvite,
  toInvite,
  toInvitePreview,
  toMember,
  toWorkplace,
  WorkplaceSchema,
} from '../schemas/companies.ts';

interface CompanyRouteOptions {
  companies: CompaniesService;
}

const NOT_FOUND = 'company_not_found (404): компании нет или вы не её сотрудник.';
const FORBIDDEN = 'company_forbidden (403): роль не позволяет это действие.';
const INN_NOTES = [
  'inn_invalid (422): неверная длина или контрольные цифры ИНН.',
  'company_inactive (422): компания в реестре не действует.',
  'company_not_in_registry (422): компании с таким ИНН нет в реестре.',
];

export const companyRoutes: FastifyPluginCallbackZod<CompanyRouteOptions> = (app, { companies }, done) => {
  app.post(
    '/companies/lookup',
    {
      preValidation: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        operationId: 'lookupCompany',
        tags: ['company'],
        summary: 'Найти компанию по ИНН',
        description: [
          'Карточка компании из ЕГРЮЛ или ЕГРИП: наименование, реквизиты, руководитель, статус и ОКВЭД. Не больше 10 запросов в минуту.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            'company_not_in_registry (404): компании с таким ИНН нет в реестре.',
            'inn_invalid (422): неверная длина или контрольные цифры ИНН, запрос в реестр не отправлялся.',
            'company_inactive (422): компания в реестре не действует.',
            'registry_unavailable (503): реестр недоступен, повторите позже или отправьте ИНН в POST /api/v1/companies, реквизиты проверит модератор.',
          ),
        ].join(' '),
        security: bearerSecurity,
        body: LookupBody,
        response: {
          200: success('Карточка компании', CompanyLookupSchema),
          ...errorResponses(400, 401, 404, 422, 503),
        },
      },
    },
    async (request) => toCompanyLookup(await companies.lookup(userId(request), request.body.inn)),
  );

  app.post(
    '/companies',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'createCompany',
        tags: ['company'],
        summary: 'Подключить компанию',
        description: [
          'Создаёт компанию с реквизитами из реестра в статусе pending, текущий пользователь становится владельцем. Если реестр недоступен, принимается ИНН с верными контрольными цифрами, реквизиты проверит модератор.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            'user_blocked (403): аккаунт заблокирован администратором.',
            'company_exists (409): компания уже подключена, попросите владельца пригласить вас или напишите в поддержку.',
            ...INN_NOTES,
          ),
        ].join(' '),
        security: bearerSecurity,
        body: CompanyBody,
        response: {
          201: success('Компания создана', CompanySchema),
          ...errorResponses(400, 401, 403, 409, 422),
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(toCompany(await companies.create(userId(request), request.body.inn))),
  );

  app.get(
    '/companies/:id',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getCompany',
        tags: ['company'],
        summary: 'Компания',
        description: describeErrors(ERROR_NOTES.validationFailed, NOT_FOUND),
        security: bearerSecurity,
        params: IdParams,
        response: { 200: success('Компания', CompanySchema), ...errorResponses(400, 401, 404) },
      },
    },
    async (request) => toCompany(await companies.get(userId(request), request.params.id)),
  );

  app.patch(
    '/companies/:id',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'updateCompany',
        tags: ['company'],
        summary: 'Указать реквизиты компании',
        description: [
          'Подставляет реквизиты по ИНН для компании без реквизитов или с отклонённой заявкой и отправляет её на проверку. Только владелец.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            FORBIDDEN,
            NOT_FOUND,
            'company_exists (409): этот ИНН уже у другой компании.',
            'requisites_locked (409): компания на проверке или подтверждена, реквизиты меняются только через поддержку.',
            ...INN_NOTES,
          ),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        body: CompanyBody,
        response: {
          200: success('Компания обновлена', CompanySchema),
          ...errorResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request) =>
      toCompany(await companies.updateRequisites(userId(request), request.params.id, request.body.inn)),
  );

  app.get(
    '/companies/:id/members',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'listCompanyMembers',
        tags: ['company'],
        summary: 'Сотрудники компании',
        description: [
          'Владелец видит всех, управляющий себя и кассиров своих заведений.',
          describeErrors(ERROR_NOTES.validationFailed, FORBIDDEN, NOT_FOUND),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        response: { 200: success('Сотрудники', MemberListSchema), ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      items: (await companies.listMembers(userId(request), request.params.id)).map(toMember),
    }),
  );

  app.patch(
    '/companies/:id/members/:userId',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'updateCompanyMember',
        tags: ['company'],
        summary: 'Изменить роль или заведение сотрудника',
        description: [
          'Владелец меняет всех, управляющий только кассиров своих заведений. venueId: null даёт доступ ко всем заведениям компании.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            FORBIDDEN,
            NOT_FOUND,
            'member_not_found (404): такого сотрудника в компании нет.',
            'venue_not_found (404): заведения нет в этой компании.',
            'last_owner (409): в компании должен остаться хотя бы один владелец.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: MemberParams,
        body: MemberPatchBody,
        response: { 200: success('Сотрудник', MemberSchema), ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) =>
      toMember(
        await companies.updateMember(userId(request), request.params.id, request.params.userId, request.body),
      ),
  );

  app.delete(
    '/companies/:id/members/:userId',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'removeCompanyMember',
        tags: ['company'],
        summary: 'Исключить сотрудника или выйти из компании',
        description: [
          'Свой id означает выход из компании. Исключённому сотруднику бот пишет о закрытом доступе, права пропадают со следующего запроса.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            FORBIDDEN,
            NOT_FOUND,
            'member_not_found (404): такого сотрудника в компании нет.',
            'last_owner (409): последний владелец не может выйти или быть исключён.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: MemberParams,
        response: { 204: noContent('Сотрудник исключён'), ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      await companies.removeMember(userId(request), request.params.id, request.params.userId);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/companies/:id/invites',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'createCompanyInvite',
        tags: ['company'],
        summary: 'Пригласить сотрудника',
        description: [
          'Ссылки показываются один раз: в базе остаётся только хеш токена. Приглашение действует 72 часа и принимается один раз. Владелец приглашает любую роль, управляющий только кассиров в свои заведения.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            FORBIDDEN,
            NOT_FOUND,
            'venue_not_found (404): заведения нет в этой компании или в компании ещё нет заведений.',
            'invite_limit (409): не больше 20 действующих приглашений на компанию, отзовите лишние.',
            'bot_unavailable (503): бот не запущен, ссылки собрать нельзя.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        body: InviteBody,
        response: {
          201: success('Приглашение создано', CreatedInviteSchema),
          ...errorResponses(400, 401, 403, 404, 409, 503),
        },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          toCreatedInvite(await companies.createInvite(userId(request), request.params.id, request.body)),
        ),
  );

  app.get(
    '/companies/:id/invites',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'listCompanyInvites',
        tags: ['company'],
        summary: 'Действующие приглашения',
        description: [
          'Токены не возвращаются. Управляющий видит приглашения кассиров своих заведений.',
          describeErrors(ERROR_NOTES.validationFailed, FORBIDDEN, NOT_FOUND),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        response: { 200: success('Приглашения', InviteListSchema), ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      items: (await companies.listInvites(userId(request), request.params.id)).map(toInvite),
    }),
  );

  app.delete(
    '/companies/:id/invites/:inviteId',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'revokeCompanyInvite',
        tags: ['company'],
        summary: 'Отозвать приглашение',
        description: describeErrors(
          ERROR_NOTES.validationFailed,
          FORBIDDEN,
          NOT_FOUND,
          'invite_not_found (404): приглашения нет, оно принято, истекло или уже отозвано.',
        ),
        security: bearerSecurity,
        params: InviteParams,
        response: { 204: noContent('Приглашение отозвано'), ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      await companies.revokeInvite(userId(request), request.params.id, request.params.inviteId);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/invites/preview',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'previewInvite',
        tags: ['company'],
        summary: 'Посмотреть приглашение',
        description: [
          'Токен передаётся в теле, а не в пути: путь запроса попадает в журнал сервера.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            'invite_not_found (404): приглашения нет или оно отозвано.',
            'invite_expired (409): срок приглашения вышел, попросите новое.',
            'invite_used (409): приглашение уже принято.',
          ),
        ].join(' '),
        security: bearerSecurity,
        body: TokenBody,
        response: { 200: success('Приглашение', InvitePreviewSchema), ...errorResponses(400, 401, 404, 409) },
      },
    },
    async (request) => toInvitePreview(await companies.previewInvite(request.body.token)),
  );

  app.post(
    '/invites/accept',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'acceptInvite',
        tags: ['company'],
        summary: 'Принять приглашение',
        description: [
          'Ответ - рабочее место, которое получил сотрудник. Согласие гостя на дневник питания для этого не нужно.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            'invite_not_found (404): приглашения нет или оно отозвано.',
            'invite_expired (409): срок приглашения вышел, попросите новое.',
            'invite_used (409): приглашение уже принято.',
            'already_member (409): вы уже работаете в этой компании.',
          ),
        ].join(' '),
        security: bearerSecurity,
        body: TokenBody,
        response: { 200: success('Рабочее место', WorkplaceSchema), ...errorResponses(400, 401, 404, 409) },
      },
    },
    async (request) =>
      toWorkplace(
        await companies
          .acceptInvite(userId(request), request.body.token)
          .then((accepted) => accepted.workplace),
      ),
  );

  done();
};
