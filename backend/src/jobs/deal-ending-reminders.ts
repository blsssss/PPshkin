import type { Queryable } from '../db/pool.ts';
import { DEAL_ENDING_MIN_AGE_MS, needsDealEndingReminder } from '../domain/notifications.ts';
import type { Notifications } from '../ports/notifier.ts';
import * as deals from '../repositories/deals.ts';
import * as venues from '../repositories/venues.ts';
import type { Job } from './scheduler.ts';

export function dealEndingRemindersJob(db: Queryable, notifications: Notifications): Job {
  return {
    name: 'deal_ending_reminders',
    schedule: { everyMs: 5 * 60_000 },
    run: async (now) => {
      const candidates = await deals.listEndingCandidates(
        db,
        new Date(now.getTime() - DEAL_ENDING_MIN_AGE_MS),
        now,
      );
      if (candidates.length === 0) return;
      const places = await venues.findByIds(db, [...new Set(candidates.map((deal) => deal.venueId))]);
      let queued = false;
      for (const deal of candidates) {
        const venue = places.find((place) => place.id === deal.venueId);
        if (!venue || !needsDealEndingReminder(deal, venue, now)) continue;
        await notifications.enqueue(db, { kind: 'venue_deal_ending', deal, venue }, now);
        queued = true;
      }
      if (queued) notifications.flush();
    },
  };
}
