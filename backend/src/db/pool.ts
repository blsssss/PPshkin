import pg from 'pg';

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`int8 value ${value} exceeds the safe integer range`);
  }
  return parsed;
});

export interface Queryable {
  query<Row extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<Row>>;
}

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(connectionString: string, max = 10): Pool {
  return new pg.Pool({ connectionString, max, application_name: 'ppshkin' });
}

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function one<Row extends pg.QueryResultRow>(
  db: Queryable,
  text: string,
  values?: unknown[],
): Promise<Row> {
  const result = await db.query<Row>(text, values);
  const [row] = result.rows;
  if (!row) {
    throw new Error('Expected exactly one row, got none');
  }
  return row;
}

export async function maybeOne<Row extends pg.QueryResultRow>(
  db: Queryable,
  text: string,
  values?: unknown[],
): Promise<Row | null> {
  const result = await db.query<Row>(text, values);
  return result.rows[0] ?? null;
}
