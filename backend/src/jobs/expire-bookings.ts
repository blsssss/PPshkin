import type { BookingsService } from '../services/bookings.ts';
import type { Job } from './scheduler.ts';

export function expireBookingsJob(bookings: Pick<BookingsService, 'expireDue'>): Job {
  return {
    name: 'expire_bookings',
    schedule: { everyMs: 60_000 },
    run: async () => {
      await bookings.expireDue({});
    },
  };
}
