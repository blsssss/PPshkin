import { deriveSessionSecret } from './auth/session.ts';
import type { Config } from './config.ts';
import type { Pool } from './db/pool.ts';
import type { Recognition } from './ports/recognition.ts';
import { createAccountService } from './services/account.ts';
import { createAuthService } from './services/auth.ts';
import { createCatalogService } from './services/catalog.ts';
import { createConsentsService } from './services/consents.ts';
import { createDealsService } from './services/deals.ts';
import { createDiaryService } from './services/diary.ts';
import { createHealthService } from './services/health.ts';
import type { Services } from './services/index.ts';
import { createMenuImportsService } from './services/menu-imports.ts';
import { createMenuService } from './services/menu.ts';
import { createProfileService } from './services/profile.ts';
import { createVenuesService } from './services/venues.ts';
import type { BackgroundTasks } from './shared/background.ts';
import type { Clock } from './shared/clock.ts';

export interface ContainerOptions {
  config: Config;
  pool: Pool;
  clock: Clock;
  recognition: Recognition;
  background: BackgroundTasks;
}

export function createServices({ config, pool, clock, recognition, background }: ContainerOptions): Services {
  const consents = createConsentsService({ pool, clock });
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
    catalog: createCatalogService({ pool, clock }),
  };
}
