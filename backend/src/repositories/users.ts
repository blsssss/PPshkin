import { maybeOne, one, type Queryable } from '../db/pool.ts';
import type { GeoPoint, User } from '../domain/models.ts';
import { onlyKnownTags, type Goal, type Tag } from '../domain/vocabulary.ts';
import { coarsePoint } from '../shared/geo.ts';

interface UserRow {
  id: number;
  first_name: string | null;
  username: string | null;
  timezone: string;
  kcal_target: number;
  goal: Goal | null;
  disliked_tags: string[];
  location_lat: number | null;
  location_lon: number | null;
  location_updated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const USER_COLUMNS = `id, first_name, username, timezone, kcal_target, goal, disliked_tags,
  location_lat, location_lon, location_updated_at, created_at, updated_at`;

export function mapUser(row: UserRow): User {
  return {
    id: row.id,
    firstName: row.first_name,
    username: row.username,
    timezone: row.timezone,
    kcalTarget: row.kcal_target,
    goal: row.goal,
    dislikedTags: onlyKnownTags(row.disliked_tags),
    location:
      row.location_lat === null || row.location_lon === null
        ? null
        : { lat: row.location_lat, lon: row.location_lon },
    locationUpdatedAt: row.location_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UserIdentity {
  id: number;
  firstName: string | null;
  username: string | null;
}

export async function upsert(db: Queryable, identity: UserIdentity): Promise<User> {
  const row = await one<UserRow>(
    db,
    `insert into users (id, first_name, username)
     values ($1, $2, $3)
     on conflict (id) do update
       set first_name = coalesce(excluded.first_name, users.first_name),
           username = coalesce(excluded.username, users.username),
           updated_at = case
             when users.first_name is distinct from coalesce(excluded.first_name, users.first_name)
               or users.username is distinct from coalesce(excluded.username, users.username)
             then now()
             else users.updated_at
           end
     returning ${USER_COLUMNS}`,
    [identity.id, identity.firstName, identity.username],
  );
  return mapUser(row);
}

export async function lock(db: Queryable, id: number): Promise<boolean> {
  return (await maybeOne(db, 'select id from users where id = $1 for no key update', [id])) !== null;
}

export async function findById(db: Queryable, id: number): Promise<User | null> {
  const row = await maybeOne<UserRow>(db, `select ${USER_COLUMNS} from users where id = $1`, [id]);
  return row ? mapUser(row) : null;
}

export interface ProfileChanges {
  kcalTarget?: number;
  goal?: Goal | null;
  dislikedTags?: Tag[];
  timezone?: string;
}

const PROFILE_COLUMNS = {
  kcalTarget: 'kcal_target',
  goal: 'goal',
  dislikedTags: 'disliked_tags',
  timezone: 'timezone',
} as const satisfies Record<keyof ProfileChanges, string>;

export async function updateProfile(db: Queryable, id: number, patch: ProfileChanges): Promise<User | null> {
  const fields = (Object.keys(PROFILE_COLUMNS) as (keyof ProfileChanges)[]).filter(
    (field) => patch[field] !== undefined,
  );
  const assignments = fields.map((field, index) => `${PROFILE_COLUMNS[field]} = $${index + 2}`);
  const row = await maybeOne<UserRow>(
    db,
    `update users set ${[...assignments, 'updated_at = now()'].join(', ')}
      where id = $1
     returning ${USER_COLUMNS}`,
    [id, ...fields.map((field) => patch[field])],
  );
  return row ? mapUser(row) : null;
}

export async function setLocation(
  db: Queryable,
  id: number,
  point: GeoPoint,
  at: Date,
): Promise<User | null> {
  const { lat, lon } = coarsePoint(point);
  const row = await maybeOne<UserRow>(
    db,
    `update users
        set location_lat = $2, location_lon = $3, location_updated_at = $4, updated_at = now()
      where id = $1
     returning ${USER_COLUMNS}`,
    [id, lat, lon, at],
  );
  return row ? mapUser(row) : null;
}

export async function clearLocation(db: Queryable, id: number): Promise<void> {
  await db.query(
    `update users
        set location_lat = null, location_lon = null, location_updated_at = null, updated_at = now()
      where id = $1 and location_lat is not null`,
    [id],
  );
}

export async function remove(db: Queryable, id: number): Promise<void> {
  await db.query('delete from users where id = $1', [id]);
}
