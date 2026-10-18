import type { Queryable } from '../db/pool.ts';
import { BOOKING_REMINDER_LEAD_MS, BOOKING_REMINDER_MIN_HOLD_MS } from '../domain/notifications.ts';
import type { Notifications } from '../ports/notifier.ts';
import * as bookings from '../repositories/bookings.ts';
import * as venues from '../repositories/venues.ts';
import type { Job } from './scheduler.ts';

export function bookingRemindersJob(db: Queryable, notifications: Notifications): Job {
  return {
    name: 'booking_reminders',
    schedule: { everyMs: 60_000 },
    run: async (now) => {
      const due = await bookings.listActiveExpiringBetween(
        db,
        { from: now, to: new Date(now.getTime() + BOOKING_REMINDER_LEAD_MS) },
        BOOKING_REMINDER_MIN_HOLD_MS,
      );
      if (due.length === 0) return;
      const places = await venues.findByIds(db, [...new Set(due.map((booking) => booking.venueId))]);
      for (const booking of due) {
        const venue = places.find((place) => place.id === booking.venueId);
        if (venue) await notifications.enqueue(db, { kind: 'booking_reminder', booking, venue }, now);
      }
      notifications.flush();
    },
  };
}
