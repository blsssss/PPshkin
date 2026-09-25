import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/http/app.ts';
import type { AuthContext } from '../src/services/auth.ts';
import type { Services } from '../src/services/index.ts';
import { notFound } from '../src/shared/errors.ts';

export const TEST_TOKENS: Record<string, AuthContext> = {
  'guest-token': { userId: 101, via: 'session', demoRole: null },
  'venue-token': { userId: 202, via: 'session', demoRole: null },
  'demo-guest-token': { userId: -1001, via: 'demo', demoRole: 'guest' },
};

export function fakeServices(overrides: Partial<Services> = {}): Services {
  return {
    health: { databaseReachable: () => Promise.resolve(true) },
    auth: {
      signInWithMax: () => Promise.reject(new Error('signInWithMax is not stubbed')),
      resolveBearer: (token) => Promise.resolve(TEST_TOKENS[token] ?? null),
    },
    users: { get: () => Promise.reject(notFound('user_not_found', 'User not found')) },
    ...overrides,
  };
}

export function testConfig(env: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://unused',
    ...env,
  });
}

export async function buildTestApp(
  options: {
    env?: Record<string, string>;
    services?: Partial<Services>;
    extend?: (app: FastifyInstance) => void;
  } = {},
): Promise<FastifyInstance> {
  const app = await buildApp({ config: testConfig(options.env), services: fakeServices(options.services) });
  options.extend?.(app);
  await app.ready();
  return app;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
