import type { Queryable } from '../db/pool.ts';
import {
  AUDIT_EVENT_RETENTION_MS,
  before,
  CHAT_STATE_RETENTION_MS,
  inactiveDeletionBefore,
  inactiveWarningBefore,
  INACTIVE_WARNING_MS,
  OFFER_EXPLANATION_RETENTION_MS,
} from '../domain/retention.ts';
import type { MaxLogger } from '../integrations/max/poller.ts';
import type { Notifications } from '../ports/notifier.ts';
import { eraseOfferExplanationsBefore } from '../repositories/account.ts';
import { purgeCreatedBefore } from '../repositories/audit.ts';
import { deleteUpdatedBefore } from '../repositories/chat-states.ts';
import * as users from '../repositories/users.ts';
import type { AccountService } from '../services/account.ts';
import type { Job } from './scheduler.ts';

const INACTIVE_BATCH = 200;

export interface PurgeRetentionDependencies {
  db: Queryable;
  account: Pick<AccountService, 'deleteAccount'>;
  notifications: Notifications;
  purgeInactiveAccounts: boolean;
  logger: MaxLogger;
}

export function purgeRetentionJob({
  db,
  account,
  notifications,
  purgeInactiveAccounts,
  logger,
}: PurgeRetentionDependencies): Job {
  async function purgeInactive(now: Date): Promise<void> {
    const toWarn = await users.listInactiveToWarn(db, inactiveWarningBefore(now), INACTIVE_BATCH);
    for (const user of toWarn) {
      await notifications.enqueue(db, { kind: 'account_inactive_warning', user }, now);
    }
    if (toWarn.length > 0) notifications.flush();
    const toDelete = await users.listInactiveToDelete(
      db,
      inactiveDeletionBefore(now),
      before(now, INACTIVE_WARNING_MS),
      INACTIVE_BATCH,
    );
    for (const userId of toDelete) {
      try {
        await account.deleteAccount(userId);
      } catch (error) {
        logger.error({ err: error, userId }, 'inactive account was not deleted');
      }
    }
    logger.info({ warned: toWarn.length, deleted: toDelete.length }, 'inactive accounts checked');
  }

  return {
    name: 'purge_retention',
    schedule: { dailyAt: '04:50', timeZone: 'Europe/Moscow' },
    run: async (now) => {
      const explanations = await eraseOfferExplanationsBefore(
        db,
        before(now, OFFER_EXPLANATION_RETENTION_MS),
      );
      const chats = await deleteUpdatedBefore(db, before(now, CHAT_STATE_RETENTION_MS));
      const events = await purgeCreatedBefore(db, before(now, AUDIT_EVENT_RETENTION_MS));
      logger.info({ explanations, chats, events }, 'expired data purged');
      if (purgeInactiveAccounts) await purgeInactive(now);
    },
  };
}
