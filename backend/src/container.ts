import { deriveSessionSecret } from './auth/session.ts';
import type { Config } from './config.ts';
import type { Pool } from './db/pool.ts';
import { createAuthService } from './services/auth.ts';
import { createHealthService } from './services/health.ts';
import type { Services } from './services/index.ts';
import { createUsersService } from './services/users.ts';
import type { Clock } from './shared/clock.ts';

export interface ContainerOptions {
  config: Config;
  pool: Pool;
  clock: Clock;
}

export function createServices({ config, pool, clock }: ContainerOptions): Services {
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
    users: createUsersService(pool),
  };
}
