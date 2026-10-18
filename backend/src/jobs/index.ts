import type { Config } from '../config.ts';
import type { Queryable } from '../db/pool.ts';
import type { MaxLogger } from '../integrations/max/poller.ts';
import type { WebhookGuard } from '../integrations/max/webhook-guard.ts';
import type { Outbox } from '../notifications/outbox.ts';
import type { Messenger } from '../ports/messenger.ts';
import type { Services } from '../services/index.ts';
import { bookingRemindersJob } from './booking-reminders.ts';
import { dealEndingRemindersJob } from './deal-ending-reminders.ts';
import { deliverNotificationsJob } from './deliver-notifications.ts';
import { expireBookingsJob } from './expire-bookings.ts';
import { failStaleImportsJob } from './fail-stale-imports.ts';
import { maxWebhookGuardJob } from './max-webhook-guard.ts';
import { proactiveOffersJob } from './proactive-offers.ts';
import { purgeNotificationsJob } from './purge-notifications.ts';
import { purgeProcessedUpdatesJob } from './purge-processed-updates.ts';
import { refreshDemoDataJob, type DemoDataRefresher } from './refresh-demo-data.ts';
import type { Job } from './scheduler.ts';

export interface JobsDependencies {
  config: Pick<Config, 'BOT_MODE' | 'DEMO_MODE' | 'PROACTIVE_OFFERS'>;
  db: Queryable;
  services: Pick<Services, 'bookings' | 'insights' | 'menuImports' | 'recommendations'>;
  messenger: () => Messenger | null;
  logger: MaxLogger;
  demo?: DemoDataRefresher;
  webhookGuard?: WebhookGuard;
  outbox?: Outbox;
}

export function createJobs({
  config,
  db,
  services,
  messenger,
  logger,
  demo,
  webhookGuard,
  outbox,
}: JobsDependencies): Job[] {
  return [
    expireBookingsJob(services.bookings),
    failStaleImportsJob(services.menuImports),
    purgeProcessedUpdatesJob(db),
    purgeNotificationsJob(db),
    ...(outbox
      ? [deliverNotificationsJob(outbox), bookingRemindersJob(db, outbox), dealEndingRemindersJob(db, outbox)]
      : []),
    ...(config.BOT_MODE === 'webhook' && webhookGuard ? [maxWebhookGuardJob(webhookGuard)] : []),
    ...(config.DEMO_MODE && demo ? [refreshDemoDataJob(demo, logger)] : []),
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
