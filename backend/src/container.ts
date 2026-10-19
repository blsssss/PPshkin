import { deriveSessionSecret } from './auth/session.ts';
import type { Config } from './config.ts';
import type { Pool } from './db/pool.ts';
import type { DemoDataset } from './demo/dataset.ts';
import { createDadataRegistry } from './integrations/dadata/client.ts';
import { silentNotifications } from './notifications/silent-notifier.ts';
import type { CompanyRegistry } from './ports/company-registry.ts';
import type { Messenger } from './ports/messenger.ts';
import type { Notifications } from './ports/notifier.ts';
import type { Recognition } from './ports/recognition.ts';
import { createAccountService } from './services/account.ts';
import { createAnalyticsService } from './services/analytics.ts';
import { createAuditService } from './services/audit.ts';
import { createAuthService } from './services/auth.ts';
import { createBookingsService } from './services/bookings.ts';
import { createCatalogService } from './services/catalog.ts';
import { createCompaniesService } from './services/companies.ts';
import { createConsentsService } from './services/consents.ts';
import { createDealsService } from './services/deals.ts';
import { createDemoService } from './services/demo.ts';
import { createDiaryService } from './services/diary.ts';
import { createHealthService } from './services/health.ts';
import type { Services } from './services/index.ts';
import { createInsightsService } from './services/insights.ts';
import { createMenuImportsService } from './services/menu-imports.ts';
import { createMenuService } from './services/menu.ts';
import { createMetricsService } from './services/metrics.ts';
import { createModerationService } from './services/moderation.ts';
import { createNotificationSettingsService } from './services/notification-settings.ts';
import { createProfileService } from './services/profile.ts';
import { createRecommendationsService } from './services/recommendations.ts';
import { createReportsService } from './services/reports.ts';
import { createVenuesService } from './services/venues.ts';
import type { BackgroundTasks } from './shared/background.ts';
import type { Clock } from './shared/clock.ts';

export interface ContainerOptions {
  config: Config;
  pool: Pool;
  clock: Clock;
  recognition: Recognition;
  background: BackgroundTasks;
  notifications?: Notifications;
  demoDataset?: DemoDataset | null;
  registry?: CompanyRegistry;
  botUsername?: () => string | null;
  messenger?: () => Messenger | null;
}

export function createServices({
  config,
  pool,
  clock,
  recognition,
  background,
  notifications = silentNotifications,
  demoDataset = null,
  registry = createDadataRegistry({ apiKey: config.DADATA_API_KEY ?? null }),
  botUsername = () => null,
  messenger = () => null,
}: ContainerOptions): Services {
  const consents = createConsentsService({ pool, clock });
  const bookings = createBookingsService({
    pool,
    clock,
    consents,
    notifications,
    verificationRequired: config.VENUE_VERIFICATION_REQUIRED,
  });
  const companies = createCompaniesService({
    pool,
    clock,
    registry,
    notifications,
    adminIds: config.ADMIN_USER_IDS,
    verificationRequired: config.VENUE_VERIFICATION_REQUIRED,
    botUsername,
  });
  const reports = createReportsService({
    pool,
    clock,
    bookings,
    notifications,
    messenger,
    background,
  });
  return {
    health: createHealthService(pool),
    metrics: createMetricsService(pool, clock),
    auth: createAuthService(
      pool,
      {
        botToken: config.MAX_BOT_TOKEN ?? null,
        sessionSecret: deriveSessionSecret(config.SESSION_SECRET, config.MAX_BOT_TOKEN),
        previousSessionSecret: config.SESSION_SECRET_PREVIOUS ?? null,
        sessionTtlSeconds: config.SESSION_TTL_HOURS * 3600,
        initDataMaxAgeSeconds: config.INIT_DATA_MAX_AGE_SECONDS,
        demoTokens: config.DEMO_MODE
          ? { guest: config.DEMO_GUEST_TOKEN, venue: config.DEMO_VENUE_TOKEN }
          : null,
      },
      clock,
    ),
    profile: createProfileService({ pool, clock, consents }),
    consents,
    companies,
    diary: createDiaryService({ pool, dishes: recognition.dishes, clock, consents }),
    account: createAccountService({ pool, clock, notifications, adminIds: config.ADMIN_USER_IDS }),
    venues: createVenuesService({ pool, clock }),
    menu: createMenuService({ pool, clock }),
    menuImports: createMenuImportsService({
      pool,
      clock,
      menus: recognition.menus,
      background,
      notifications,
    }),
    deals: createDealsService({ pool, clock }),
    catalog: createCatalogService({
      pool,
      clock,
      demoMode: config.DEMO_MODE,
      verificationRequired: config.VENUE_VERIFICATION_REQUIRED,
    }),
    recommendations: createRecommendationsService({
      pool,
      clock,
      consents,
      demoMode: config.DEMO_MODE,
      verificationRequired: config.VENUE_VERIFICATION_REQUIRED,
    }),
    insights: createInsightsService({ pool, clock, consents }),
    bookings,
    analytics: createAnalyticsService({ pool, clock, bookings }),
    reports,
    demo: createDemoService({ pool, clock, consents, dataset: demoDataset }),
    notificationSettings: createNotificationSettingsService({ pool, clock }),
    audit: createAuditService({ pool }),
    moderation: createModerationService({
      pool,
      clock,
      notifications,
      adminIds: config.ADMIN_USER_IDS,
      companies,
      reports,
      verificationRequired: config.VENUE_VERIFICATION_REQUIRED,
    }),
  };
}
