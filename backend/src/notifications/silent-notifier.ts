import type { Notifier } from '../ports/notifier.ts';

export const silentNotifier: Notifier = {
  bookingCreated: () => Promise.resolve(),
  bookingCancelled: () => Promise.resolve(),
  bookingRedeemed: () => Promise.resolve(),
  bookingExpired: () => Promise.resolve(),
};
