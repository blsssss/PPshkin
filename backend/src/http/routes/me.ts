import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { UsersService } from '../../services/users.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { errorResponses } from '../schemas/common.ts';
import { toUserProfile, UserProfileSchema } from '../schemas/users.ts';

export const meRoutes: FastifyPluginCallbackZod<{ users: UsersService }> = (app, { users }, done) => {
  app.get(
    '/me',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['me'],
        summary: 'Current user profile',
        security: bearerSecurity,
        response: { 200: UserProfileSchema, ...errorResponses(401, 404) },
      },
    },
    async (request) => toUserProfile(await users.get(userId(request))),
  );
  done();
};
