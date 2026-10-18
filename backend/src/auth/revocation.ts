import type { Queryable } from '../db/pool.ts';
import * as users from '../repositories/users.ts';

export type RevokeTarget = { kind: 'user'; userId: number } | { kind: 'all' };

interface Output {
  write(text: string): unknown;
}

export interface RevokeDeps {
  db: Queryable;
  stdout: Output;
  stderr: Output;
}

const USAGE = 'usage: revoke-sessions --user <id> | --all\n';

export function parseRevokeArgs(args: readonly string[]): RevokeTarget | null {
  if (args.length === 1 && args[0] === '--all') return { kind: 'all' };
  if (args.length === 2 && args[0] === '--user' && /^\d{1,15}$/.test(args[1] ?? '')) {
    const userId = Number(args[1]);
    return userId > 0 ? { kind: 'user', userId } : null;
  }
  return null;
}

export async function runRevokeSessions(args: readonly string[], deps: RevokeDeps): Promise<number> {
  const target = parseRevokeArgs(args);
  if (!target) {
    deps.stderr.write(USAGE);
    return 2;
  }
  if (target.kind === 'all') {
    const count = await users.revokeAllSessions(deps.db);
    deps.stdout.write(`revoked sessions of ${count} users, open sessions stop working within 30 seconds\n`);
    return 0;
  }
  if (!(await users.revokeSessions(deps.db, target.userId))) {
    deps.stderr.write(`user ${target.userId} not found\n`);
    return 1;
  }
  deps.stdout.write(
    `revoked sessions of user ${target.userId}, open sessions stop working within 30 seconds\n`,
  );
  return 0;
}
