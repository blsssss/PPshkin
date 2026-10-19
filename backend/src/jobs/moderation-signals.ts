import type { MaxLogger } from '../integrations/max/poller.ts';
import { createDelivery } from '../notifications/delivery.ts';
import { signalsMessage } from '../notifications/texts.ts';
import type { Messenger } from '../ports/messenger.ts';
import type { ModerationService } from '../services/moderation.ts';
import type { Job } from './scheduler.ts';

interface ModerationSignalsDependencies {
  moderation: Pick<ModerationService, 'signals'>;
  adminIds: readonly number[];
  messenger: () => Messenger | null;
  logger: MaxLogger;
}

export function moderationSignalsJob({
  moderation,
  adminIds,
  messenger,
  logger,
}: ModerationSignalsDependencies): Job {
  const deliver = createDelivery({ messenger, logger });
  return {
    name: 'moderation_signals',
    schedule: { dailyAt: '10:00', timeZone: 'Europe/Moscow' },
    async run() {
      if (messenger() === null) {
        logger.debug({ job: 'moderation_signals' }, 'moderation signals skipped: the bot is not running yet');
        return;
      }
      const signals = await moderation.signals();
      if (signals.length === 0) return;
      const message = signalsMessage(signals);
      for (const adminId of adminIds) await deliver(adminId, 'moderationSignals', () => message);
      logger.info({ venues: signals.length, admins: adminIds.length }, 'moderation signals sent');
    },
  };
}
