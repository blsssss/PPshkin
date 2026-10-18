import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { maxUserJson, signInitData } from '../../test/init-data.ts';
import { createHmac } from 'node:crypto';
import { DEMO_ACCOUNTS } from '../auth/demo.ts';
import { issueSession } from '../auth/session.ts';
import * as users from '../repositories/users.ts';
import { AppError } from '../shared/errors.ts';
import { createAuthService, SESSION_EPOCH_CACHE_MS, type AuthSettings } from './auth.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T12:00:00Z');
const BOT_TOKEN = 'integration-bot-token-0123';
const SESSION_SECRET = 'integration-session-secret-0123456789';

const settings: AuthSettings = {
  botToken: BOT_TOKEN,
  sessionSecret: SESSION_SECRET,
  previousSessionSecret: null,
  sessionTtlSeconds: 3600,
  initDataMaxAgeSeconds: 3600,
  demoTokens: { guest: 'demo-guest-token-000000000000', venue: undefined },
};

const PREVIOUS_SECRET = 'integration-previous-secret-0123456789';
const SESSION = { userId: 555, via: 'session', demoRole: null };

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

  it('accepts tokens signed with the previous secret only while it is configured', async () => {
    await users.upsert(pool, { id: 555, firstName: 'Ольга', username: null });
    const old = issueSession(555, 0, PREVIOUS_SECRET, 3600, clock.now()).token;
    const rotated = createAuthService(pool, { ...settings, previousSessionSecret: PREVIOUS_SECRET }, clock);
    expect(await rotated.resolveBearer(old)).toEqual(SESSION);
    expect(await createAuthService(pool, settings, clock).resolveBearer(old)).toBeNull();
  });

  it('issues new tokens with the current secret during a rotation', async () => {
    const rotated = createAuthService(pool, { ...settings, previousSessionSecret: PREVIOUS_SECRET }, clock);
    const signedIn = await rotated.signInWithMax(
      signInitData({ auth_date: authDate(), user: maxUserJson(555, 'Ольга') }, BOT_TOKEN),
    );
    expect(await createAuthService(pool, settings, clock).resolveBearer(signedIn.token)).toEqual(SESSION);
  });

  it('rejects revoked sessions within the epoch cache window and lets the user sign in again', async () => {
    const auth = createAuthService(pool, settings, clock);
    const initData = () =>
      signInitData({ auth_date: authDate(), user: maxUserJson(555, 'Ольга') }, BOT_TOKEN);
    const { token } = await auth.signInWithMax(initData());
    expect(token.startsWith('v2.555.0.')).toBe(true);
    expect(await auth.resolveBearer(token)).toEqual(SESSION);

    expect(await users.revokeSessions(pool, 555)).toBe(true);
    clock.advance(SESSION_EPOCH_CACHE_MS - 1);
    expect(await auth.resolveBearer(token)).toEqual(SESSION);
    clock.advance(1);
    expect(await auth.resolveBearer(token)).toBeNull();

    const again = await auth.signInWithMax(initData());
    expect(again.token.startsWith('v2.555.1.')).toBe(true);
    expect(await auth.resolveBearer(again.token)).toEqual(SESSION);
  });

  it('revokes the sessions of every user at once', async () => {
    await users.upsert(pool, { id: 555, firstName: 'Ольга', username: null });
    await users.upsert(pool, { id: 556, firstName: 'Иван', username: null });
    const first = issueSession(555, 0, SESSION_SECRET, 3600, clock.now()).token;
    const second = issueSession(556, 0, SESSION_SECRET, 3600, clock.now()).token;
    expect(await users.revokeAllSessions(pool)).toBe(2);
    const auth = createAuthService(pool, settings, clock);
    expect(await auth.resolveBearer(first)).toBeNull();
    expect(await auth.resolveBearer(second)).toBeNull();
    expect(await users.revokeSessions(pool, 999)).toBe(false);
  });

  it('accepts v1 tokens until they expire and revokes them with the epoch', async () => {
    await users.upsert(pool, { id: 555, firstName: 'Ольга', username: null });
    const expires = Math.floor(clock.now().getTime() / 1000) + 3600;
    const payload = `v1.555.${expires}`;
    const signature = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    const token = `${payload}.${signature}`;
    const auth = createAuthService(pool, settings, clock);
    expect(await auth.resolveBearer(token)).toEqual(SESSION);
    clock.advance(3600 * 1000);
    expect(await auth.resolveBearer(token)).toBeNull();

    clock.set('2026-09-25T12:00:00Z');
    await users.revokeSessions(pool, 555);
    expect(await createAuthService(pool, settings, clock).resolveBearer(token)).toBeNull();
  });

  it('rejects the token of a deleted user', async () => {
    const auth = createAuthService(pool, settings, clock);
    const { token } = await auth.signInWithMax(
      signInitData({ auth_date: authDate(), user: maxUserJson(555, 'Ольга') }, BOT_TOKEN),
    );
    await users.remove(pool, 555);
    expect(await createAuthService(pool, settings, clock).resolveBearer(token)).toBeNull();
    clock.advance(SESSION_EPOCH_CACHE_MS);
    expect(await auth.resolveBearer(token)).toBeNull();
  });
});
