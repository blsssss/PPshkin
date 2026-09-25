import { maybeOne, one, type Queryable } from '../db/pool.ts';
import type { User } from '../domain/models.ts';
import { onlyKnownTags, type Goal } from '../domain/vocabulary.ts';

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

export async function findById(db: Queryable, id: number): Promise<User | null> {
  const row = await maybeOne<UserRow>(db, `select ${USER_COLUMNS} from users where id = $1`, [id]);
  return row ? mapUser(row) : null;
}
