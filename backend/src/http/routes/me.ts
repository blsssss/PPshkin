import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { UsersService } from '../../services/users.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { errorResponses, success } from '../schemas/common.ts';
import { toUserProfile, UserProfileSchema } from '../schemas/users.ts';

export const meRoutes: FastifyPluginCallbackZod<{ users: UsersService }> = (app, { users }, done) => {
  app.get(
    '/me',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getMe',
        tags: ['me'],
        summary: 'Профиль текущего пользователя',
        security: bearerSecurity,
        response: { 200: success('Профиль', UserProfileSchema), ...errorResponses(401, 404) },
      },
    },
    async (request) => toUserProfile(await users.get(userId(request))),
  );
  done();
};
