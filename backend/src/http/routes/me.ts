import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { AccountService } from '../../services/account.ts';
import type { ProfileService } from '../../services/profile.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { describeErrors, ERROR_NOTES } from '../error-notes.ts';
import { errorResponses, GeoPointSchema, noContent, success } from '../schemas/common.ts';
import {
  ProfilePatchSchema,
  toUserLocation,
  toUserProfile,
  UserLocationSchema,
  UserProfileSchema,
} from '../schemas/users.ts';

interface MeRoutesOptions {
  profile: ProfileService;
  account: AccountService;
}

export const meRoutes: FastifyPluginCallbackZod<MeRoutesOptions> = (app, { profile, account }, done) => {
  app.get(
    '/me',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getMe',
        tags: ['me'],
        summary: 'Профиль текущего пользователя',
        description: [
          'Профиль вместе с состоянием согласий: по consents мини-приложение решает, показывать ли экраны согласий.',
          describeErrors(ERROR_NOTES.userNotFound),
        ].join(' '),
        security: bearerSecurity,
        response: { 200: success('Профиль', UserProfileSchema), ...errorResponses(401, 404) },
      },
    },
    async (request) => {
      const { user, consents } = await profile.get(userId(request));
      return toUserProfile(user, consents);
    },
  );

  app.patch(
    '/me',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'updateMe',
        tags: ['me'],
        summary: 'Изменить профиль',
        description: [
          'Меняет только переданные поля: ориентир калорийности, цель, нелюбимые теги, часовой пояс. Повторы тегов удаляются.',
          describeErrors(
            ERROR_NOTES.validationFailed,
            ERROR_NOTES.consentRequired,
            ERROR_NOTES.userNotFound,
            'invalid_timezone (422): часовой пояс не найден, передайте имя IANA, например Europe/Moscow.',
          ),
        ].join(' '),
        security: bearerSecurity,
        body: ProfilePatchSchema,
        response: {
          200: success('Обновлённый профиль', UserProfileSchema),
          ...errorResponses(400, 401, 403, 404, 422),
        },
      },
    },
    async (request) => {
      const { user, consents } = await profile.update(userId(request), request.body);
      return toUserProfile(user, consents);
    },
  );

  app.put(
    '/me/location',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'setMyLocation',
        tags: ['me'],
        summary: 'Сохранить местоположение',
        description: [
          'Координаты округляются до 2 знаков (около 1 км) и сохраняются только в таком виде, по ним подбираются заведения рядом.',
          describeErrors(ERROR_NOTES.validationFailed, ERROR_NOTES.consentRequired, ERROR_NOTES.userNotFound),
        ].join(' '),
        security: bearerSecurity,
        body: GeoPointSchema,
        response: {
          200: success('Сохранённое местоположение', UserLocationSchema),
          ...errorResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) => toUserLocation(await profile.setLocation(userId(request), request.body)),
  );

  app.delete(
    '/me/location',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'clearMyLocation',
        tags: ['me'],
        summary: 'Удалить местоположение',
        description: 'Работает без согласия на обработку данных. Повторный вызов тоже отвечает 204.',
        security: bearerSecurity,
        response: { 204: noContent('Местоположение удалено'), ...errorResponses(401) },
      },
    },
    async (request, reply) => {
      await profile.clearLocation(userId(request));
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '/me',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'deleteMyAccount',
        tags: ['me'],
        summary: 'Удалить аккаунт и все данные',
        description: [
          'Бесплатно и сразу удаляет профиль, дневник, согласия и состояние бота, отменяет активные брони с возвратом порций в горящие предложения и стирает объяснения показанных предложений. Копия тестового заведения из демо-режима удаляется вместе с меню, акциями и бронями.',
          'Повторный вызов тоже отвечает 204. После удаления старый токен получает 404 user_not_found на GET /api/v1/me, новый вход создаёт пустой профиль без согласий.',
          describeErrors(
            'demo_account_protected (403): демо-учётка общая для всех проверяющих, её удалить нельзя.',
          ),
        ].join(' '),
        security: bearerSecurity,
        response: { 204: noContent('Аккаунт удалён'), ...errorResponses(401, 403) },
      },
    },
    async (request, reply) => {
      await account.deleteAccount(userId(request));
      return reply.status(204).send(null);
    },
  );

  done();
};
