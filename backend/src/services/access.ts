import type { PoolClient, Queryable } from '../db/pool.ts';
import type { CompanyVerification, Venue } from '../domain/models.ts';
import { can, ROLE_PERMISSIONS, type Permission, type Role } from '../domain/roles.ts';
import * as memberships from '../repositories/memberships.ts';
import * as venues from '../repositories/venues.ts';
import { badRequest, forbidden, notFound } from '../shared/errors.ts';

export interface VenueActor {
  userId: number;
  venueId?: number | undefined;
}

export interface VenueAccess {
  venue: Venue;
  role: Role;
  companyId: number | null;
  permissions: readonly Permission[];
}

export interface Workplace {
  venue: Venue;
  company: { id: number; name: string; verification: CompanyVerification } | null;
  role: Role;
  permissions: readonly Permission[];
  venueScoped: boolean;
}

export function venueNotFound() {
  return notFound('venue_not_found', 'You have no venue yet, create one first');
}

export async function listWorkplaces(db: Queryable, userId: number): Promise<Workplace[]> {
  const records = await memberships.listWorkplaces(db, userId);
  return records.map((record) => ({ ...record, permissions: ROLE_PERMISSIONS[record.role] }));
}

function pick(places: readonly Workplace[], venueId: number | undefined): Workplace {
  if (venueId !== undefined) {
    const found = places.find((place) => place.venue.id === venueId);
    if (!found) throw venueNotFound();
    return found;
  }
  const [first, second] = places;
  if (!first) throw venueNotFound();
  if (second) throw badRequest('venue_required', 'Pass venueId: you work with several venues');
  return first;
}

export async function resolveVenueAccess(
  db: Queryable,
  actor: VenueActor,
  permission: Permission,
): Promise<VenueAccess> {
  const place = pick(await listWorkplaces(db, actor.userId), actor.venueId);
  if (!can(place.role, permission)) {
    throw forbidden('venue_forbidden', 'Your role does not allow this action');
  }
  return {
    venue: place.venue,
    role: place.role,
    companyId: place.company?.id ?? null,
    permissions: place.permissions,
  };
}

export async function lockVenueAccess(
  client: PoolClient,
  actor: VenueActor,
  permission: Permission,
): Promise<VenueAccess> {
  const access = await resolveVenueAccess(client, actor, permission);
  const venue = await venues.lockById(client, access.venue.id);
  if (!venue) throw venueNotFound();
  return { ...access, venue };
}
