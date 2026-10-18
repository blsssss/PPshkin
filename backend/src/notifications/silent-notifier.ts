import type { Notifications } from '../ports/notifier.ts';

export const silentNotifications: Notifications = {
  enqueue: () => Promise.resolve(),
  flush: () => undefined,
};
