import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { DemoService } from '../../services/demo.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { describeErrors, ERROR_NOTES } from '../error-notes.ts';
import { errorResponses, success } from '../schemas/common.ts';
import { ClaimDemoVenueBody, DemoDiaryResultSchema, toDemoDiaryResult } from '../schemas/demo.ts';
import { toVenue, VenueSchema } from '../schemas/venues.ts';

const DEMO_MODE_DISABLED = 'demo_mode_disabled (404): демо-режим на сервере выключен, скройте эту кнопку.';

export const demoRoutes: FastifyPluginCallbackZod<{ demo: DemoService }> = (app, { demo }, done) => {
  app.post(
    '/venue/demo',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'claimDemoVenue',
        tags: ['venue'],
        summary: 'Взять демо-заведение',
        description: [
          'Только в демо-режиме. Создаёт личную копию тестового заведения: название, адрес, часы работы, доступное меню и горящие предложения на оставшуюся часть сегодняшнего дня.',
          'Владельцем становится текущий пользователь. Копию видит только он, в каталоге и подборе она заменяет исходное заведение. Дальше копией управляют как своим заведением через /api/v1/venue, в следующие дни она не обновляется.',
          'Без sourceVenueId копируется кофейня «Зерно», тело тогда пустой объект {}.',
          describeErrors(
            'validation_failed (400): sourceVenueId должен быть положительным целым числом.',
            'demo_account (403): общие демо-учётки не могут взять копию, войдите через MAX.',
            DEMO_MODE_DISABLED,
            'venue_not_found (404): sourceVenueId не тестовое заведение из демо-набора, не передавайте его.',
            'venue_exists (409): у пользователя уже есть заведение, откройте его через GET /api/v1/venue.',
          ),
        ].join(' '),
        security: bearerSecurity,
        body: ClaimDemoVenueBody,
        response: {
          201: success('Копия демо-заведения создана', VenueSchema),
          ...errorResponses(400, 401, 403, 404, 409, 413, 415),
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(toVenue(await demo.claimVenue(userId(request), request.body.sourceVenueId))),
  );

  app.post(
    '/diary/demo',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'fillDemoDiary',
        tags: ['diary'],
        summary: 'Заполнить дневник примером',
        description: [
          'Только в демо-режиме. Добавляет пример дневника за 5 прошлых дней: 26 приёмов пищи с source demo по местному времени пользователя.',
          'После этого профиль пищевого поведения готов и подбор учитывает привычки, например десерт около 16:00. Ориентир, цель и нелюбимые теги не меняются.',
          'Приёмы примера удаляются как обычные записи через DELETE /api/v1/diary/meals/{id} или вместе с аккаунтом.',
          describeErrors(
            'demo_account (403): у общей демо-учётки дневник уже заполнен.',
            ERROR_NOTES.consentRequired,
            DEMO_MODE_DISABLED,
            ERROR_NOTES.userNotFound,
            'demo_diary_exists (409): пример уже добавлен, откройте дневник.',
          ),
        ].join(' '),
        security: bearerSecurity,
        response: {
          201: success('Пример дневника добавлен', DemoDiaryResultSchema),
          ...errorResponses(401, 403, 404, 409),
        },
      },
    },
    async (request, reply) => reply.code(201).send(toDemoDiaryResult(await demo.fillDiary(userId(request)))),
  );

  done();
};
