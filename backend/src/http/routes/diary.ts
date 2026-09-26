import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { DiaryService } from '../../services/diary.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { describeErrors, ERROR_NOTES } from '../error-notes.ts';
import { errorResponses, IdParams, noContent, success } from '../schemas/common.ts';
import {
  DiaryDateParams,
  DiaryDaySchema,
  DiarySummaryQuery,
  DiarySummarySchema,
  ManualMealSchema,
  MealLogResultSchema,
  MealPatchSchema,
  MealSchema,
  MealTextBody,
  toDiaryDay,
  toDiarySummary,
  toMeal,
  toMealLogResult,
} from '../schemas/diary.ts';
import { IMAGE_UPLOAD_ERROR_STATUSES, readImageUpload } from '../uploads.ts';

const RECOGNITION_RATE_LIMIT = { max: 20, timeWindow: '1 minute' };

const RECOGNITION_NOTE = [
  'Распознавание платное, поэтому не больше 20 запросов в минуту.',
  'Уверенно распознанные блюда сохраняются сразу, неуверенные возвращаются кандидатами: гость подтверждает их через POST /api/v1/diary/meals.',
  'При status unavailable предложите ручной ввод.',
].join(' ');

export const diaryRoutes: FastifyPluginCallbackZod<{ diary: DiaryService }> = (app, { diary }, done) => {
  app.get(
    '/diary/today',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getDiaryToday',
        tags: ['diary'],
        summary: 'Дневник за сегодня',
        description: [
          'Сегодняшний день считается в часовом поясе пользователя.',
          describeErrors(ERROR_NOTES.userNotFound),
        ].join(' '),
        security: bearerSecurity,
        response: { 200: success('Дневник за сегодня', DiaryDaySchema), ...errorResponses(401, 404) },
      },
    },
    async (request) => toDiaryDay(await diary.day(userId(request))),
  );

  app.get(
    '/diary/days/:date',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getDiaryDay',
        tags: ['diary'],
        summary: 'Дневник за день',
        description: [
          'Границы дня считаются в часовом поясе пользователя.',
          describeErrors(
            'validation_failed (400): передайте дату в формате YYYY-MM-DD.',
            ERROR_NOTES.userNotFound,
          ),
        ].join(' '),
        security: bearerSecurity,
        params: DiaryDateParams,
        response: { 200: success('Дневник за день', DiaryDaySchema), ...errorResponses(400, 401, 404) },
      },
    },
    async (request) => toDiaryDay(await diary.day(userId(request), request.params.date)),
  );

  app.get(
    '/diary/summary',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getDiarySummary',
        tags: ['diary'],
        summary: 'Итоги по дням',
        description: [
          'Итоги за последние days дней включая сегодня, от старых к новым. Дни без записей тоже есть в ответе, с нулями.',
          describeErrors('validation_failed (400): days от 1 до 31.', ERROR_NOTES.userNotFound),
        ].join(' '),
        security: bearerSecurity,
        querystring: DiarySummaryQuery,
        response: { 200: success('Итоги по дням', DiarySummarySchema), ...errorResponses(400, 401, 404) },
      },
    },
    async (request) => toDiarySummary(await diary.summary(userId(request), request.query.days)),
  );

  app.post(
    '/diary/meals',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'createMeal',
        tags: ['diary'],
        summary: 'Записать приём пищи вручную',
        description: [
          'Ручной ввод и подтверждение кандидата из распознавания.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            ERROR_NOTES.consentRequired,
            ERROR_NOTES.userNotFound,
            ERROR_NOTES.eatenAtOutOfRange,
          ),
        ].join(' '),
        security: bearerSecurity,
        body: ManualMealSchema,
        response: {
          201: success('Запись создана', MealSchema),
          ...errorResponses(400, 401, 403, 404, 422),
        },
      },
    },
    async (request, reply) => {
      const meal = await diary.addManual(userId(request), request.body);
      return reply.status(201).send(toMeal(meal));
    },
  );

  app.post(
    '/diary/meals/photo',
    {
      preValidation: requireAuth,
      config: { imageUpload: true, rateLimit: RECOGNITION_RATE_LIMIT },
      schema: {
        operationId: 'logMealFromPhoto',
        tags: ['diary'],
        summary: 'Записать приём пищи по фото',
        description: [
          'Фото передаётся в поле image формы multipart/form-data: JPEG, PNG или WebP до 10 МБ, тип определяется по содержимому. Фото не сохраняется и уходит в распознавание без данных пользователя.',
          RECOGNITION_NOTE,
          describeErrors(
            'image_required, image_empty, invalid_multipart (400): приложите одно фото в поле image.',
            'image_too_large, upload_too_many_parts (413): уменьшите фото и отправьте только его.',
            'multipart_required, unsupported_image_type (415): отправьте JPEG, PNG или WebP как multipart/form-data.',
            ERROR_NOTES.consentRequired,
            ERROR_NOTES.userNotFound,
          ),
        ].join(' '),
        security: bearerSecurity,
        response: {
          200: success('Результат распознавания', MealLogResultSchema),
          ...errorResponses(...IMAGE_UPLOAD_ERROR_STATUSES, 401, 403, 404),
        },
      },
    },
    async (request) => {
      const image = await readImageUpload(request);
      return toMealLogResult(await diary.logFromPhoto(userId(request), image.data));
    },
  );

  app.post(
    '/diary/meals/text',
    {
      preValidation: requireAuth,
      config: { rateLimit: RECOGNITION_RATE_LIMIT },
      schema: {
        operationId: 'logMealFromText',
        tags: ['diary'],
        summary: 'Записать приём пищи по описанию',
        description: [
          RECOGNITION_NOTE,
          describeErrors(ERROR_NOTES.validationFailed, ERROR_NOTES.consentRequired, ERROR_NOTES.userNotFound),
        ].join(' '),
        security: bearerSecurity,
        body: MealTextBody,
        response: {
          200: success('Результат распознавания', MealLogResultSchema),
          ...errorResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) => toMealLogResult(await diary.logFromText(userId(request), request.body.description)),
  );

  app.patch(
    '/diary/meals/:id',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'updateMeal',
        tags: ['diary'],
        summary: 'Исправить запись',
        description: [
          'Меняет только переданные поля.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            ERROR_NOTES.consentRequired,
            ERROR_NOTES.mealNotFound,
            ERROR_NOTES.userNotFound,
            ERROR_NOTES.eatenAtOutOfRange,
          ),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        body: MealPatchSchema,
        response: {
          200: success('Исправленная запись', MealSchema),
          ...errorResponses(400, 401, 403, 404, 422),
        },
      },
    },
    async (request) => toMeal(await diary.update(userId(request), request.params.id, request.body)),
  );

  app.delete(
    '/diary/meals/:id',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'deleteMeal',
        tags: ['diary'],
        summary: 'Удалить запись',
        description: [
          'Работает без согласия на обработку данных.',
          describeErrors(
            'validation_failed (400): id должен быть положительным целым.',
            ERROR_NOTES.mealNotFound,
          ),
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        response: { 204: noContent('Запись удалена'), ...errorResponses(400, 401, 404) },
      },
    },
    async (request, reply) => {
      await diary.remove(userId(request), request.params.id);
      return reply.status(204).send(null);
    },
  );

  done();
};
