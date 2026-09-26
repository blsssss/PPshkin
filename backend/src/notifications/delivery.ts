import { UserUnreachableError } from '../integrations/max/errors.ts';
import type { MaxLogger } from '../integrations/max/poller.ts';
import type { Messenger, OutgoingMessage } from '../ports/messenger.ts';

type DeliveryResult = 'sent' | 'skipped' | 'failed';

interface DeliveryDependencies {
  messenger: () => Messenger | null;
  logger: MaxLogger;
}

export type Deliver = (
  recipient: number | null,
  event: string,
  compose: (userId: number) => OutgoingMessage | Promise<OutgoingMessage>,
) => Promise<DeliveryResult>;

export function createDelivery({ messenger, logger }: DeliveryDependencies): Deliver {
  return async (recipient, event, compose) => {
    if (recipient === null || recipient <= 0) {
      logger.debug({ userId: recipient, event }, 'notification skipped: the recipient is not a MAX user');
      return 'skipped';
    }
    try {
      const current = messenger();
      if (!current) {
        logger.debug({ userId: recipient, event }, 'notification skipped: the bot is not running yet');
        return 'skipped';
      }
      await current.sendToUser(recipient, await compose(recipient));
      return 'sent';
    } catch (error) {
      if (error instanceof UserUnreachableError) {
        logger.warn(
          { userId: recipient, event },
          'notification not delivered: the user blocked the bot or never started it',
        );
      } else {
        logger.error({ err: error, userId: recipient, event }, 'notification failed');
      }
      return 'failed';
    }
  };
}
