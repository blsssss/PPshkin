import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, testPool } from '../../test/database.ts';
import { checksum, loadMigrations, migrate, MigrationError, type Migration } from './migrate.ts';

const SCHEMA = 'migrate_spec';
const isolated = new pg.Pool({
  connectionString: TEST_DATABASE_URL,
  max: 4,
  options: `-c search_path=${SCHEMA}`,
});

const migration = (version: string, sql: string): Migration => ({ version, sql, checksum: checksum(sql) });

async function tables(): Promise<string[]> {
  const { rows } = await isolated.query<{ tablename: string }>(
    'select tablename from pg_tables where schemaname = $1 order by tablename',
    [SCHEMA],
  );
  return rows.map((row) => row.tablename);
}

beforeEach(async () => {
  await testPool().query(`drop schema if exists ${SCHEMA} cascade`);
  await testPool().query(`create schema ${SCHEMA}`);
});

afterAll(async () => {
  await testPool().query(`drop schema if exists ${SCHEMA} cascade`);
  await isolated.end();
});

describe('migrate', () => {
  const first = migration('0001_first', 'create table alpha (id int primary key)');
  const second = migration('0002_second', 'create table beta (id int primary key)');

  it('applies pending migrations in order and records them', async () => {
    expect(await migrate(isolated, [first, second])).toEqual(['0001_first', '0002_second']);
    expect(await tables()).toEqual(['alpha', 'beta', 'schema_migrations']);
    const { rows } = await isolated.query<{ version: string; checksum: string }>(
      'select version, checksum from schema_migrations order by version',
    );
    expect(rows).toEqual([
      { version: '0001_first', checksum: first.checksum },
      { version: '0002_second', checksum: second.checksum },
    ]);
  });

  it('is idempotent', async () => {
    await migrate(isolated, [first]);
    expect(await migrate(isolated, [first, second])).toEqual(['0002_second']);
    expect(await migrate(isolated, [first, second])).toEqual([]);
  });

  it('refuses to run when an applied migration was edited', async () => {
    await migrate(isolated, [first]);
    const edited = migration('0001_first', 'create table alpha (id bigint primary key)');
    await expect(migrate(isolated, [edited])).rejects.toThrow(/changed after it had been applied/);
  });

  it('refuses to run against a database that has migrations this build does not know', async () => {
    await migrate(isolated, [first, second]);
    const error = await migrate(isolated, [first]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MigrationError);
    expect(error).toMatchObject({ version: '0002_second' });
  });

  it('refuses to apply a migration older than one already applied', async () => {
    await migrate(isolated, [first, second]);
    const late = migration('0001_late', 'create table late (id int)');
    await expect(migrate(isolated, [first, late, second])).rejects.toThrow(/older than the already applied/);
    expect(await tables()).not.toContain('late');
  });

  it('rolls back a failing migration completely', async () => {
    const broken = migration('0002_broken', 'create table gamma (id int); select * from missing_table');
    await expect(migrate(isolated, [first, broken])).rejects.toThrow(/missing_table/);
    expect(await tables()).toEqual(['alpha', 'schema_migrations']);
    const { rows } = await isolated.query('select version from schema_migrations');
    expect(rows).toEqual([{ version: '0001_first' }]);
  });

  it('applies each migration once under concurrent runs', async () => {
    const results = await Promise.all([
      migrate(isolated, [first, second]),
      migrate(isolated, [first, second]),
    ]);
    expect(results.flat().sort()).toEqual(['0001_first', '0002_second']);
  });
});

describe('loadMigrations', () => {
  it('reads numbered SQL files in order and ignores everything else', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ppshkin-migrations-'));
    try {
      await writeFile(join(dir, '0002_b.sql'), 'select 2');
      await writeFile(join(dir, '0001_a.sql'), 'select 1');
      await writeFile(join(dir, 'notes.txt'), 'x');
      await writeFile(join(dir, '3_bad.sql'), 'select 3');
      const loaded = await loadMigrations(pathToFileURL(`${dir}/`));
      expect(loaded.map((item) => item.version)).toEqual(['0001_a', '0002_b']);
      expect(loaded[0]).toMatchObject({ sql: 'select 1', checksum: checksum('select 1') });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ships the project schema', async () => {
    const versions = (await loadMigrations()).map((item) => item.version);
    expect(versions[0]).toBe('0001_init');
  });
});
