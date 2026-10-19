import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/http/app.ts';
import type { AuthContext } from '../src/services/auth.ts';
import type { NotificationStats } from '../src/notifications/stats.ts';
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
    metrics: {
      snapshot: () =>
        Promise.resolve({
          users: 3,
          mealsLastDay: 5,
          activeDeals: 2,
          bookings: { redeemed: 4 },
          offers: { shown: 7 },
          notifications: { pending: 4, oldestDueSeconds: 12.5 },
          pilot: { newGuests7d: 6, redeemRate7d: 0.75, retentionD7LastCohort: 0.3 },
        }),
    },
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
    account: {
      deleteAccount: notStubbed('account.deleteAccount'),
      soleOwnerships: notStubbed('account.soleOwnerships'),
    },
    companies: {
      workplaces: () => Promise.resolve([]),
      lookup: notStubbed('companies.lookup'),
      create: notStubbed('companies.create'),
      get: notStubbed('companies.get'),
      updateRequisites: notStubbed('companies.updateRequisites'),
      listMembers: notStubbed('companies.listMembers'),
      updateMember: notStubbed('companies.updateMember'),
      removeMember: notStubbed('companies.removeMember'),
      createInvite: notStubbed('companies.createInvite'),
      listInvites: notStubbed('companies.listInvites'),
      revokeInvite: notStubbed('companies.revokeInvite'),
      previewInvite: notStubbed('companies.previewInvite'),
      createOwnerInviteAsAdmin: notStubbed('companies.createOwnerInviteAsAdmin'),
      listForVerification: notStubbed('companies.listForVerification'),
      findView: notStubbed('companies.findView'),
      acceptInvite: notStubbed('companies.acceptInvite'),
    },
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
    photos: {
      setVenuePhoto: notStubbed('photos.setVenuePhoto'),
      removeVenuePhoto: notStubbed('photos.removeVenuePhoto'),
      setMenuItemPhoto: notStubbed('photos.setMenuItemPhoto'),
      removeMenuItemPhoto: notStubbed('photos.removeMenuItemPhoto'),
      read: notStubbed('photos.read'),
    },
    menuImports: {
      fromPhoto: notStubbed('menuImports.fromPhoto'),
      fromText: notStubbed('menuImports.fromText'),
      get: notStubbed('menuImports.get'),
      apply: notStubbed('menuImports.apply'),
      failStale: notStubbed('menuImports.failStale'),
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
    bookings: {
      create: notStubbed('bookings.create'),
      list: notStubbed('bookings.list'),
      get: notStubbed('bookings.get'),
      qr: notStubbed('bookings.qr'),
      cancel: notStubbed('bookings.cancel'),
      listForVenue: notStubbed('bookings.listForVenue'),
      redeem: notStubbed('bookings.redeem'),
      expireDue: notStubbed('bookings.expireDue'),
    },
    analytics: { get: notStubbed('analytics.get') },
    reports: {
      day: notStubbed('reports.day'),
      period: notStubbed('reports.period'),
      closeOut: notStubbed('reports.closeOut'),
      exportToChat: notStubbed('reports.exportToChat'),
      build: notStubbed('reports.build'),
      file: notStubbed('reports.file'),
      queueDayClose: notStubbed('reports.queueDayClose'),
      queueWeekly: notStubbed('reports.queueWeekly'),
      venuesWithNotClosedStreak: notStubbed('reports.venuesWithNotClosedStreak'),
    },
    demo: {
      enabled: false,
      seed: notStubbed('demo.seed'),
      refresh: notStubbed('demo.refresh'),
      claimVenue: notStubbed('demo.claimVenue'),
      fillDiary: notStubbed('demo.fillDiary'),
    },
    notificationSettings: {
      get: notStubbed('notificationSettings.get'),
      update: notStubbed('notificationSettings.update'),
    },
    audit: { list: notStubbed('audit.list') },
    moderation: {
      isAdmin: () => false,
      listCompaniesForReview: notStubbed('moderation.listCompaniesForReview'),
      decideCompanyVerification: notStubbed('moderation.decideCompanyVerification'),
      createOwnerInviteAsAdmin: notStubbed('moderation.createOwnerInviteAsAdmin'),
      createComplaint: notStubbed('moderation.createComplaint'),
      listComplaints: notStubbed('moderation.listComplaints'),
      listForReview: notStubbed('moderation.listForReview'),
      resolveComplaint: notStubbed('moderation.resolveComplaint'),
      blockVenue: notStubbed('moderation.blockVenue'),
      unblockVenue: notStubbed('moderation.unblockVenue'),
      blockUser: notStubbed('moderation.blockUser'),
      unblockUser: notStubbed('moderation.unblockUser'),
      signals: notStubbed('moderation.signals'),
    },
    ...overrides,
  };
}

export function testConfig(env: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://unused',
    PHOTOS_DIR: join(tmpdir(), 'ppshkin-test-photos'),
    ...env,
  });
}

export async function buildTestApp(
  options: {
    env?: Record<string, string>;
    services?: Partial<Services>;
    notificationStats?: NotificationStats;
    extend?: (app: FastifyInstance) => void;
  } = {},
): Promise<FastifyInstance> {
  const app = await buildApp({
    config: testConfig(options.env),
    services: fakeServices(options.services),
    notificationStats: options.notificationStats,
  });
  options.extend?.(app);
  await app.ready();
  return app;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
