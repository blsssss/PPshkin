import type { LogLevel } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { HealthService } from '../../services/health.ts';
import { problem, sendProblem } from '../problem.ts';
import { errorResponses } from '../schemas/common.ts';

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
        tags: ['system'],
        summary: 'Liveness probe',
        response: { 200: z.object({ status: z.literal('ok') }) },
      },
    },
    () => ({ status: 'ok' as const }),
  );

  app.get(
    '/ready',
    {
      logLevel: probeLogLevel,
      schema: {
        tags: ['system'],
        summary: 'Readiness probe, checks the database',
        response: { 200: z.object({ status: z.literal('ready') }), ...errorResponses(503) },
      },
    },
    async (_request, reply) => {
      if (await health.databaseReachable()) return { status: 'ready' as const };
      return sendProblem(reply, problem(503, 'database_unavailable', 'Database is not reachable'));
    },
  );
  done();
};
