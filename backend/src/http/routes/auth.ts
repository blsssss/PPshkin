import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthService } from '../../services/auth.ts';
import { errorResponses, IsoDateTime, iso } from '../schemas/common.ts';
import { toUserProfile, UserProfileSchema } from '../schemas/users.ts';

const SignInBody = z.object({
  initData: z
    .string()
    .min(1)
    .max(8192)
    .describe('Raw window.WebApp.initData string from MAX Bridge, sent as is'),
});

const SessionSchema = z
  .object({
    token: z.string().describe('Bearer token for the Authorization header'),
    expiresAt: IsoDateTime,
    startParam: z.string().nullable().describe('Signed startapp parameter the mini app was opened with'),
    user: UserProfileSchema,
  })
  .meta({ id: 'Session' });

export const authRoutes: FastifyPluginCallbackZod<{ auth: AuthService }> = (app, { auth }, done) => {
  app.post(
    '/auth/max',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Exchange MAX mini app init data for a session token',
        description:
          'Проверяет подпись initData по алгоритму MAX (HMAC-SHA256 с ключом WebAppData и токеном бота) и срок давности, создаёт пользователя при первом входе.',
        body: SignInBody,
        response: { 200: SessionSchema, ...errorResponses(400, 401, 503) },
      },
    },
    async (request) => {
      const signedIn = await auth.signInWithMax(request.body.initData);
      return {
        token: signedIn.token,
        expiresAt: iso(signedIn.expiresAt),
        startParam: signedIn.startParam,
        user: toUserProfile(signedIn.user),
      };
    },
  );
  done();
};
