import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool } from './pool.ts';

export interface Migration {
  version: string;
  sql: string;
  checksum: string;
}

export class MigrationChecksumError extends Error {
  readonly version: string;

  constructor(version: string) {
    super(`Migration ${version} was changed after it had been applied`);
    this.name = 'MigrationChecksumError';
    this.version = version;
  }
}

const MIGRATION_FILE = /^(\d{4}_[a-z0-9_]+)\.sql$/;
const ADVISORY_LOCK_ID = 727_274_001;

export const defaultMigrationsDir = new URL('../../migrations/', import.meta.url);

export function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export async function loadMigrations(dir: URL | string = defaultMigrationsDir): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((file) => MIGRATION_FILE.test(file)).sort();
  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(new URL(file, dir), 'utf8');
      const version = file.replace(/\.sql$/, '');
      return { version, sql, checksum: checksum(sql) };
    }),
  );
}

export async function migrate(pool: Pool, migrations: Migration[]): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);
    await client.query(
      `create table if not exists schema_migrations (
        version text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )`,
    );
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'select version, checksum from schema_migrations',
    );
    const known = new Map(rows.map((row) => [row.version, row.checksum]));
    for (const migration of migrations) {
      const existing = known.get(migration.version);
      if (existing !== undefined) {
        if (existing !== migration.checksum) {
          throw new MigrationChecksumError(migration.version);
        }
        continue;
      }
      try {
        await client.query('begin');
        await client.query(migration.sql);
        await client.query('insert into schema_migrations (version, checksum) values ($1, $2)', [
          migration.version,
          migration.checksum,
        ]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
      applied.push(migration.version);
    }
    return applied;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
