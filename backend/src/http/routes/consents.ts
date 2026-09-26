import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { ConsentsService } from '../../services/consents.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { describeErrors, ERROR_NOTES } from '../error-notes.ts';
import { errorResponses, noContent, success } from '../schemas/common.ts';
import {
  ConsentDocumentListSchema,
  ConsentKindParams,
  ConsentStateSchema,
  GrantConsentBody,
  toConsentDocument,
  toConsentState,
} from '../schemas/consents.ts';

export const consentsRoutes: FastifyPluginCallbackZod<{ consents: ConsentsService }> = (
  app,
  { consents },
  done,
) => {
  app.get(
    '/consents',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'listConsents',
        tags: ['consents'],
        summary: 'Тексты согласий и их состояние',
        description:
          'Возвращает personal_data (обязательное, без него дневник и профиль не сохраняются) и personalized_offers (необязательное). Каждое согласие показывается отдельным экраном с полным текстом и своей кнопкой, после нажатия отправьте PUT /api/v1/consents/{kind} с version из ответа.',
        security: bearerSecurity,
        response: {
          200: success('Согласия в порядке показа', ConsentDocumentListSchema),
          ...errorResponses(401),
        },
      },
    },
    async (request) => ({ items: (await consents.list(userId(request))).map(toConsentDocument) }),
  );

  app.put(
    '/consents/:kind',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'grantConsent',
        tags: ['consents'],
        summary: 'Дать согласие',
        description: [
          'Сохраняет согласие с версией текста, каналом miniapp и временем, предыдущая запись остаётся в истории. Повтор с той же версией ничего не меняет.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            ERROR_NOTES.userNotFound,
            'consent_version_outdated (409): текст изменился, загрузите GET /api/v1/consents и покажите его заново.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: ConsentKindParams,
        body: GrantConsentBody,
        response: {
          200: success('Состояние согласия', ConsentStateSchema),
          ...errorResponses(400, 401, 404, 409),
        },
      },
    },
    async (request) =>
      toConsentState(
        await consents.grant(userId(request), request.params.kind, request.body.version, 'miniapp'),
      ),
  );

  app.delete(
    '/consents/:kind',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'revokeConsent',
        tags: ['consents'],
        summary: 'Отозвать согласие',
        description: [
          'Сразу отзывает согласие на персональные предложения, повторный вызов тоже отвечает 204.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            'delete_account_instead (409): согласие на обработку данных отзывается только удалением аккаунта, покажите «Чтобы отозвать согласие на обработку данных, удалите аккаунт» и предложите DELETE /api/v1/me.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: ConsentKindParams,
        response: { 204: noContent('Согласие отозвано'), ...errorResponses(400, 401, 409) },
      },
    },
    async (request, reply) => {
      await consents.revoke(userId(request), request.params.kind);
      return reply.status(204).send(null);
    },
  );

  done();
};
