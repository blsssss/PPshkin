import { maybeOne, one, type Queryable } from '../db/pool.ts';
import type { Membership, Venue } from '../domain/models.ts';
import { rolesWith, type Permission, type Role } from '../domain/roles.ts';
import type { CompanyVerification } from '../domain/models.ts';
import { mapVenue, VENUE_COLUMNS, type VenueRow } from './venues.ts';

interface MembershipRow {
  id: number;
  company_id: number;
  user_id: number;
  role: Role;
  venue_id: number | null;
  invited_by: number | null;
  created_at: Date;
  updated_at: Date;
}

const MEMBERSHIP_COLUMNS = 'id, company_id, user_id, role, venue_id, invited_by, created_at, updated_at';

function mapMembership(row: MembershipRow): Membership {
  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    role: row.role,
    venueId: row.venue_id,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface WorkplaceRecord {
  venue: Venue;
  role: Role;
  venueScoped: boolean;
  company: { id: number; name: string; verification: CompanyVerification } | null;
}

interface WorkplaceRow extends VenueRow {
  member_role: Role;
  venue_scoped: boolean;
  company_name: string | null;
  company_verification: CompanyVerification | null;
}

const PREFIXED_VENUE_COLUMNS = VENUE_COLUMNS.split(',')
  .map((column) => `v.${column.trim()}`)
  .join(', ');

export async function listWorkplaces(db: Queryable, userId: number): Promise<WorkplaceRecord[]> {
  const { rows } = await db.query<WorkplaceRow>(
    `select ${PREFIXED_VENUE_COLUMNS}, m.role as member_role, m.venue_id is not null as venue_scoped,
            c.name as company_name, c.verification as company_verification
       from memberships m
       join companies c on c.id = m.company_id
       join venues v on v.company_id = c.id and (m.venue_id is null or m.venue_id = v.id)
      where m.user_id = $1
     union all
     select ${PREFIXED_VENUE_COLUMNS}, 'owner' as member_role, false as venue_scoped,
            null as company_name, null as company_verification
       from venues v
      where v.owner_id = $1 and v.company_id is null
      order by id`,
    [userId],
  );
  return rows.map((row) => ({
    venue: mapVenue(row),
    role: row.member_role,
    venueScoped: row.venue_scoped,
    company:
      row.company_id === null || row.company_name === null || row.company_verification === null
        ? null
        : { id: row.company_id, name: row.company_name, verification: row.company_verification },
  }));
}

export async function find(db: Queryable, companyId: number, userId: number): Promise<Membership | null> {
  const row = await maybeOne<MembershipRow>(
    db,
    `select ${MEMBERSHIP_COLUMNS} from memberships where company_id = $1 and user_id = $2`,
    [companyId, userId],
  );
  return row ? mapMembership(row) : null;
}

export async function lockCompanyMembers(db: Queryable, companyId: number): Promise<Membership[]> {
  const { rows } = await db.query<MembershipRow>(
    `select ${MEMBERSHIP_COLUMNS} from memberships where company_id = $1 order by id for update`,
    [companyId],
  );
  return rows.map(mapMembership);
}

export async function listForUser(db: Queryable, userId: number): Promise<Membership[]> {
  const { rows } = await db.query<MembershipRow>(
    `select ${MEMBERSHIP_COLUMNS} from memberships where user_id = $1 order by company_id`,
    [userId],
  );
  return rows.map(mapMembership);
}

export interface MemberRecord extends Membership {
  firstName: string | null;
}

export async function listMembers(db: Queryable, companyId: number): Promise<MemberRecord[]> {
  const { rows } = await db.query<MembershipRow & { first_name: string | null }>(
    `select m.id, m.company_id, m.user_id, m.role, m.venue_id, m.invited_by, m.created_at, m.updated_at,
            u.first_name
       from memberships m
       join users u on u.id = m.user_id
      where m.company_id = $1
      order by m.id`,
    [companyId],
  );
  return rows.map((row) => ({ ...mapMembership(row), firstName: row.first_name }));
}

export async function insert(
  db: Queryable,
  entry: { companyId: number; userId: number; role: Role; venueId: number | null; invitedBy: number | null },
  now: Date,
): Promise<Membership> {
  const row = await one<MembershipRow>(
    db,
    `insert into memberships (company_id, user_id, role, venue_id, invited_by, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $6)
     returning ${MEMBERSHIP_COLUMNS}`,
    [entry.companyId, entry.userId, entry.role, entry.venueId, entry.invitedBy, now],
  );
  return mapMembership(row);
}

export async function update(
  db: Queryable,
  id: number,
  changes: { role: Role; venueId: number | null },
  now: Date,
): Promise<Membership> {
  const row = await one<MembershipRow>(
    db,
    `update memberships set role = $2, venue_id = $3, updated_at = $4 where id = $1
     returning ${MEMBERSHIP_COLUMNS}`,
    [id, changes.role, changes.venueId, now],
  );
  return mapMembership(row);
}

export async function remove(db: Queryable, id: number): Promise<void> {
  await db.query('delete from memberships where id = $1', [id]);
}

export async function recipients(
  db: Queryable,
  venue: { id: number; companyId: number },
  permission: Permission,
): Promise<number[]> {
  const { rows } = await db.query<{ user_id: number }>(
    `select distinct user_id from memberships
      where company_id = $1 and role = any($2::text[]) and (venue_id is null or venue_id = $3)
      order by user_id`,
    [venue.companyId, rolesWith(permission), venue.id],
  );
  return rows.map((row) => row.user_id);
}
