import type { Config } from '../config.ts';
import type { Queryable } from '../db/pool.ts';
import type { MaxLogger } from '../integrations/max/poller.ts';
import type { Messenger } from '../ports/messenger.ts';
import type { Services } from '../services/index.ts';
import { expireBookingsJob } from './expire-bookings.ts';
import { failStaleImportsJob } from './fail-stale-imports.ts';
import { proactiveOffersJob } from './proactive-offers.ts';
import { purgeProcessedUpdatesJob } from './purge-processed-updates.ts';
import { refreshDemoDataJob, type DemoDataRefresher } from './refresh-demo-data.ts';
import type { Job } from './scheduler.ts';

export interface JobsDependencies {
  config: Pick<Config, 'DEMO_MODE' | 'PROACTIVE_OFFERS'>;
  db: Queryable;
  services: Pick<Services, 'bookings' | 'insights' | 'recommendations'>;
  messenger: () => Messenger | null;
  logger: MaxLogger;
  demo?: DemoDataRefresher;
}

export function createJobs({ config, db, services, messenger, logger, demo }: JobsDependencies): Job[] {
  return [
    expireBookingsJob(services.bookings),
    failStaleImportsJob(db),
    purgeProcessedUpdatesJob(db),
    ...(config.DEMO_MODE && demo ? [refreshDemoDataJob(demo)] : []),
    ...(config.PROACTIVE_OFFERS
      ? [
          proactiveOffersJob({
            db,
            insights: services.insights,
            recommendations: services.recommendations,
            messenger,
            logger,
          }),
        ]
      : []),
  ];
}
