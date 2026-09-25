import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Config } from '../config.ts';
import type { Services } from '../services/index.ts';
import { registerAuthentication } from './auth.ts';
import { registerOpenApi } from './openapi.ts';
import { problem, registerProblemHandlers } from './problem.ts';
import { apiRoutes } from './routes/index.ts';
import { systemRoutes } from './routes/system.ts';

export interface AppOptions {
  config: Config;
  services: Services;
  logger?: FastifyServerOptions['logger'];
}

const LEVEL_ORDER = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

export function quietestLevel(first: Config['LOG_LEVEL'], second: Config['LOG_LEVEL']): Config['LOG_LEVEL'] {
  return LEVEL_ORDER.indexOf(first) >= LEVEL_ORDER.indexOf(second) ? first : second;
}

export function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  return {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers["x-max-bot-api-secret"]'],
    ...(config.LOG_PRETTY ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  };
}

export function publicUrl(config: Config): string {
  return config.PUBLIC_BASE_URL ?? `http://localhost:${config.PORT}`;
}

export async function buildApp({ config, services, logger }: AppOptions) {
  const app = Fastify({
    logger: logger ?? loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerProblemHandlers(app);
  registerAuthentication(app, services.auth);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGINS.length > 0 ? config.CORS_ORIGINS : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: (request) => (request.auth ? `user:${request.auth.userId}` : `ip:${request.ip}`),
    errorResponseBuilder: (_request, context) => ({
      ...problem(429, 'rate_limited', `Too many requests, retry in ${context.after}`),
      statusCode: 429,
    }),
  });
  await registerOpenApi(app, publicUrl(config));

  await app.register(systemRoutes, {
    health: services.health,
    probeLogLevel: quietestLevel(config.LOG_LEVEL, 'warn'),
  });
  await app.register(apiRoutes, { prefix: '/api/v1', services });

  return app;
}
