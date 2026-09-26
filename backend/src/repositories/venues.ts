import { maybeOne, one, type Queryable } from '../db/pool.ts';
import type { GeoPoint, Venue } from '../domain/models.ts';
import type { VenueCategory } from '../domain/vocabulary.ts';

interface VenueRow {
  id: number;
  owner_id: number | null;
  name: string;
  address: string;
  category: VenueCategory;
  lat: number;
  lon: number;
  opens_at: string;
  closes_at: string;
  timezone: string;
  is_demo: boolean;
  created_at: Date;
  updated_at: Date;
}

const VENUE_COLUMNS = `id, owner_id, name, address, category, lat, lon, opens_at, closes_at, timezone, is_demo,
  created_at, updated_at`;

function mapVenue(row: VenueRow): Venue {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    address: row.address,
    category: row.category,
    location: { lat: row.lat, lon: row.lon },
    opensAt: row.opens_at.slice(0, 5),
    closesAt: row.closes_at.slice(0, 5),
    timezone: row.timezone,
    isDemo: row.is_demo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface VenueFields {
  name: string;
  address: string;
  category: VenueCategory;
  location: GeoPoint;
  opensAt: string;
  closesAt: string;
  timezone: string;
}

export type VenueChanges = Partial<VenueFields>;

export interface GeoBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export async function insert(
  db: Queryable,
  ownerId: number,
  fields: VenueFields,
  now: Date,
): Promise<Venue | null> {
  const row = await maybeOne<VenueRow>(
    db,
    `insert into venues (owner_id, name, address, category, lat, lon, opens_at, closes_at, timezone,
                         created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     on conflict (owner_id) where owner_id is not null do nothing
     returning ${VENUE_COLUMNS}`,
    [
      ownerId,
      fields.name,
      fields.address,
      fields.category,
      fields.location.lat,
      fields.location.lon,
      fields.opensAt,
      fields.closesAt,
      fields.timezone,
      now,
    ],
  );
  return row ? mapVenue(row) : null;
}

export async function update(db: Queryable, id: number, changes: VenueChanges, now: Date): Promise<Venue> {
  const row = await one<VenueRow>(
    db,
    `update venues
        set name = coalesce($2, name),
            address = coalesce($3, address),
            category = coalesce($4, category),
            lat = coalesce($5, lat),
            lon = coalesce($6, lon),
            opens_at = coalesce($7::time, opens_at),
            closes_at = coalesce($8::time, closes_at),
            timezone = coalesce($9, timezone),
            updated_at = $10
      where id = $1
      returning ${VENUE_COLUMNS}`,
    [
      id,
      changes.name ?? null,
      changes.address ?? null,
      changes.category ?? null,
      changes.location?.lat ?? null,
      changes.location?.lon ?? null,
      changes.opensAt ?? null,
      changes.closesAt ?? null,
      changes.timezone ?? null,
      now,
    ],
  );
  return mapVenue(row);
}

export async function findByOwner(db: Queryable, ownerId: number): Promise<Venue | null> {
  const row = await maybeOne<VenueRow>(db, `select ${VENUE_COLUMNS} from venues where owner_id = $1`, [
    ownerId,
  ]);
  return row ? mapVenue(row) : null;
}

export async function lockByOwner(db: Queryable, ownerId: number): Promise<Venue | null> {
  const row = await maybeOne<VenueRow>(
    db,
    `select ${VENUE_COLUMNS} from venues where owner_id = $1 for update`,
    [ownerId],
  );
  return row ? mapVenue(row) : null;
}

export async function findByIds(db: Queryable, ids: readonly number[]): Promise<Venue[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<VenueRow>(
    `select ${VENUE_COLUMNS} from venues where id = any($1::bigint[]) order by id`,
    [ids],
  );
  return rows.map(mapVenue);
}

export function visibleVenueCondition(alias: string, viewerParam: string): string {
  return `case
      when ${alias}.demo_source_id is not null or (${alias}.is_demo and ${alias}.owner_id > 0)
        then coalesce(${alias}.owner_id = ${viewerParam}, false)
      when ${alias}.is_demo then not exists (
        select 1 from venues demo_copy
         where demo_copy.demo_source_id = ${alias}.id and demo_copy.owner_id = ${viewerParam}
      )
      else true
    end`;
}

export async function findVisible(db: Queryable, id: number, viewerId: number): Promise<Venue | null> {
  const row = await maybeOne<VenueRow>(
    db,
    `select ${VENUE_COLUMNS} from venues v where v.id = $1 and ${visibleVenueCondition('v', '$2')}`,
    [id, viewerId],
  );
  return row ? mapVenue(row) : null;
}

export async function listVisible(db: Queryable, viewerId: number): Promise<Venue[]> {
  const { rows } = await db.query<VenueRow>(
    `select ${VENUE_COLUMNS} from venues v where ${visibleVenueCondition('v', '$1')} order by v.id`,
    [viewerId],
  );
  return rows.map(mapVenue);
}

export async function listVisibleWithin(db: Queryable, box: GeoBox, viewerId: number): Promise<Venue[]> {
  const { rows } = await db.query<VenueRow>(
    `select ${VENUE_COLUMNS} from venues v
      where v.lat between $1 and $2 and v.lon between $3 and $4 and ${visibleVenueCondition('v', '$5')}
      order by v.id`,
    [box.minLat, box.maxLat, box.minLon, box.maxLon, viewerId],
  );
  return rows.map(mapVenue);
}

export async function findSeededDemo(db: Queryable, id: number): Promise<Venue | null> {
  const row = await maybeOne<VenueRow>(
    db,
    `select ${VENUE_COLUMNS} from venues
      where id = $1 and is_demo and demo_source_id is null and (owner_id is null or owner_id < 0)`,
    [id],
  );
  return row ? mapVenue(row) : null;
}

export async function insertDemoCopy(
  db: Queryable,
  sourceId: number,
  ownerId: number,
  now: Date,
): Promise<Venue | null> {
  const row = await maybeOne<VenueRow>(
    db,
    `insert into venues (owner_id, name, address, category, lat, lon, opens_at, closes_at, timezone, is_demo,
                         demo_source_id, created_at, updated_at)
     select $2, name, address, category, lat, lon, opens_at, closes_at, timezone, true, id, $3, $3
       from venues
      where id = $1
     on conflict (owner_id) where owner_id is not null do nothing
     returning ${VENUE_COLUMNS}`,
    [sourceId, ownerId, now],
  );
  return row ? mapVenue(row) : null;
}
