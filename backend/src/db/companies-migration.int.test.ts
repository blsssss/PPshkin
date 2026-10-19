import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, testPool } from '../../test/database.ts';
import { loadMigrations, migrate } from './migrate.ts';

const SCHEMA = 'companies_migration_spec';
const COMPANIES_MIGRATION = '0010_companies';
const isolated = new pg.Pool({
  connectionString: TEST_DATABASE_URL,
  max: 2,
  options: `-c search_path=${SCHEMA}`,
});

async function insertVenue(
  name: string,
  ownerId: number | null,
  options: { demo?: boolean; sourceId?: number | null } = {},
): Promise<number> {
  const { rows } = await isolated.query<{ id: number }>(
    `insert into venues (owner_id, name, address, category, lat, lon, is_demo, demo_source_id)
     values ($1, $2, 'Казань', 'coffee', 55.78, 49.12, $3, $4)
     returning id`,
    [ownerId, name, options.demo ?? false, options.sourceId ?? null],
  );
  return rows[0]?.id ?? 0;
}

beforeEach(async () => {
  await testPool().query(`drop schema if exists ${SCHEMA} cascade`);
  await testPool().query(`create schema ${SCHEMA}`);
});

afterAll(async () => {
  await testPool().query(`drop schema if exists ${SCHEMA} cascade`);
  await isolated.end();
});

describe('the companies migration', () => {
  it('turns every owner of a real venue into the owner of an unverified company', async () => {
    const all = await loadMigrations();
    const before = all.filter((candidate) => candidate.version < COMPANIES_MIGRATION);
    await migrate(isolated, before);
    await isolated.query('insert into users (id) values (101), (102), (103), (104), (-1002)');
    const seeded = await insertVenue('Демо-источник', null, { demo: true });
    const demoOwner = await insertVenue('Демо-заведение', -1002, { demo: true });
    const copy = await insertVenue('Копия демо', 103, { demo: true, sourceId: seeded });
    const zerno = await insertVenue('Зерно', 101);
    const pekarnya = await insertVenue('Пекарня', 102);

    expect(await migrate(isolated, all)).toEqual([COMPANIES_MIGRATION]);

    const { rows: venues } = await isolated.query<{
      id: number;
      owner_id: number | null;
      company_id: number | null;
    }>('select id, owner_id, company_id from venues order by id');
    const byId = new Map(venues.map((venue) => [venue.id, venue]));
    expect(byId.get(seeded)).toMatchObject({ owner_id: null, company_id: null });
    expect(byId.get(demoOwner)).toMatchObject({ owner_id: -1002, company_id: null });
    expect(byId.get(copy)).toMatchObject({ owner_id: 103, company_id: null });
    for (const id of [zerno, pekarnya]) {
      expect(byId.get(id)?.owner_id).toBeNull();
      expect(byId.get(id)?.company_id).not.toBeNull();
    }
    expect(byId.get(zerno)?.company_id).not.toBe(byId.get(pekarnya)?.company_id);

    const { rows: companies } = await isolated.query<{
      id: number;
      name: string;
      verification: string;
      inn: string | null;
      created_by: number;
    }>('select id, name, verification, inn, created_by from companies order by id');
    expect(
      companies.map(({ name, verification, inn, created_by }) => ({ name, verification, inn, created_by })),
    ).toEqual([
      { name: 'Зерно', verification: 'unverified', inn: null, created_by: 101 },
      { name: 'Пекарня', verification: 'unverified', inn: null, created_by: 102 },
    ]);

    const { rows: members } = await isolated.query<{
      company_id: number;
      user_id: number;
      role: string;
      venue_id: number | null;
    }>('select company_id, user_id, role, venue_id from memberships order by user_id');
    expect(members).toEqual([
      { company_id: byId.get(zerno)?.company_id, user_id: 101, role: 'owner', venue_id: null },
      { company_id: byId.get(pekarnya)?.company_id, user_id: 102, role: 'owner', venue_id: null },
    ]);
  });

  it('adds the redeemer to bookings and keeps old ones empty', async () => {
    const all = await loadMigrations();
    await migrate(
      isolated,
      all.filter((candidate) => candidate.version < COMPANIES_MIGRATION),
    );
    await isolated.query('insert into users (id) values (101)');
    await migrate(isolated, all);

    const { rows } = await isolated.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = $1 and table_name = 'bookings' and column_name = 'redeemed_by'`,
      [SCHEMA],
    );
    expect(rows).toHaveLength(1);
  });
});
