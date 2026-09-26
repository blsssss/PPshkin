import type { Queryable } from '../db/pool.ts';
import type { Candidate } from '../domain/intent/types.ts';
import type { Deal } from '../domain/models.ts';
import * as deals from './deals.ts';
import * as menuItems from './menu-items.ts';
import * as venues from './venues.ts';

function soonestEndingByItem(live: readonly Deal[]): Map<number, Deal> {
  const byItem = new Map<number, Deal>();
  for (const deal of live) {
    const current = byItem.get(deal.menuItemId);
    if (!current || deal.endsAt.getTime() < current.endsAt.getTime()) byItem.set(deal.menuItemId, deal);
  }
  return byItem;
}

export async function loadCandidates(
  db: Queryable,
  viewerId: number,
  area: venues.GeoBox | null,
  now: Date,
): Promise<Candidate[]> {
  const found = area
    ? await venues.listVisibleWithin(db, area, viewerId)
    : await venues.listVisible(db, viewerId);
  const venueIds = found.map((venue) => venue.id);
  const items = await menuItems.listAvailableInVenues(db, venueIds);
  const dealByItem = soonestEndingByItem(await deals.listVisible(db, venueIds, now));
  const venueById = new Map(found.map((venue) => [venue.id, venue]));
  return items.flatMap((item) => {
    const venue = venueById.get(item.venueId);
    return venue ? [{ item, venue, deal: dealByItem.get(item.id) ?? null }] : [];
  });
}
