import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Config } from '../config.ts';
import type { Queryable } from '../db/pool.ts';
import { problem, registerProblemHandlers, sendProblem } from './problem.ts';

export interface AppDependencies {
  db: Queryable;
}

export interface AppOptions {
  config: Config;
  deps: AppDependencies;
  logger?: FastifyServerOptions['logger'];
}

export function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  return {
    level: config.LOG_LEVEL,
    redact: [
      'req.headers.authorization',
      'req.headers["x-max-init-data"]',
      'req.headers["x-max-bot-api-secret"]',
    ],
    ...(config.LOG_PRETTY ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  };
}

export async function buildApp({ config, deps, logger }: AppOptions) {
  const app = Fastify({
    logger: logger ?? loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });

  registerProblemHandlers(app);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGINS.length > 0 ? config.CORS_ORIGINS : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Max-Init-Data'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => ({
      ...problem(429, 'rate_limited', `Too many requests, retry in ${context.after}`),
      statusCode: 429,
    }),
  });

  app.get('/health', { config: { rateLimit: false }, logLevel: 'warn' }, () => ({ status: 'ok' }));

  app.get('/ready', { config: { rateLimit: false }, logLevel: 'warn' }, async (request, reply) => {
    try {
      await deps.db.query('select 1');
      return { status: 'ready' };
    } catch (error) {
      request.log.warn({ err: error }, 'database is not reachable');
      return sendProblem(reply, problem(503, 'database_unavailable', 'Database is not reachable'));
    }
  });

  return app;
}
