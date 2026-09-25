import type { LogLevel } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { HealthService } from '../../services/health.ts';
import { problem, sendProblem } from '../problem.ts';
import { probeErrorResponses, success } from '../schemas/common.ts';

export const systemRoutes: FastifyPluginCallbackZod<{
  health: HealthService;
  probeLogLevel: LogLevel;
}> = (app, { health, probeLogLevel }, done) => {
  app.get(
    '/health',
    {
      logLevel: probeLogLevel,
      config: { rateLimit: false },
      schema: {
        operationId: 'getHealth',
        tags: ['system'],
        summary: 'Проверка, что процесс жив',
        response: {
          200: success('Процесс работает', z.object({ status: z.literal('ok') })),
          ...probeErrorResponses(),
        },
      },
    },
    () => ({ status: 'ok' as const }),
  );

  app.get(
    '/ready',
    {
      logLevel: probeLogLevel,
      schema: {
        operationId: 'getReadiness',
        tags: ['system'],
        summary: 'Готовность к работе, проверяет базу данных',
        response: {
          200: success('Сервис готов', z.object({ status: z.literal('ready') })),
          ...probeErrorResponses(429, 503),
        },
      },
    },
    async (_request, reply) => {
      if (await health.databaseReachable()) return { status: 'ready' as const };
      return sendProblem(reply, problem(503, 'database_unavailable', 'Database is not reachable'));
    },
  );
  done();
};
