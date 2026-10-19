import { maybeOne, one, type Queryable } from '../db/pool.ts';
import type { Company, CompanyKind, RegistryStatus } from '../domain/models.ts';

interface CompanyRow {
  id: number;
  kind: CompanyKind | null;
  inn: string | null;
  ogrn: string | null;
  kpp: string | null;
  name: string;
  address: string | null;
  okved: string | null;
  registry_status: RegistryStatus | null;
  registry_checked_at: Date | null;
  verification: Company['verification'];
  verification_note: string | null;
  verified_at: Date | null;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
}

const COMPANY_COLUMNS = `id, kind, inn, ogrn, kpp, name, address, okved, registry_status, registry_checked_at,
  verification, verification_note, verified_at, created_by, created_at, updated_at`;

function mapCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    kind: row.kind,
    inn: row.inn,
    ogrn: row.ogrn,
    kpp: row.kpp,
    name: row.name,
    address: row.address,
    okved: row.okved,
    registryStatus: row.registry_status,
    registryCheckedAt: row.registry_checked_at,
    verification: row.verification,
    verificationNote: row.verification_note,
    verifiedAt: row.verified_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface Requisites {
  kind: CompanyKind;
  inn: string;
  ogrn: string | null;
  kpp: string | null;
  name: string;
  address: string | null;
  okved: string | null;
  registryStatus: RegistryStatus | null;
  registryCheckedAt: Date | null;
}

export async function insert(
  db: Queryable,
  name: string,
  createdBy: number,
  requisites: Requisites | null,
  now: Date,
): Promise<Company> {
  const row = await one<CompanyRow>(
    db,
    `insert into companies (name, created_by, kind, inn, ogrn, kpp, address, okved, registry_status,
                            registry_checked_at, verification, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
     returning ${COMPANY_COLUMNS}`,
    [
      requisites?.name ?? name,
      createdBy,
      requisites?.kind ?? null,
      requisites?.inn ?? null,
      requisites?.ogrn ?? null,
      requisites?.kpp ?? null,
      requisites?.address ?? null,
      requisites?.okved ?? null,
      requisites?.registryStatus ?? null,
      requisites?.registryCheckedAt ?? null,
      requisites ? 'pending' : 'unverified',
      now,
    ],
  );
  return mapCompany(row);
}

export async function findById(db: Queryable, id: number): Promise<Company | null> {
  const row = await maybeOne<CompanyRow>(db, `select ${COMPANY_COLUMNS} from companies where id = $1`, [id]);
  return row ? mapCompany(row) : null;
}

export async function lockById(db: Queryable, id: number): Promise<Company | null> {
  const row = await maybeOne<CompanyRow>(
    db,
    `select ${COMPANY_COLUMNS} from companies where id = $1 for update`,
    [id],
  );
  return row ? mapCompany(row) : null;
}

export async function findByInn(db: Queryable, inn: string): Promise<Company | null> {
  const row = await maybeOne<CompanyRow>(db, `select ${COMPANY_COLUMNS} from companies where inn = $1`, [
    inn,
  ]);
  return row ? mapCompany(row) : null;
}

export async function applyRequisites(
  db: Queryable,
  id: number,
  requisites: Requisites,
  now: Date,
): Promise<Company> {
  const row = await one<CompanyRow>(
    db,
    `update companies
        set kind = $2, inn = $3, ogrn = $4, kpp = $5, name = $6, address = $7, okved = $8,
            registry_status = $9, registry_checked_at = $10, verification = 'pending',
            verification_note = null, verified_at = null, updated_at = $11
      where id = $1
      returning ${COMPANY_COLUMNS}`,
    [
      id,
      requisites.kind,
      requisites.inn,
      requisites.ogrn,
      requisites.kpp,
      requisites.name,
      requisites.address,
      requisites.okved,
      requisites.registryStatus,
      requisites.registryCheckedAt,
      now,
    ],
  );
  return mapCompany(row);
}

export async function listVenues(db: Queryable, companyId: number): Promise<{ id: number; name: string }[]> {
  const { rows } = await db.query<{ id: number; name: string }>(
    'select id, name from venues where company_id = $1 order by id',
    [companyId],
  );
  return rows;
}

export async function soleOwnerCompanies(
  db: Queryable,
  userId: number,
): Promise<{ id: number; name: string }[]> {
  const { rows } = await db.query<{ id: number; name: string }>(
    `select c.id, c.name
       from memberships m
       join companies c on c.id = m.company_id
      where m.user_id = $1 and m.role = 'owner'
        and exists (select 1 from venues v where v.company_id = c.id)
        and not exists (
          select 1 from memberships o where o.company_id = c.id and o.role = 'owner' and o.user_id <> $1
        )
      order by c.id`,
    [userId],
  );
  return rows;
}
