import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { expectContract } from '../../test/contract.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { maxUserJson, signInitData } from '../../test/init-data.ts';
import { testConfig } from '../../test/services.ts';
import { createServices } from '../container.ts';
import { disabledRecognition } from '../recognition/index.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { buildApp } from './app.ts';

const BOT_TOKEN = 'flow-bot-token-0123456789';
const DEMO_TOKEN = 'demo-guest-token-flow-0123456789';
const clock = fixedClock('2026-09-25T12:00:00Z');
const pool = testPool();
let app: FastifyInstance;

beforeAll(async () => {
  const config = testConfig({ MAX_BOT_TOKEN: BOT_TOKEN, DEMO_MODE: 'true', DEMO_GUEST_TOKEN: DEMO_TOKEN });
  const services = createServices({
    config,
    pool,
    clock,
    recognition: disabledRecognition(),
    background: createBackgroundTasks({ error: () => undefined }),
  });
  app = await buildApp({ config, services });
  await app.ready();
});

beforeEach(async () => {
  await resetDatabase(pool);
});

afterAll(async () => {
  await app.close();
  await closeTestPool();
});

describe('sign in flow against the database', () => {
  it('signs in with MAX init data and reads the profile with the issued token', async () => {
    const initData = signInitData(
      { auth_date: String(Math.floor(clock.now().getTime() / 1000)), user: maxUserJson(4242, 'Марат') },
      BOT_TOKEN,
    );
    const signIn = await app.inject({ method: 'POST', url: '/api/v1/auth/max', payload: { initData } });
    expect(signIn.statusCode).toBe(200);
    expectContract(signIn, 'POST', '/api/v1/auth/max');
    const { token } = signIn.json<{ token: string }>();

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expectContract(me, 'GET', '/api/v1/me');
    expect(me.json()).toMatchObject({ id: 4242, firstName: 'Марат', kcalTarget: 2000 });
  });

  it('opens the demo guest account with the demo token', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${DEMO_TOKEN}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: -1001, firstName: 'Демо-гость' });
  });
});
