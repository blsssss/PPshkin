import { DEMO_ACCOUNTS, matchDemoToken, type DemoRole, type DemoTokens } from '../auth/demo.ts';
import { InitDataError, verifyInitData } from '../auth/init-data.ts';
import { issueSession, verifySession } from '../auth/session.ts';
import type { Queryable } from '../db/pool.ts';
import type { User } from '../domain/models.ts';
import * as users from '../repositories/users.ts';
import type { Clock } from '../shared/clock.ts';
import { unauthorized, unavailable } from '../shared/errors.ts';

export interface AuthContext {
  userId: number;
  via: 'session' | 'demo';
  demoRole: DemoRole | null;
}

export interface SignedIn {
  token: string;
  expiresAt: Date;
  user: User;
  startParam: string | null;
}

export interface AuthService {
  signInWithMax(initData: string): Promise<SignedIn>;
  resolveBearer(token: string): Promise<AuthContext | null>;
}

export interface AuthSettings {
  botToken: string | null;
  sessionSecret: string | null;
  sessionTtlSeconds: number;
  initDataMaxAgeSeconds: number;
  demoTokens: DemoTokens | null;
}

const INIT_DATA_MESSAGES = {
  malformed: 'Init data is malformed',
  bad_signature: 'Init data signature does not match',
  expired: 'Init data is too old, reopen the mini app',
  no_user: 'Init data has no user',
} as const;

export function createAuthService(db: Queryable, settings: AuthSettings, clock: Clock): AuthService {
  const ensuredDemoUsers = new Set<DemoRole>();

  async function ensureDemoUser(role: DemoRole) {
    if (ensuredDemoUsers.has(role)) return;
    const account = DEMO_ACCOUNTS[role];
    await users.upsert(db, { id: account.userId, firstName: account.firstName, username: null });
    ensuredDemoUsers.add(role);
  }

  return {
    async signInWithMax(initData) {
      if (!settings.botToken || !settings.sessionSecret) {
        throw unavailable('auth_unavailable', 'Sign in with MAX is not configured on this server');
      }
      let verified;
      try {
        verified = verifyInitData(initData, {
          botToken: settings.botToken,
          maxAgeSeconds: settings.initDataMaxAgeSeconds,
          now: clock.now(),
        });
      } catch (error) {
        if (error instanceof InitDataError) {
          throw unauthorized(`init_data_${error.reason}`, INIT_DATA_MESSAGES[error.reason]);
        }
        throw error;
      }
      const user = await users.upsert(db, {
        id: verified.user.id,
        firstName: verified.user.firstName,
        username: verified.user.username,
      });
      const session = issueSession(user.id, settings.sessionSecret, settings.sessionTtlSeconds, clock.now());
      return { ...session, user, startParam: verified.startParam };
    },

    async resolveBearer(token) {
      if (settings.demoTokens) {
        const role = matchDemoToken(token, settings.demoTokens);
        if (role) {
          await ensureDemoUser(role);
          return { userId: DEMO_ACCOUNTS[role].userId, via: 'demo', demoRole: role };
        }
      }
      if (!settings.sessionSecret) return null;
      const claims = verifySession(token, settings.sessionSecret, clock.now());
      return claims ? { userId: claims.userId, via: 'session', demoRole: null } : null;
    },
  };
}
