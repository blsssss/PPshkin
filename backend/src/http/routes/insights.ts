import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { InsightsService } from '../../services/insights.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { describeErrors, ERROR_NOTES } from '../error-notes.ts';
import { errorResponses, success } from '../schemas/common.ts';
import {
  BodyParametersSchema,
  InsightsSchema,
  TargetEstimateSchema,
  toInsights,
  toTargetEstimate,
} from '../schemas/insights.ts';

export const insightsRoutes: FastifyPluginCallbackZod<{ insights: InsightsService }> = (
  app,
  { insights },
  done,
) => {
  app.get(
    '/insights',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getInsights',
        tags: ['insights'],
        summary: 'Профиль пищевого поведения',
        description: [
          'Строится по дневнику за последние 14 дней в часовом поясе пользователя: готовность профиля, любимые теги, привычки по приёмам пищи, тяга к сладкому и доля белка.',
          'today - сводка текущих суток. Пока readiness равен empty, предложите записать первый приём пищи, при collecting покажите mealsUntilReady.',
          describeErrors(ERROR_NOTES.consentRequired, ERROR_NOTES.userNotFound),
        ].join(' '),
        security: bearerSecurity,
        response: {
          200: success('Профиль и сводка дня', InsightsSchema),
          ...errorResponses(401, 403, 404),
        },
      },
    },
    async (request) => toInsights(await insights.get(userId(request))),
  );

  app.post(
    '/me/target/estimate',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'estimateKcalTarget',
        tags: ['me'],
        summary: 'Рассчитать ориентир калорийности',
        description: [
          'Основной обмен считается по формуле Миффлина - Сан Жеора и умножается на коэффициент активности.',
          'Цель lose снижает расход на 15%, но не ниже 1200 ккал и основного обмена, gain добавляет 10%. Ориентир округляется до 50 ккал и лежит в пределах 1000-5000 ккал.',
          'Ничего не сохраняет: выбранный гостем ориентир сохраните через PATCH /api/v1/me с полем kcalTarget.',
          describeErrors(
            'validation_failed (400): возраст от 14 до 100 лет, рост от 120 до 230 см, вес от 35 до 250 кг с одним знаком после запятой.',
          ),
        ].join(' '),
        security: bearerSecurity,
        body: BodyParametersSchema,
        response: {
          200: success('Оценка ориентира', TargetEstimateSchema),
          ...errorResponses(400, 401, 413, 415),
        },
      },
    },
    (request) => toTargetEstimate(insights.estimateTarget(request.body)),
  );

  done();
};
