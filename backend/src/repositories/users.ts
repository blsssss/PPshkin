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
  acquisition?: { source: string; at: Date };
}

export async function upsert(db: Queryable, identity: UserIdentity): Promise<User> {
  const row = await one<UserRow>(
    db,
    `insert into users (id, first_name, username, acquisition, acquired_at)
     values ($1, $2, $3, $4, $5)
     on conflict (id) do update
       set first_name = coalesce(excluded.first_name, users.first_name),
           username = coalesce(excluded.username, users.username),
           acquisition = case
             when users.acquisition is null and excluded.acquisition <> 'organic' then excluded.acquisition
             else users.acquisition
           end,
           acquired_at = case
             when users.acquisition is null and excluded.acquisition <> 'organic' then excluded.acquired_at
             else users.acquired_at
           end,
           updated_at = case
             when users.first_name is distinct from coalesce(excluded.first_name, users.first_name)
               or users.username is distinct from coalesce(excluded.username, users.username)
             then now()
             else users.updated_at
           end
     returning ${USER_COLUMNS}`,
    [
      identity.id,
      identity.firstName,
      identity.username,
      identity.acquisition?.source ?? null,
      identity.acquisition?.at ?? null,
    ],
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

export async function sessionEpoch(db: Queryable, id: number): Promise<number | null> {
  const row = await maybeOne<{ session_epoch: number }>(db, 'select session_epoch from users where id = $1', [
    id,
  ]);
  return row ? row.session_epoch : null;
}

export async function revokeSessions(db: Queryable, id: number): Promise<boolean> {
  const result = await db.query('update users set session_epoch = session_epoch + 1 where id = $1', [id]);
  return result.rowCount === 1;
}

export async function revokeAllSessions(db: Queryable): Promise<number> {
  const result = await db.query('update users set session_epoch = session_epoch + 1');
  return result.rowCount ?? 0;
}

export async function remove(db: Queryable, id: number): Promise<void> {
  await db.query('delete from users where id = $1', [id]);
}

export async function touchLastSeen(db: Queryable, id: number, now: Date, throttleMs: number): Promise<void> {
  await db.query(
    `update users set last_seen_at = $2
      where id = $1 and (last_seen_at is null or last_seen_at <= $2::timestamptz - make_interval(secs => $3))`,
    [id, now, throttleMs / 1000],
  );
}

export async function lastActiveAt(db: Queryable, id: number): Promise<Date | null> {
  const row = await maybeOne<{ active_at: Date }>(
    db,
    'select coalesce(last_seen_at, created_at) as active_at from users where id = $1',
    [id],
  );
  return row?.active_at ?? null;
}

export interface InactiveUser {
  id: number;
  activeAt: Date;
}

export async function listInactiveToWarn(
  db: Queryable,
  activeBefore: Date,
  limit: number,
): Promise<InactiveUser[]> {
  const { rows } = await db.query<{ id: number; active_at: Date }>(
    `select u.id, coalesce(u.last_seen_at, u.created_at) as active_at
       from users u
      where u.id > 0 and coalesce(u.last_seen_at, u.created_at) < $1
        and not exists (
          select 1 from notifications n
           where n.user_id = u.id and n.kind = 'account_inactive_warning'
             and n.created_at >= coalesce(u.last_seen_at, u.created_at))
      order by u.id
      limit $2`,
    [activeBefore, limit],
  );
  return rows.map((row) => ({ id: row.id, activeAt: row.active_at }));
}

export async function listInactiveToDelete(
  db: Queryable,
  activeBefore: Date,
  warnedBefore: Date,
  limit: number,
): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `select u.id from users u
      where u.id > 0 and coalesce(u.last_seen_at, u.created_at) < $1
        and exists (
          select 1 from notifications n
           where n.user_id = u.id and n.kind = 'account_inactive_warning'
             and n.created_at >= coalesce(u.last_seen_at, u.created_at) and n.created_at <= $2)
      order by u.id
      limit $3`,
    [activeBefore, warnedBefore, limit],
  );
  return rows.map((row) => row.id);
}
