import type { Pool, Queryable } from '../db/pool.ts';
import type { GeoPoint, Venue } from '../domain/models.ts';
import type { VenueCategory } from '../domain/vocabulary.ts';
import * as venues from '../repositories/venues.ts';
import type { Clock } from '../shared/clock.ts';
import { conflict, notFound, unprocessable } from '../shared/errors.ts';
import { isValidTimeZone } from '../shared/time.ts';

export interface VenueInput {
  name: string;
  address: string;
  category: VenueCategory;
  location: GeoPoint;
  opensAt?: string;
  closesAt?: string;
  timezone?: string;
}

export type VenuePatch = Partial<VenueInput>;

export interface VenuesService {
  get(ownerId: number): Promise<Venue>;
  create(ownerId: number, input: VenueInput): Promise<Venue>;
  update(ownerId: number, patch: VenuePatch): Promise<Venue>;
}

interface VenuesDependencies {
  pool: Pool;
  clock: Clock;
}

const DEFAULT_OPENS_AT = '08:00';
const DEFAULT_CLOSES_AT = '22:00';
const DEFAULT_TIMEZONE = 'Europe/Moscow';

export function venueNotFound() {
  return notFound('venue_not_found', 'You have no venue yet, create one first');
}

export async function requireOwnedVenue(db: Queryable, ownerId: number): Promise<Venue> {
  const venue = await venues.findByOwner(db, ownerId);
  if (!venue) throw venueNotFound();
  return venue;
}

function assertTimeZone(timezone: string | undefined): void {
  if (timezone !== undefined && !isValidTimeZone(timezone)) {
    throw unprocessable('invalid_timezone', `Unknown time zone ${timezone}`);
  }
}

export function createVenuesService({ pool, clock }: VenuesDependencies): VenuesService {
  return {
    get: (ownerId) => requireOwnedVenue(pool, ownerId),

    async create(ownerId, input) {
      assertTimeZone(input.timezone);
      const venue = await venues.insert(
        pool,
        ownerId,
        {
          name: input.name.trim(),
          address: input.address.trim(),
          category: input.category,
          location: input.location,
          opensAt: input.opensAt ?? DEFAULT_OPENS_AT,
          closesAt: input.closesAt ?? DEFAULT_CLOSES_AT,
          timezone: input.timezone ?? DEFAULT_TIMEZONE,
        },
        clock.now(),
      );
      if (!venue) throw conflict('venue_exists', 'You already have a venue, edit it instead');
      return venue;
    },

    async update(ownerId, patch) {
      const venue = await requireOwnedVenue(pool, ownerId);
      assertTimeZone(patch.timezone);
      return venues.update(
        pool,
        venue.id,
        { ...patch, name: patch.name?.trim(), address: patch.address?.trim() },
        clock.now(),
      );
    },
  };
}
