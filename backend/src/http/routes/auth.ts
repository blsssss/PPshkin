import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthService } from '../../services/auth.ts';
import { errorResponses, IsoDateTime, iso, success } from '../schemas/common.ts';
import { toUserProfile, UserProfileSchema } from '../schemas/users.ts';

const SignInBody = z.object({
  initData: z.string().min(1).max(8192).describe('Строка window.WebApp.initData из MAX Bridge без изменений'),
});

const SessionSchema = z
  .object({
    token: z.string().describe('Токен для заголовка Authorization: Bearer'),
    expiresAt: IsoDateTime,
    startParam: z
      .string()
      .nullable()
      .describe('Подписанный параметр startapp, с которым открыто мини-приложение'),
    user: UserProfileSchema,
  })
  .meta({ id: 'Session' });

export const authRoutes: FastifyPluginCallbackZod<{ auth: AuthService }> = (app, { auth }, done) => {
  app.post(
    '/auth/max',
    {
      config: {
        rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: (request) => `sign-in:${request.ip}` },
      },
      schema: {
        operationId: 'signInWithMax',
        tags: ['auth'],
        summary: 'Вход по initData мини-приложения MAX',
        description: [
          'Проверяет подпись initData по алгоритму MAX (HMAC-SHA256 с ключом WebAppData и токеном бота) и срок давности, создаёт пользователя при первом входе и выдаёт сессионный токен.',
          'Коды ошибок: init_data_malformed, init_data_bad_signature, init_data_no_user (401, отправьте initData без изменений), init_data_expired (401, переоткройте мини-приложение), auth_unavailable (503, вход через MAX не настроен на сервере).',
          'Токен из ответа передаётся в заголовке Authorization: Bearer. Ответ 401 с кодом invalid_token на других методах означает, что сессия истекла и нужно войти заново.',
        ].join(' '),
        body: SignInBody,
        response: {
          200: success('Сессия создана', SessionSchema),
          ...errorResponses(400, 401, 413, 415, 503),
        },
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
