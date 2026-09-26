import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { RecommendationsService } from '../../services/recommendations.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { describeErrors, ERROR_NOTES } from '../error-notes.ts';
import { errorResponses, IdParams, noContent, queryPoint, success } from '../schemas/common.ts';
import {
  DeclineOfferBody,
  RecommendationsQuery,
  RecommendationsSchema,
  toRecommendations,
} from '../schemas/recommendations.ts';

export const recommendationsRoutes: FastifyPluginCallbackZod<{ recommendations: RecommendationsService }> = (
  app,
  { recommendations },
  done,
) => {
  app.get(
    '/recommendations',
    {
      preValidation: requireAuth,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        operationId: 'getRecommendations',
        tags: ['recommendations'],
        summary: 'Подобрать блюдо рядом',
        description: [
          'Подбирает конкретные блюда в открытых заведениях рядом: они укладываются в остаток калорий на сегодня и совпадают со вкусами гостя по дневнику за 14 дней.',
          'Предложения формируются только по этому запросу, в чат ничего не отправляется. Каждый ответ со status ok сохраняет показанные предложения, поэтому не больше 30 запросов в минуту.',
          'Точка: lat и lon из запроса, иначе сохранённое приблизительное местоположение. С точкой берутся заведения в радиусе 5 км, без точки все заведения, а distanceM равен null. Пустые параметры считаются непереданными.',
          'Что делать по status: ok - покажите items с объяснением (headline, facts, calculations, assumptions), offerId нужен для отказа;',
          'profile_empty - за 14 дней нет ни одной записи, предложите записать первый приём пищи;',
          'budget_exhausted - ориентир на сегодня набран, сообщите об этом и ничего не предлагайте;',
          'nothing_fits - подходящих открытых позиций рядом нет, предложите каталог горящих предложений GET /api/v1/deals.',
          describeErrors(
            'validation_failed (400): передайте lat и lon вместе, limit от 1 до 10.',
            ERROR_NOTES.userNotFound,
          ),
        ].join(' '),
        security: bearerSecurity,
        querystring: RecommendationsQuery,
        response: {
          200: success('Подобранные блюда', RecommendationsSchema),
          ...errorResponses(400, 401, 404),
        },
      },
    },
    async (request) => {
      const location = queryPoint(request.query);
      const { limit } = request.query;
      return toRecommendations(
        await recommendations.recommend(userId(request), { location, limit, channel: 'miniapp' }),
      );
    },
  );

  app.post(
    '/offers/:id/decline',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'declineOffer',
        tags: ['recommendations'],
        summary: 'Отказаться от предложения',
        description: [
          'not_today скрывает блюдо из подбора на 3 дня, dislike на 30 дней. Повторный отказ безопасен: причина и время отказа обновляются.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            'offer_not_found (404): предложения нет или оно показано другому пользователю.',
            'offer_already_accepted (409): по предложению уже создана бронь, отказаться нельзя.',
          ),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        body: DeclineOfferBody,
        response: {
          204: noContent('Отказ сохранён'),
          ...errorResponses(400, 401, 404, 409, 413, 415),
        },
      },
    },
    async (request, reply) => {
      await recommendations.decline(userId(request), request.params.id, request.body.reason);
      return reply.status(204).send(null);
    },
  );

  done();
};
