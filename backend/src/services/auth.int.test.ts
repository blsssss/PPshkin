import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { maxUserJson, signInitData } from '../../test/init-data.ts';
import { DEMO_ACCOUNTS } from '../auth/demo.ts';
import * as users from '../repositories/users.ts';
import { AppError } from '../shared/errors.ts';
import { createAuthService, type AuthSettings } from './auth.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T12:00:00Z');
const BOT_TOKEN = 'integration-bot-token-0123';

const settings: AuthSettings = {
  botToken: BOT_TOKEN,
  sessionSecret: 'integration-session-secret-0123456789',
  sessionTtlSeconds: 3600,
  initDataMaxAgeSeconds: 3600,
  demoTokens: { guest: 'demo-guest-token-000000000000', venue: undefined },
};

const authDate = () => String(Math.floor(clock.now().getTime() / 1000));

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-25T12:00:00Z');
});

afterAll(async () => {
  await closeTestPool();
});

describe('auth service', () => {
  it('creates the user on first sign in and issues a working session', async () => {
    const auth = createAuthService(pool, settings, clock);
    const signedIn = await auth.signInWithMax(
      signInitData(
        { auth_date: authDate(), user: maxUserJson(555, 'Ольга'), start_param: 'deal_7' },
        BOT_TOKEN,
      ),
    );
    expect(signedIn.user).toMatchObject({ id: 555, firstName: 'Ольга' });
    expect(signedIn.startParam).toBe('deal_7');
    expect(await users.findById(pool, 555)).not.toBeNull();
    expect(await auth.resolveBearer(signedIn.token)).toEqual({ userId: 555, via: 'session', demoRole: null });

    clock.advance(3600 * 1000);
    expect(await auth.resolveBearer(signedIn.token)).toBeNull();
  });

  it('maps rejected init data to 401 errors with a reason code', async () => {
    const auth = createAuthService(pool, settings, clock);
    const error = await auth
      .signInWithMax(signInitData({ auth_date: authDate(), user: maxUserJson(1) }, 'wrong-bot-token-00000'))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 401, code: 'init_data_bad_signature' });
  });

  it('refuses to sign in when the bot token is not configured', async () => {
    const auth = createAuthService(pool, { ...settings, botToken: null }, clock);
    await expect(auth.signInWithMax('anything')).rejects.toMatchObject({
      status: 503,
      code: 'auth_unavailable',
    });
  });

  it('accepts demo tokens only for configured roles and creates the demo user', async () => {
    const auth = createAuthService(pool, settings, clock);
    expect(await auth.resolveBearer('demo-guest-token-000000000000')).toEqual({
      userId: DEMO_ACCOUNTS.guest.userId,
      via: 'demo',
      demoRole: 'guest',
    });
    expect(await users.findById(pool, DEMO_ACCOUNTS.guest.userId)).toMatchObject({ firstName: 'Демо-гость' });
    expect(await auth.resolveBearer('demo-venue-token-000000000000')).toBeNull();
  });

  it('ignores demo tokens when demo mode is off', async () => {
    const auth = createAuthService(pool, { ...settings, demoTokens: null }, clock);
    expect(await auth.resolveBearer('demo-guest-token-000000000000')).toBeNull();
  });
});
