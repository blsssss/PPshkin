import { jsonb, maybeOne, one, type Queryable } from '../db/pool.ts';
import { STALE_IMPORT_ERROR, STALE_IMPORT_MS } from '../domain/menu-imports.ts';
import type { MenuImport, ParsedMenuItem } from '../domain/models.ts';
import { onlyKnownTags, type MenuImportStatus } from '../domain/vocabulary.ts';

interface MenuImportRow {
  id: number;
  venue_id: number;
  source: MenuImport['source'];
  status: MenuImportStatus;
  items: ParsedMenuItem[];
  error: string | null;
  model: string | null;
  created_at: Date;
  completed_at: Date | null;
}

const MENU_IMPORT_COLUMNS = 'id, venue_id, source, status, items, error, model, created_at, completed_at';

function mapMenuImport(row: MenuImportRow): MenuImport {
  return {
    id: row.id,
    venueId: row.venue_id,
    source: row.source,
    status: row.status,
    items: row.items.map((item) => ({ ...item, tags: onlyKnownTags(item.tags) })),
    error: row.error,
    model: row.model,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export interface ImportCounts {
  processing: number;
  started: number;
}

export interface ImportCountWindow {
  processingSince: Date;
  startedFrom: Date;
  startedTo: Date;
}

export interface ImportOutcome {
  status: 'ready' | 'failed';
  items: ParsedMenuItem[];
  error: string | null;
  model: string | null;
}

export async function insert(
  db: Queryable,
  venueId: number,
  source: MenuImport['source'],
  now: Date,
): Promise<MenuImport> {
  const row = await one<MenuImportRow>(
    db,
    `insert into menu_imports (venue_id, source, created_at) values ($1, $2, $3)
     returning ${MENU_IMPORT_COLUMNS}`,
    [venueId, source, now],
  );
  return mapMenuImport(row);
}

export async function countRecent(
  db: Queryable,
  venueId: number,
  window: ImportCountWindow,
): Promise<ImportCounts> {
  return one<ImportCounts>(
    db,
    `select count(*) filter (where status = 'processing' and created_at >= $2) as processing,
            count(*) filter (where created_at >= $3 and created_at < $4) as started
       from menu_imports
      where venue_id = $1 and created_at >= least($2::timestamptz, $3::timestamptz)`,
    [venueId, window.processingSince, window.startedFrom, window.startedTo],
  );
}

export async function complete(
  db: Queryable,
  id: number,
  outcome: ImportOutcome,
  now: Date,
  processingSince: Date,
): Promise<MenuImport | null> {
  const row = await maybeOne<MenuImportRow>(
    db,
    `update menu_imports
        set status = $2, items = $3::jsonb, error = $4, model = $5, completed_at = $6
      where id = $1 and status = 'processing' and created_at >= $7
      returning ${MENU_IMPORT_COLUMNS}`,
    [id, outcome.status, jsonb(outcome.items), outcome.error, outcome.model, now, processingSince],
  );
  return row ? mapMenuImport(row) : null;
}

export async function failStale(db: Queryable, now: Date): Promise<number> {
  const { rowCount } = await db.query(
    `update menu_imports
        set status = 'failed', error = $2, completed_at = created_at + make_interval(secs => $3)
      where status = 'processing' and created_at < $1`,
    [new Date(now.getTime() - STALE_IMPORT_MS), STALE_IMPORT_ERROR, STALE_IMPORT_MS / 1000],
  );
  return rowCount ?? 0;
}

export async function markApplied(db: Queryable, id: number): Promise<void> {
  await db.query(`update menu_imports set status = 'applied' where id = $1`, [id]);
}

export async function findInVenue(db: Queryable, venueId: number, id: number): Promise<MenuImport | null> {
  const row = await maybeOne<MenuImportRow>(
    db,
    `select ${MENU_IMPORT_COLUMNS} from menu_imports where venue_id = $1 and id = $2`,
    [venueId, id],
  );
  return row ? mapMenuImport(row) : null;
}

export async function lockInVenue(db: Queryable, venueId: number, id: number): Promise<MenuImport | null> {
  const row = await maybeOne<MenuImportRow>(
    db,
    `select ${MENU_IMPORT_COLUMNS} from menu_imports where venue_id = $1 and id = $2 for update`,
    [venueId, id],
  );
  return row ? mapMenuImport(row) : null;
}
