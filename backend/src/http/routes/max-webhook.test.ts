import type { FastifyInstance } from 'fastify';
import type { QueryResult, QueryResultRow } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from '../../../test/services.ts';
import type { Queryable } from '../../db/pool.ts';
import { createDedupingHandler } from '../../integrations/max/dedupe.ts';
import type { UpdateHandler } from '../../ports/messenger.ts';
import { createBackgroundTasks } from '../../shared/background.ts';
import { maxWebhookRoutes } from './max-webhook.ts';

const SECRET = 'hook_secret-1';

const update = {
  update_type: 'message_created',
  timestamp: 1_790_000_000_000,
  user_locale: 'ru',
  message: {
    sender: { user_id: 101, first_name: 'Анна', username: null, is_bot: false },
    recipient: { chat_id: 555, chat_type: 'dialog', user_id: 700 },
    timestamp: 1_790_000_000_000,
    body: { mid: 'mid.1', seq: 1, text: 'Привет', attachments: [] },
  },
};

const hiddenRoute = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  code: 'route_not_found',
  detail: 'Route POST /max/webhook not found',
};

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function start(handler: UpdateHandler, env: Record<string, string> = {}) {
  const background = createBackgroundTasks({ error: vi.fn() });
  const app = await buildTestApp({
    env,
    extend: (server) => {
      void server.register(maxWebhookRoutes, { secret: SECRET, handler, background });
    },
  });
  apps.push(app);
  const deliver = (payload: unknown, secret: string | null = SECRET) =>
    app.inject({
      method: 'POST',
      url: '/max/webhook',
      headers: {
        'content-type': 'application/json',
        ...(secret === null ? {} : { 'x-max-bot-api-secret': secret }),
      },
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
  return { app, background, deliver };
}

function memoryDatabase(): Queryable {
  const keys = new Set<string>();
  return {
    query<Row extends QueryResultRow>(_text: string, values: unknown[] = []) {
      const key = values[0] as string;
      const inserted = !keys.has(key);
      keys.add(key);
      return Promise.resolve({ rowCount: inserted ? 1 : 0, rows: [] as Row[] } as QueryResult<Row>);
    },
  };
}

describe('POST /max/webhook', () => {
  it('answers right away and handles the update in the background', async () => {
    const { promise: gate, resolve } = Promise.withResolvers<undefined>();
    const handler = vi.fn(() => gate);
    const { background, deliver } = await start(handler);

    const response = await deliver(update);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message',
        key: 'message_created:mid.1:1790000000000',
        text: 'Привет',
      }),
    );
    expect(background.pending).toBe(1);
    resolve(undefined);
    await background.idle();
    expect(background.pending).toBe(0);
  });

  it('looks like a missing route when the secret is absent or wrong', async () => {
    const handler = vi.fn(() => Promise.resolve());
    const { deliver } = await start(handler);
    for (const secret of [null, '', 'wrong-secret', `${SECRET}x`, SECRET.toUpperCase()]) {
      const response = await deliver(update, secret);
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toEqual(hiddenRoute);
    }
    expect(handler).not.toHaveBeenCalled();

    const withoutRoute = await buildTestApp();
    apps.push(withoutRoute);
    const missing = await withoutRoute.inject({ method: 'POST', url: '/max/webhook', payload: update });
    expect(missing.json()).toEqual(hiddenRoute);
  });

  it('checks the secret before it reads the body', async () => {
    const { deliver } = await start(vi.fn(() => Promise.resolve()));
    const response = await deliver('{"update_type":', 'wrong-secret');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(hiddenRoute);
  });

  it('confirms updates it does not handle so MAX stops redelivering them', async () => {
    const handler = vi.fn(() => Promise.resolve());
    const { background, deliver } = await start(handler);
    const ignored = [
      { update_type: 'message_edited', timestamp: 1, message: update.message },
      { update_type: 'message_created', timestamp: 1, user_locale: 'ru' },
      { unexpected: true },
      [],
    ];
    for (const payload of ignored) {
      const response = await deliver(payload);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    }
    await background.idle();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not handle a redelivered update twice', async () => {
    const handler = vi.fn(() => Promise.resolve());
    const { background, deliver } = await start(createDedupingHandler(memoryDatabase(), handler));
    expect((await deliver(update)).statusCode).toBe(200);
    await background.idle();
    expect((await deliver(update)).statusCode).toBe(200);
    await background.idle();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('is not limited by the per address rate limit', async () => {
    const { deliver } = await start(
      vi.fn(() => Promise.resolve()),
      { RATE_LIMIT_PER_MINUTE: '1' },
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await deliver(update)).statusCode).toBe(200);
    }
  });

  it('asks MAX to deliver again while the server shuts down', async () => {
    const handler = vi.fn(() => Promise.resolve());
    const { background, deliver } = await start(handler);
    background.stop();
    const response = await deliver(update);
    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ code: 'shutting_down' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('stays out of the OpenAPI document', async () => {
    const { app } = await start(vi.fn(() => Promise.resolve()));
    const document = app.swagger() as { paths?: Record<string, unknown> };
    expect(Object.keys(document.paths ?? {})).not.toContain('/max/webhook');
    expect(Object.keys(document.paths ?? {})).toContain('/health');
  });
});
