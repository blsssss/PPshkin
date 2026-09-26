import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { markProcessed, purgeProcessedBefore } from './processed-updates.ts';

const pool = testPool();

beforeEach(async () => {
  await resetDatabase(pool);
});

afterAll(async () => {
  await closeTestPool();
});

async function age(key: string, processedAt: string) {
  await pool.query('update processed_updates set processed_at = $2 where key = $1', [key, processedAt]);
}

describe('processed updates repository', () => {
  it('marks a key once', async () => {
    expect(await markProcessed(pool, 'message_created:mid.1:1790000000000')).toBe(true);
    expect(await markProcessed(pool, 'message_created:mid.1:1790000000000')).toBe(false);
    expect(await markProcessed(pool, 'message_created:mid.2:1790000000000')).toBe(true);
  });

  it('purges keys processed before the given moment', async () => {
    await markProcessed(pool, 'old');
    await markProcessed(pool, 'edge');
    await markProcessed(pool, 'fresh');
    await age('old', '2026-09-20T00:00:00Z');
    await age('edge', '2026-09-25T00:00:00Z');
    await age('fresh', '2026-09-26T00:00:00Z');

    expect(await purgeProcessedBefore(pool, new Date('2026-09-25T00:00:00Z'))).toBe(1);
    expect(await markProcessed(pool, 'old')).toBe(true);
    expect(await markProcessed(pool, 'edge')).toBe(false);
    expect(await markProcessed(pool, 'fresh')).toBe(false);
    expect(await purgeProcessedBefore(pool, new Date('2026-01-01T00:00:00Z'))).toBe(0);
  });
});
