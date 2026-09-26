import { jsonb, maybeOne, type Queryable } from '../db/pool.ts';

interface ChatStateRow {
  state: unknown;
}

export async function load(db: Queryable, userId: number): Promise<unknown> {
  const row = await maybeOne<ChatStateRow>(db, 'select state from chat_states where user_id = $1', [userId]);
  return row?.state ?? null;
}

export async function save(db: Queryable, userId: number, state: unknown): Promise<void> {
  await db.query(
    `insert into chat_states (user_id, state)
     values ($1, $2::jsonb)
     on conflict (user_id) do update set state = excluded.state, updated_at = now()`,
    [userId, jsonb(state)],
  );
}

export async function clear(db: Queryable, userId: number): Promise<void> {
  await db.query('delete from chat_states where user_id = $1', [userId]);
}
