import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import * as users from '../repositories/users.ts';
import { parseRevokeArgs, runRevokeSessions } from './revocation.ts';

const pool = testPool();

function capture() {
  const lines: string[] = [];
  return { lines, output: { write: (text: string) => lines.push(text) } };
}

async function run(args: string[]) {
  const stdout = capture();
  const stderr = capture();
  const code = await runRevokeSessions(args, { db: pool, stdout: stdout.output, stderr: stderr.output });
  return { code, stdout: stdout.lines.join(''), stderr: stderr.lines.join('') };
}

beforeEach(async () => {
  await resetDatabase(pool);
  await users.upsert(pool, { id: 555, firstName: 'Ольга', username: null });
  await users.upsert(pool, { id: 556, firstName: 'Иван', username: null });
});

afterAll(async () => {
  await closeTestPool();
});

describe('parseRevokeArgs', () => {
  it('reads one user or all users', () => {
    expect(parseRevokeArgs(['--user', '555'])).toEqual({ kind: 'user', userId: 555 });
    expect(parseRevokeArgs(['--all'])).toEqual({ kind: 'all' });
  });

  it('rejects anything else', () => {
    for (const args of [[], ['--user'], ['--user', '0'], ['--user', '-1'], ['--user', 'x'], ['--all', '1']]) {
      expect(parseRevokeArgs(args)).toBeNull();
    }
  });
});

describe('runRevokeSessions', () => {
  it('bumps the session epoch of one user', async () => {
    const result = await run(['--user', '555']);
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toContain('user 555');
    expect(await users.sessionEpoch(pool, 555)).toBe(1);
    expect(await users.sessionEpoch(pool, 556)).toBe(0);
  });

  it('bumps the session epoch of every user', async () => {
    const result = await run(['--all']);
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toContain('2 users');
    expect(await users.sessionEpoch(pool, 555)).toBe(1);
    expect(await users.sessionEpoch(pool, 556)).toBe(1);
  });

  it('fails for an unknown user and prints the usage for bad arguments', async () => {
    expect(await run(['--user', '999'])).toMatchObject({ code: 1, stderr: 'user 999 not found\n' });
    expect(await run(['--everyone'])).toMatchObject({ code: 2, stdout: '' });
    expect(await users.sessionEpoch(pool, 555)).toBe(0);
  });
});
