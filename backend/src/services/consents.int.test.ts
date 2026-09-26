import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { withTransaction, type PoolClient } from '../db/pool.ts';
import { CONSENT_DOCUMENTS } from '../domain/consents.ts';
import * as users from '../repositories/users.ts';
import { createConsentsService, type ConsentState } from './consents.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const consents = createConsentsService({ pool, clock });
const VERSION = CONSENT_DOCUMENTS.personal_data.version;

interface HistoryRow {
  kind: string;
  version: string;
  channel: string;
  granted_at: Date;
  revoked_at: Date | null;
}

async function history(userId: number): Promise<HistoryRow[]> {
  const { rows } = await pool.query<HistoryRow>(
    'select kind, version, channel, granted_at, revoked_at from consents where user_id = $1 order by id',
    [userId],
  );
  return rows;
}

async function lockWaiters(client: PoolClient): Promise<number> {
  await client.query('select pg_stat_clear_snapshot()');
  const { rows } = await client.query<{ waiting: number }>(
    `select count(*)::int as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`,
  );
  return rows[0]?.waiting ?? 0;
}

async function grantAllAtOnce(count: number, grant: () => Promise<ConsentState>): Promise<ConsentState[]> {
  const pending = await withTransaction(pool, async (holder) => {
    await holder.query('select id from users where id = 1 for update');
    const started = Array.from({ length: count }, grant);
    await expect.poll(() => lockWaiters(holder), { interval: 5 }).toBe(count);
    return started;
  });
  return Promise.all(pending);
}

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-25T09:00:00Z');
  await users.upsert(pool, { id: 1, firstName: 'Ира', username: null });
});

afterAll(async () => {
  await closeTestPool();
});

describe('consents service', () => {
  it('starts without consents', async () => {
    expect(await consents.status(1)).toEqual({
      personalData: { granted: false, version: null, grantedAt: null },
      personalizedOffers: { granted: false, version: null, grantedAt: null },
    });
  });

  it('grants a consent with its version, channel and time', async () => {
    const state = await consents.grant(1, 'personal_data', VERSION, 'bot');
    expect(state).toEqual({ granted: true, version: VERSION, grantedAt: new Date('2026-09-25T09:00:00Z') });
    expect(await history(1)).toEqual([
      {
        kind: 'personal_data',
        version: VERSION,
        channel: 'bot',
        granted_at: new Date('2026-09-25T09:00:00Z'),
        revoked_at: null,
      },
    ]);
    expect((await consents.status(1)).personalData).toEqual(state);
  });

  it('does not create a new record when the same version is granted again', async () => {
    await consents.grant(1, 'personal_data', VERSION, 'bot');
    clock.advance(60_000);
    const again = await consents.grant(1, 'personal_data', VERSION, 'miniapp');
    expect(again.grantedAt).toEqual(new Date('2026-09-25T09:00:00Z'));
    expect(await history(1)).toHaveLength(1);
  });

  it('rejects an outdated version without writing anything', async () => {
    await expect(consents.grant(1, 'personal_data', '2020-01-01', 'miniapp')).rejects.toMatchObject({
      status: 409,
      code: 'consent_version_outdated',
    });
    expect(await history(1)).toEqual([]);
  });

  it('answers 404 for a missing user', async () => {
    await expect(consents.grant(404, 'personal_data', VERSION, 'miniapp')).rejects.toMatchObject({
      status: 404,
      code: 'user_not_found',
    });
  });

  it('keeps the history of granting, revoking and granting again with one active record', async () => {
    const version = CONSENT_DOCUMENTS.personalized_offers.version;
    await consents.grant(1, 'personalized_offers', version, 'bot');
    clock.advance(60_000);
    await consents.revoke(1, 'personalized_offers');
    expect((await consents.status(1)).personalizedOffers).toEqual({
      granted: false,
      version: null,
      grantedAt: null,
    });
    clock.advance(60_000);
    const regranted = await consents.grant(1, 'personalized_offers', version, 'miniapp');
    expect(regranted).toEqual({ granted: true, version, grantedAt: new Date('2026-09-25T09:02:00Z') });
    expect(await history(1)).toEqual([
      {
        kind: 'personalized_offers',
        version,
        channel: 'bot',
        granted_at: new Date('2026-09-25T09:00:00Z'),
        revoked_at: new Date('2026-09-25T09:01:00Z'),
      },
      {
        kind: 'personalized_offers',
        version,
        channel: 'miniapp',
        granted_at: new Date('2026-09-25T09:02:00Z'),
        revoked_at: null,
      },
    ]);
  });

  it('accepts repeated revocation of personalized offers', async () => {
    await consents.revoke(1, 'personalized_offers');
    await consents.revoke(1, 'personalized_offers');
    expect(await history(1)).toEqual([]);
  });

  it('refuses to revoke the personal data consent and keeps it active', async () => {
    await consents.grant(1, 'personal_data', VERSION, 'bot');
    await expect(consents.revoke(1, 'personal_data')).rejects.toMatchObject({
      status: 409,
      code: 'delete_account_instead',
    });
    expect((await consents.status(1)).personalData.granted).toBe(true);
  });

  it('reports an active consent for an outdated text as not granted', async () => {
    await pool.query(
      `insert into consents (user_id, kind, version, channel, granted_at)
       values (1, 'personal_data', '2025-01-01', 'bot', '2026-01-10T10:00:00Z')`,
    );
    expect((await consents.status(1)).personalData).toEqual({
      granted: false,
      version: '2025-01-01',
      grantedAt: new Date('2026-01-10T10:00:00Z'),
    });
    await expect(consents.requirePersonalData(1)).rejects.toMatchObject({
      status: 403,
      code: 'consent_required',
    });

    await consents.grant(1, 'personal_data', VERSION, 'miniapp');
    const rows = await history(1);
    expect(rows.map((row) => [row.version, row.revoked_at === null])).toEqual([
      ['2025-01-01', false],
      [VERSION, true],
    ]);
    await expect(consents.requirePersonalData(1)).resolves.toBeUndefined();
  });

  it('lists both documents in display order with the user state', async () => {
    await consents.grant(1, 'personalized_offers', CONSENT_DOCUMENTS.personalized_offers.version, 'bot');
    const documents = await consents.list(1);
    expect(documents.map((document) => document.kind)).toEqual(['personal_data', 'personalized_offers']);
    expect(documents[0]).toEqual({
      kind: 'personal_data',
      ...CONSENT_DOCUMENTS.personal_data,
      granted: false,
      grantedAt: null,
    });
    expect(documents[1]).toMatchObject({
      kind: 'personalized_offers',
      required: false,
      granted: true,
      grantedAt: new Date('2026-09-25T09:00:00Z'),
    });
  });

  it('requires the personal data consent for a user without one', async () => {
    await expect(consents.requirePersonalData(1)).rejects.toMatchObject({
      status: 403,
      code: 'consent_required',
    });
  });

  it('writes a single record when the same version is granted concurrently', async () => {
    const results = await grantAllAtOnce(3, () => consents.grant(1, 'personal_data', VERSION, 'miniapp'));
    const state = { granted: true, version: VERSION, grantedAt: new Date('2026-09-25T09:00:00Z') };
    expect(results).toEqual([state, state, state]);
    expect(await history(1)).toEqual([
      {
        kind: 'personal_data',
        version: VERSION,
        channel: 'miniapp',
        granted_at: new Date('2026-09-25T09:00:00Z'),
        revoked_at: null,
      },
    ]);
  });

  it('replaces an outdated record once when the current version is granted concurrently', async () => {
    const version = CONSENT_DOCUMENTS.personalized_offers.version;
    await pool.query(
      `insert into consents (user_id, kind, version, channel) values (1, 'personalized_offers', '2025-01-01', 'bot')`,
    );
    await grantAllAtOnce(3, () => consents.grant(1, 'personalized_offers', version, 'miniapp'));
    const rows = await history(1);
    expect(rows.map((row) => [row.version, row.revoked_at === null])).toEqual([
      ['2025-01-01', false],
      [version, true],
    ]);
  });
});
