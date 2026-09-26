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

const notStubbed = (method: string) => () => Promise.reject(new Error(`${method} is not stubbed`));

export function fakeServices(overrides: Partial<Services> = {}): Services {
  return {
    health: { databaseReachable: () => Promise.resolve(true) },
    auth: {
      signInWithMax: notStubbed('auth.signInWithMax'),
      resolveBearer: (token) => Promise.resolve(TEST_TOKENS[token] ?? null),
    },
    profile: {
      get: () => Promise.reject(notFound('user_not_found', 'User not found')),
      update: notStubbed('profile.update'),
      setLocation: notStubbed('profile.setLocation'),
      clearLocation: notStubbed('profile.clearLocation'),
    },
    consents: {
      status: notStubbed('consents.status'),
      list: notStubbed('consents.list'),
      grant: notStubbed('consents.grant'),
      revoke: notStubbed('consents.revoke'),
      requirePersonalData: notStubbed('consents.requirePersonalData'),
    },
    diary: {
      day: notStubbed('diary.day'),
      summary: notStubbed('diary.summary'),
      addManual: notStubbed('diary.addManual'),
      logFromPhoto: notStubbed('diary.logFromPhoto'),
      logFromText: notStubbed('diary.logFromText'),
      update: notStubbed('diary.update'),
      remove: notStubbed('diary.remove'),
    },
    account: { deleteAccount: notStubbed('account.deleteAccount') },
    venues: {
      get: notStubbed('venues.get'),
      create: notStubbed('venues.create'),
      update: notStubbed('venues.update'),
    },
    menu: {
      list: notStubbed('menu.list'),
      create: notStubbed('menu.create'),
      update: notStubbed('menu.update'),
      archive: notStubbed('menu.archive'),
    },
    menuImports: {
      fromPhoto: notStubbed('menuImports.fromPhoto'),
      fromText: notStubbed('menuImports.fromText'),
      get: notStubbed('menuImports.get'),
      apply: notStubbed('menuImports.apply'),
    },
    deals: {
      list: notStubbed('deals.list'),
      create: notStubbed('deals.create'),
      update: notStubbed('deals.update'),
      cancel: notStubbed('deals.cancel'),
    },
    catalog: {
      venues: notStubbed('catalog.venues'),
      venue: notStubbed('catalog.venue'),
      deals: notStubbed('catalog.deals'),
      deal: notStubbed('catalog.deal'),
    },
    recommendations: {
      recommend: notStubbed('recommendations.recommend'),
      decline: notStubbed('recommendations.decline'),
    },
    insights: {
      get: notStubbed('insights.get'),
      estimateTarget: () => {
        throw new Error('insights.estimateTarget is not stubbed');
      },
    },
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
