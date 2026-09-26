import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL, json, problem, TEST_USER } from '../../test/http.ts';
import { TEST_INIT_DATA } from '../../test/webapp.ts';
import { ApiError, NETWORK_ERROR, TIMEOUT_ERROR } from './errors.ts';
import { DEFAULT_TIMEOUT_MS, LONG_TIMEOUT_MS, timeoutFor, type FetchLike } from './http.ts';
import { createApiSession } from './setup.ts';

type Handler = (request: Request) => Response | Promise<Response>;

function session(body: { token: string; startParam?: string | null }) {
  return json({
    token: body.token,
    expiresAt: '2026-09-26T20:00:00.000Z',
    startParam: body.startParam ?? null,
    user: TEST_USER,
  });
}

function setup(handler: Handler, options: { launch?: string | null; dev?: string | null } = {}) {
  const calls: { method: string; path: string; authorization: string | null; body: string }[] = [];
  const baseFetch = vi.fn<FetchLike>(async (request, init) => {
    const body = request.method === 'GET' ? '' : await request.clone().text();
    calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      authorization: request.headers.get('Authorization'),
      body,
    });
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
      Promise.resolve(handler(request)).then(resolve, reject);
    });
  });
  const created = createApiSession({
    baseUrl: BASE_URL,
    initData: () => (options.launch === undefined ? TEST_INIT_DATA : options.launch),
    devToken: () => options.dev ?? null,
    baseFetch,
  });
  return { ...created, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sign in', () => {
  it('sends initData unchanged and uses the token as Bearer', async () => {
    const {
      session: store,
      api,
      calls,
    } = setup((request) =>
      new URL(request.url).pathname === '/api/v1/auth/max'
        ? session({ token: 'token-1', startParam: 'venue_1' })
        : json(TEST_USER),
    );
    await store.start();
    expect(store.getState()).toMatchObject({ status: 'ready', startParam: 'venue_1' });
    expect(JSON.parse(calls[0]!.body)).toEqual({ initData: TEST_INIT_DATA });
    expect(calls[0]!.authorization).toBeNull();

    await api.GET('/api/v1/me');
    expect(calls[1]).toMatchObject({ path: '/api/v1/me', authorization: 'Bearer token-1' });
  });

  it('shows the open-in-MAX state without initData and dev token', async () => {
    const { session: store, calls } = setup(() => json({}), { launch: null });
    await store.start();
    expect(store.getState()).toEqual({ status: 'outside' });
    expect(calls).toHaveLength(0);
  });

  it('works under the dev token outside MAX', async () => {
    const { session: store, calls } = setup(() => json(TEST_USER), { launch: null, dev: 'demo-guest-token' });
    await store.start();
    expect(store.getState()).toMatchObject({ status: 'ready', user: { id: 101 }, startParam: null });
    expect(calls).toEqual([
      expect.objectContaining({ path: '/api/v1/me', authorization: 'Bearer demo-guest-token' }),
    ]);
  });

  it.each(['init_data_malformed', 'init_data_bad_signature', 'init_data_no_user'])(
    'fails with %s',
    async (code) => {
      const { session: store } = setup(() => problem(401, code));
      await store.start();
      const state = store.getState();
      expect(state.status).toBe('failed');
      expect(state.status === 'failed' && state.error.code).toBe(code);
    },
  );

  it('marks an expired launch as expired', async () => {
    const { session: store } = setup(() => problem(401, 'init_data_expired'));
    await store.start();
    expect(store.getState()).toEqual({ status: 'expired' });
  });

  it('reports a network failure and recovers on retry', async () => {
    let online = false;
    const { session: store } = setup(() => {
      if (!online) throw new TypeError('Failed to fetch');
      return session({ token: 'token-1' });
    });
    await store.start();
    const state = store.getState();
    expect(state.status === 'failed' && state.error.code).toBe(NETWORK_ERROR);
    online = true;
    await store.start();
    expect(store.getState().status).toBe('ready');
  });
});

describe('expired token', () => {
  it('signs in again once and repeats the request', async () => {
    let signIns = 0;
    const {
      session: store,
      api,
      calls,
    } = setup((request) => {
      if (new URL(request.url).pathname === '/api/v1/auth/max') {
        signIns += 1;
        return session({ token: `token-${signIns}` });
      }
      return request.headers.get('Authorization') === 'Bearer token-2'
        ? json(TEST_USER)
        : problem(401, 'invalid_token');
    });
    await store.start();
    const result = await api.GET('/api/v1/me');
    expect(result.data?.id).toBe(101);
    expect(signIns).toBe(2);
    expect(calls.map((call) => call.path)).toEqual([
      '/api/v1/auth/max',
      '/api/v1/me',
      '/api/v1/auth/max',
      '/api/v1/me',
    ]);
  });

  it('shares one sign in between parallel 401 responses', async () => {
    let signIns = 0;
    const { session: store, api } = setup(async (request) => {
      if (new URL(request.url).pathname === '/api/v1/auth/max') {
        signIns += 1;
        await Promise.resolve();
        return session({ token: `token-${signIns}` });
      }
      return request.headers.get('Authorization') === 'Bearer token-1'
        ? problem(401, 'unauthorized')
        : json(TEST_USER);
    });
    await store.start();
    const results = await Promise.all([api.GET('/api/v1/me'), api.GET('/api/v1/me'), api.GET('/api/v1/me')]);
    expect(results.every((result) => result.data?.id === 101)).toBe(true);
    expect(signIns).toBe(2);
  });

  it('shows the expired screen when initData is too old for a new sign in', async () => {
    let signIns = 0;
    const { session: store, api } = setup((request) => {
      if (new URL(request.url).pathname === '/api/v1/auth/max') {
        signIns += 1;
        return signIns === 1 ? session({ token: 'token-1' }) : problem(401, 'init_data_expired');
      }
      return problem(401, 'invalid_token');
    });
    await store.start();
    await expect(api.GET('/api/v1/me')).rejects.toMatchObject({ status: 401, code: 'invalid_token' });
    expect(store.getState()).toEqual({ status: 'expired' });
  });

  it('does not retry other 401 codes', async () => {
    const {
      session: store,
      api,
      calls,
    } = setup((request) =>
      new URL(request.url).pathname === '/api/v1/auth/max'
        ? session({ token: 'token-1' })
        : problem(401, 'init_data_bad_signature'),
    );
    await store.start();
    await expect(api.GET('/api/v1/me')).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(2);
  });
});

describe('transport', () => {
  it('turns problem+json into ApiError', async () => {
    const { session: store, api } = setup((request) =>
      new URL(request.url).pathname === '/api/v1/auth/max'
        ? session({ token: 'token-1' })
        : problem(400, 'validation_failed', {
            errors: [
              { path: 'body.kcalTarget', message: 'Too small' },
              { path: 'query.days', message: 'Too big' },
            ],
          }),
    );
    await store.start();
    await expect(api.PATCH('/api/v1/me', { body: { kcalTarget: 10 } })).rejects.toMatchObject({
      status: 400,
      code: 'validation_failed',
      fieldErrors: { kcalTarget: 'Too small', 'query.days': 'Too big' },
    });
  });

  it('reads Retry-After on 429', async () => {
    const { session: store, api } = setup((request) =>
      new URL(request.url).pathname === '/api/v1/auth/max'
        ? session({ token: 'token-1' })
        : problem(429, 'rate_limited', { headers: { 'Retry-After': '17' } }),
    );
    await store.start();
    await expect(api.GET('/api/v1/me')).rejects.toMatchObject({ status: 429, retryAfterSeconds: 17 });
  });

  it('times out slow requests', async () => {
    const { session: store, api } = setup((request) =>
      new URL(request.url).pathname === '/api/v1/auth/max'
        ? session({ token: 'token-1' })
        : new Promise<Response>(() => undefined),
    );
    await store.start();
    vi.useFakeTimers();
    const pending = api.GET('/api/v1/me');
    const assertion = expect(pending).rejects.toMatchObject({ status: 0, code: TIMEOUT_ERROR });
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
    await assertion;
  });

  it('gives recognition requests 90 seconds', () => {
    expect(timeoutFor('http://localhost/api/v1/diary/meals/photo')).toBe(LONG_TIMEOUT_MS);
    expect(timeoutFor('http://localhost/api/v1/diary/meals/text')).toBe(LONG_TIMEOUT_MS);
    expect(timeoutFor('http://localhost/api/v1/venue/menu/imports/photo')).toBe(LONG_TIMEOUT_MS);
    expect(timeoutFor('http://localhost/api/v1/venue/menu/imports/text')).toBe(LONG_TIMEOUT_MS);
    expect(timeoutFor('http://localhost/api/v1/diary/meals')).toBe(DEFAULT_TIMEOUT_MS);
  });
});
