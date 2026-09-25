import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Config } from '../config.ts';
import { problem, registerProblemHandlers } from './problem.ts';

export interface AppOptions {
  config: Config;
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

export async function buildApp({ config, logger }: AppOptions) {
  const app = Fastify({
    logger: logger ?? loggerOptions(config),
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    disableRequestLogging: config.NODE_ENV === 'test',
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

  return app;
}
