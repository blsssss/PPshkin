import { withTransaction, type Pool } from '../db/pool.ts';
import type { Notifications } from '../ports/notifier.ts';
import * as account from '../repositories/account.ts';
import * as companies from '../repositories/companies.ts';
import * as complaints from '../repositories/complaints.ts';
import * as bookings from '../repositories/bookings.ts';
import * as users from '../repositories/users.ts';
import * as venues from '../repositories/venues.ts';
import type { Clock } from '../shared/clock.ts';
import { forbidden } from '../shared/errors.ts';

export interface AccountService {
  deleteAccount(userId: number): Promise<void>;
  soleOwnerships(userId: number): Promise<{ id: number; name: string }[]>;
}

export interface AccountDependencies {
  pool: Pool;
  clock: Clock;
  notifications: Notifications;
}

const isDemoAccount = (userId: number) => userId < 0;

export function createAccountService({ pool, clock, notifications }: AccountDependencies): AccountService {
  return {
    soleOwnerships: (userId) => companies.soleOwnerCompanies(pool, userId),

    async deleteAccount(userId) {
      if (isDemoAccount(userId)) {
        throw forbidden('demo_account_protected', 'Demo accounts are shared and cannot be deleted');
      }
      const now = clock.now();
      const cancelled = await withTransaction(pool, async (client) => {
        await users.lock(client, userId);
        const released = await bookings.cancelActiveForUser(client, userId, now);
        const places = await venues.findByIds(client, [
          ...new Set(released.map((booking) => booking.venueId)),
        ]);
        for (const booking of released) {
          const venue = places.find((place) => place.id === booking.venueId);
          if (venue)
            await notifications.enqueue(client, { kind: 'venue_booking_cancelled', booking, venue }, now);
        }
        await complaints.eraseForReporter(client, userId);
        await account.eraseOfferExplanations(client, userId);
        await account.removeDemoVenueCopies(client, userId);
        await users.remove(client, userId);
        return released;
      });
      if (cancelled.length > 0) notifications.flush();
    },
  };
}
