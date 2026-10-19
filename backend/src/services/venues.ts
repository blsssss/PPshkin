import { withTransaction, type Pool, type PoolClient } from '../db/pool.ts';
import type { GeoPoint, Venue } from '../domain/models.ts';
import type { VenueCategory } from '../domain/vocabulary.ts';
import * as companies from '../repositories/companies.ts';
import * as memberships from '../repositories/memberships.ts';
import * as users from '../repositories/users.ts';
import * as venues from '../repositories/venues.ts';
import type { Clock } from '../shared/clock.ts';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../shared/errors.ts';
import { isValidTimeZone } from '../shared/time.ts';
import { changedFields, type AuditChannel } from '../domain/audit.ts';
import * as audit from '../repositories/audit.ts';
import { listWorkplaces, resolveVenueAccess, type VenueActor } from './access.ts';
import { requireUnblockedUser } from './moderation.ts';

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

export interface VenueTarget {
  companyId?: number | undefined;
  newCompany?: boolean | undefined;
}

export interface VenuesService {
  get(actor: VenueActor): Promise<Venue>;
  create(userId: number, input: VenueInput, target?: VenueTarget): Promise<Venue>;
  update(actor: VenueActor, patch: VenuePatch, channel: AuditChannel): Promise<Venue>;
}

interface VenuesDependencies {
  pool: Pool;
  clock: Clock;
}

const DEFAULT_OPENS_AT = '08:00';
const DEFAULT_CLOSES_AT = '22:00';
const DEFAULT_TIMEZONE = 'Europe/Moscow';

function assertTimeZone(timezone: string | undefined): void {
  if (timezone !== undefined && !isValidTimeZone(timezone)) {
    throw unprocessable('invalid_timezone', `Unknown time zone ${timezone}`);
  }
}

async function targetCompany(
  client: PoolClient,
  userId: number,
  name: string,
  target: VenueTarget,
  now: Date,
): Promise<number> {
  const places = await listWorkplaces(client, userId);
  const memberOf = await memberships.listForUser(client, userId);
  const createNew = async () => {
    const company = await companies.insert(client, name, userId, null, now);
    await memberships.insert(
      client,
      { companyId: company.id, userId, role: 'owner', venueId: null, invitedBy: null },
      now,
    );
    return company.id;
  };
  if (target.companyId !== undefined) {
    const membership = memberOf.find((entry) => entry.companyId === target.companyId);
    if (!membership) throw notFound('company_not_found', 'Company not found');
    if (membership.role !== 'owner') {
      throw forbidden('venue_forbidden', 'Only a company owner can connect a venue');
    }
    return membership.companyId;
  }
  if (target.newCompany === true || (places.length === 0 && memberOf.length === 0)) return createNew();
  if (memberOf.length === 0) {
    throw conflict('venue_exists', 'You already have a demo venue, open it instead');
  }
  const owned = memberOf.filter((entry) => entry.role === 'owner');
  const [only, second] = owned;
  if (!only) throw forbidden('venue_forbidden', 'Only a company owner can connect a venue');
  if (second) throw badRequest('company_required', 'Pass companyId: you own several companies');
  return only.companyId;
}

export function createVenuesService({ pool, clock }: VenuesDependencies): VenuesService {
  return {
    async get(actor) {
      return (await resolveVenueAccess(pool, actor, 'venue.view')).venue;
    },

    async create(userId, input, target = {}) {
      assertTimeZone(input.timezone);
      await requireUnblockedUser(pool, userId);
      return withTransaction(pool, async (client) => {
        await users.lock(client, userId);
        const now = clock.now();
        const name = input.name.trim();
        const companyId = await targetCompany(client, userId, name, target, now);
        return venues.insert(
          client,
          companyId,
          {
            name,
            address: input.address.trim(),
            category: input.category,
            location: input.location,
            opensAt: input.opensAt ?? DEFAULT_OPENS_AT,
            closesAt: input.closesAt ?? DEFAULT_CLOSES_AT,
            timezone: input.timezone ?? DEFAULT_TIMEZONE,
          },
          now,
        );
      });
    },

    async update(actor, patch, channel) {
      const { venue } = await resolveVenueAccess(pool, actor, 'venue.edit');
      assertTimeZone(patch.timezone);
      return withTransaction(pool, async (client) => {
        const now = clock.now();
        const updated = await venues.update(
          client,
          venue.id,
          { ...patch, name: patch.name?.trim(), address: patch.address?.trim() },
          now,
        );
        await audit.record(
          client,
          {
            venueId: venue.id,
            actorUserId: actor.userId,
            action: 'venue.update',
            target: { type: 'venue', id: venue.id },
            channel,
            details: { fields: changedFields(patch) },
          },
          now,
        );
        return updated;
      });
    },
  };
}
