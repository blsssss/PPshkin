import { describe, expect, it, vi } from 'vitest';
import { fakeMaxApi } from '../../test/max-api.ts';
import { fakeSmokeDependencies } from '../../test/smoke.ts';
import { runSmoke } from './run.ts';

describe('runSmoke', () => {
  it('runs the selected groups once each in a fixed order', async () => {
    const results = await runSmoke(
      { checks: ['api', 'max', 'api'], strict: false, env: {} },
      fakeSmokeDependencies(),
    );
    const groups = [...new Set(results.map(({ name }) => name.split('.')[0]))];

    expect(groups).toEqual(['max', 'api']);
    expect(results.every(({ status }) => status === 'skipped')).toBe(true);
  });

  it('marks checks without their variables as skipped, or failed under --strict', async () => {
    const deps = fakeSmokeDependencies();
    const options = { checks: ['site', 'recognition'] as const, env: { PUBLIC_BASE_URL: '  ' } };
    const skipped = await runSmoke({ ...options, strict: false }, deps);
    const failed = await runSmoke({ ...options, strict: true }, deps);

    expect(skipped.map(({ status }) => status)).toEqual(Array.from({ length: 6 }, () => 'skipped'));
    expect(failed.map(({ status }) => status)).toEqual(Array.from({ length: 6 }, () => 'failed'));
    expect(failed.map(({ details }) => details)).toEqual(skipped.map(({ details }) => details));
  });

  it('measures every check with the injected clock', async () => {
    const deps = fakeSmokeDependencies({
      createMaxApi: () =>
        fakeMaxApi({
          getMe: vi.fn(() => {
            deps.clock.advance(1_250);
            return Promise.resolve({ user_id: 1, first_name: 'Bot', username: 'ppshkin_bot' });
          }),
        }),
    });
    const [me] = await runSmoke(
      {
        checks: ['max'],
        strict: false,
        env: { MAX_BOT_TOKEN: 'max-token-0123', MAX_BOT_USERNAME: 'ppshkin_bot' },
      },
      deps,
    );

    expect(me).toMatchObject({ name: 'max.me', status: 'ok', durationMs: 1_250 });
  });

  it('turns a failed group setup into one failed result and runs the other groups', async () => {
    const readFile = vi.fn(() => Promise.reject(new Error('EACCES: permission denied')));
    const results = await runSmoke(
      { checks: ['site', 'api'], strict: false, env: {} },
      fakeSmokeDependencies({ readFile }),
    );

    expect(results.map(({ name, status }) => [name, status])).toEqual([
      ['site.health', 'skipped'],
      ['site.miniapp', 'skipped'],
      ['site.docs', 'skipped'],
      ['api', 'failed'],
    ]);
    expect(results[3]?.details).toBe('EACCES: permission denied');
  });

  it('hands the clients a fetch that delegates to the injected one and keeps the caller signal', async () => {
    const caller = new AbortController();
    const deps = fakeSmokeDependencies({
      fetch: vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}'))),
      createMaxApi: ({ fetch }) =>
        fakeMaxApi({
          getMe: vi.fn(async () => {
            await fetch?.('https://max.example/me', { signal: caller.signal });
            return { user_id: 1, first_name: 'Bot', username: 'ppshkin_bot' };
          }),
        }),
    });
    await runSmoke(
      {
        checks: ['max'],
        strict: false,
        env: { MAX_BOT_TOKEN: 'max-token-0123', MAX_BOT_USERNAME: 'ppshkin_bot' },
      },
      deps,
    );
    const [input, init] = vi.mocked(deps.fetch).mock.calls[0] ?? [];
    const signal = init?.signal ?? undefined;

    expect(input).toBe('https://max.example/me');
    expect(signal?.aborted).toBe(false);
    caller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it('stops sending requests and starting checks once the run reaches its time limit', async () => {
    const deps = fakeSmokeDependencies({
      fetch: vi.fn<typeof fetch>(() => {
        deps.clock.advance(12 * 60_000);
        return Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }));
      }),
    });
    const results = await runSmoke(
      { checks: ['site', 'api'], strict: false, env: { PUBLIC_BASE_URL: 'https://ppshkin.example' } },
      deps,
    );

    expect(results.slice(0, 4).map(({ name, status, details }) => [name, status, details])).toEqual([
      ['site.health', 'failed', 'the run reached its 12 min limit'],
      ['site.miniapp', 'failed', 'not started, the run reached its 12 min limit'],
      ['site.docs', 'failed', 'not started, the run reached its 12 min limit'],
      ['api.health', 'failed', 'not started, the run reached its 12 min limit'],
    ]);
    expect(results.every(({ status }) => status === 'failed')).toBe(true);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it('removes known secrets from the names and details of the results', async () => {
    const env = {
      MAX_BOT_TOKEN: 'max-token-0123456789',
      MAX_BOT_USERNAME: 'ppshkin_bot',
      PUBLIC_BASE_URL: 'https://ppshkin.example',
    };
    const deps = fakeSmokeDependencies({
      createMaxApi: ({ token }) =>
        fakeMaxApi({
          getMe: vi.fn(() => Promise.resolve({ user_id: 1, first_name: 'Bot', username: token })),
          listSubscriptions: vi.fn(() => Promise.reject(new Error(`rejected ${token} twice: ${token}`))),
        }),
    });
    const results = await runSmoke({ checks: ['max'], strict: false, env }, deps);

    expect(results.map(({ details }) => details)).toEqual([
      'username is [redacted], MAX_BOT_USERNAME is ppshkin_bot',
      'rejected [redacted] twice: [redacted]',
    ]);
  });
});
