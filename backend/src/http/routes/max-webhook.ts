import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { parseUpdate } from '../../integrations/max/updates.ts';
import type { UpdateHandler } from '../../ports/messenger.ts';
import type { BackgroundTasks } from '../../shared/background.ts';
import { unavailable } from '../../shared/errors.ts';

const SECRET_HEADER = 'x-max-bot-api-secret';

const digest = (value: string) => createHash('sha256').update(value).digest();

export const maxWebhookRoutes: FastifyPluginCallbackZod<{
  secret: string;
  handler: UpdateHandler;
  background: BackgroundTasks;
}> = (app, { secret, handler, background }, done) => {
  const expected = digest(secret);
  const isAuthentic = (header: string | string[] | undefined) =>
    typeof header === 'string' && timingSafeEqual(digest(header), expected);

  app.post(
    '/max/webhook',
    {
      config: { rateLimit: false },
      schema: { hide: true, response: { 200: z.object({ ok: z.literal(true) }) } },
      onRequest: (request, reply, next) => {
        if (isAuthentic(request.headers[SECRET_HEADER])) {
          next();
          return;
        }
        reply.callNotFound();
      },
    },
    (request) => {
      const event = parseUpdate(request.body);
      if (!event) {
        request.log.debug('max update ignored');
        return { ok: true as const };
      }
      if (!background.run('max-update', () => handler(event))) {
        throw unavailable('shutting_down', 'Server is shutting down, retry the delivery later');
      }
      request.log.debug({ key: event.key }, 'max update accepted');
      return { ok: true as const };
    },
  );
  done();
};
