import type { MaxLogger } from '../integrations/max/poller.ts';
import type { Messenger } from '../ports/messenger.ts';
import type { Notifier } from '../ports/notifier.ts';
import type { DiaryDay } from '../services/diary.ts';
import { createDelivery, type Deliver } from './delivery.ts';
import {
  bookingCancelledMessage,
  bookingCreatedMessage,
  bookingExpiredMessage,
  bookingRedeemedMessage,
} from './texts.ts';

interface MessengerNotifierDependencies {
  messenger: () => Messenger | null;
  diaryDay: (userId: number) => Promise<DiaryDay>;
  logger: MaxLogger;
}

export function createMessengerNotifier({
  messenger,
  diaryDay,
  logger,
}: MessengerNotifierDependencies): Notifier {
  const deliver = createDelivery({ messenger, logger });

  const send = async (...args: Parameters<Deliver>): Promise<void> => {
    await deliver(...args);
  };

  async function daySummary(userId: number): Promise<DiaryDay | null> {
    try {
      return await diaryDay(userId);
    } catch (error) {
      logger.warn({ err: error, userId }, 'day summary is unavailable, the redeem notice goes without it');
      return null;
    }
  }

  return {
    bookingCreated: (notice) =>
      send(notice.venue.ownerId, 'bookingCreated', () => bookingCreatedMessage(notice)),
    bookingCancelled: (notice) =>
      send(notice.venue.ownerId, 'bookingCancelled', () => bookingCancelledMessage(notice)),
    bookingRedeemed: (notice) =>
      send(notice.booking.userId, 'bookingRedeemed', async (userId) =>
        bookingRedeemedMessage(notice, await daySummary(userId)),
      ),
    bookingExpired: (notice) =>
      send(notice.booking.userId, 'bookingExpired', () => bookingExpiredMessage(notice)),
  };
}
