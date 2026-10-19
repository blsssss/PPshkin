import { maybeOne, one, type Queryable } from '../db/pool.ts';
import type { CompanyInvite } from '../domain/models.ts';
import type { Role } from '../domain/roles.ts';

interface InviteRow {
  id: number;
  company_id: number;
  venue_id: number | null;
  role: Role;
  created_by: number | null;
  created_by_name: string | null;
  expires_at: Date;
  accepted_by: number | null;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

const INVITE_COLUMNS = `i.id, i.company_id, i.venue_id, i.role, i.created_by, u.first_name as created_by_name,
  i.expires_at, i.accepted_by, i.accepted_at, i.revoked_at, i.created_at`;
const INVITE_FROM = 'company_invites i left join users u on u.id = i.created_by';

function mapInvite(row: InviteRow): CompanyInvite {
  return {
    id: row.id,
    companyId: row.company_id,
    venueId: row.venue_id,
    role: row.role,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    expiresAt: row.expires_at,
    acceptedBy: row.accepted_by,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export async function countActive(db: Queryable, companyId: number, now: Date): Promise<number> {
  const row = await one<{ count: number }>(
    db,
    `select count(*)::int as count from company_invites
      where company_id = $1 and accepted_at is null and revoked_at is null and expires_at > $2`,
    [companyId, now],
  );
  return row.count;
}

export async function insert(
  db: Queryable,
  entry: {
    companyId: number;
    venueId: number | null;
    role: Role;
    tokenHash: string;
    createdBy: number;
    expiresAt: Date;
  },
  now: Date,
): Promise<CompanyInvite> {
  const row = await one<{ id: number }>(
    db,
    `insert into company_invites (company_id, venue_id, role, token_hash, created_by, expires_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [entry.companyId, entry.venueId, entry.role, entry.tokenHash, entry.createdBy, entry.expiresAt, now],
  );
  const invite = await findById(db, row.id);
  if (!invite) throw new Error('the invite disappeared right after insert');
  return invite;
}

export async function findById(db: Queryable, id: number): Promise<CompanyInvite | null> {
  const row = await maybeOne<InviteRow>(db, `select ${INVITE_COLUMNS} from ${INVITE_FROM} where i.id = $1`, [
    id,
  ]);
  return row ? mapInvite(row) : null;
}

export async function findByTokenHash(
  db: Queryable,
  tokenHash: string,
  lock: boolean,
): Promise<CompanyInvite | null> {
  const row = await maybeOne<InviteRow>(
    db,
    `select ${INVITE_COLUMNS} from ${INVITE_FROM} where i.token_hash = $1${lock ? ' for update of i' : ''}`,
    [tokenHash],
  );
  return row ? mapInvite(row) : null;
}

export async function listActive(db: Queryable, companyId: number, now: Date): Promise<CompanyInvite[]> {
  const { rows } = await db.query<InviteRow>(
    `select ${INVITE_COLUMNS} from ${INVITE_FROM}
      where i.company_id = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > $2
      order by i.id desc`,
    [companyId, now],
  );
  return rows.map(mapInvite);
}

export async function markAccepted(db: Queryable, id: number, userId: number, now: Date): Promise<void> {
  await db.query('update company_invites set accepted_by = $2, accepted_at = $3 where id = $1', [
    id,
    userId,
    now,
  ]);
}

export async function revoke(db: Queryable, id: number, now: Date): Promise<void> {
  await db.query('update company_invites set revoked_at = $2 where id = $1', [id, now]);
}
