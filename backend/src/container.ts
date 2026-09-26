import { deriveSessionSecret } from './auth/session.ts';
import type { Config } from './config.ts';
import type { Pool } from './db/pool.ts';
import type { DemoDataset } from './demo/dataset.ts';
import { silentNotifier } from './notifications/silent-notifier.ts';
import type { Notifier } from './ports/notifier.ts';
import type { Recognition } from './ports/recognition.ts';
import { createAccountService } from './services/account.ts';
import { createAnalyticsService } from './services/analytics.ts';
import { createAuthService } from './services/auth.ts';
import { createBookingsService } from './services/bookings.ts';
import { createCatalogService } from './services/catalog.ts';
import { createConsentsService } from './services/consents.ts';
import { createDealsService } from './services/deals.ts';
import { createDemoService } from './services/demo.ts';
import { createDiaryService } from './services/diary.ts';
import { createHealthService } from './services/health.ts';
import type { Services } from './services/index.ts';
import { createInsightsService } from './services/insights.ts';
import { createMenuImportsService } from './services/menu-imports.ts';
import { createMenuService } from './services/menu.ts';
import { createProfileService } from './services/profile.ts';
import { createRecommendationsService } from './services/recommendations.ts';
import { createVenuesService } from './services/venues.ts';
import type { BackgroundTasks } from './shared/background.ts';
import type { Clock } from './shared/clock.ts';

export interface ContainerOptions {
  config: Config;
  pool: Pool;
  clock: Clock;
  recognition: Recognition;
  background: BackgroundTasks;
  notifier?: Notifier;
  demoDataset?: DemoDataset | null;
}

export function createServices({
  config,
  pool,
  clock,
  recognition,
  background,
  notifier = silentNotifier,
  demoDataset = null,
}: ContainerOptions): Services {
  const consents = createConsentsService({ pool, clock });
  const bookings = createBookingsService({ pool, clock, consents, notifier, background });
  return {
    health: createHealthService(pool),
    auth: createAuthService(
      pool,
      {
        botToken: config.MAX_BOT_TOKEN ?? null,
        sessionSecret: deriveSessionSecret(config.SESSION_SECRET, config.MAX_BOT_TOKEN),
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
    diary: createDiaryService({ pool, dishes: recognition.dishes, clock, consents }),
    account: createAccountService({ pool, clock }),
    venues: createVenuesService({ pool, clock }),
    menu: createMenuService({ pool, clock }),
    menuImports: createMenuImportsService({ pool, clock, menus: recognition.menus, background }),
    deals: createDealsService({ pool, clock }),
    catalog: createCatalogService({ pool, clock, demoMode: config.DEMO_MODE }),
    recommendations: createRecommendationsService({ pool, clock, consents, demoMode: config.DEMO_MODE }),
    insights: createInsightsService({ pool, clock, consents }),
    bookings,
    analytics: createAnalyticsService({ pool, clock, bookings }),
    demo: createDemoService({ pool, clock, consents, dataset: demoDataset }),
  };
}
