import { describe, expect, it, vi } from 'vitest';
import { fakeMaxApi } from '../../test/max-api.ts';
import { fakeSmokeDependencies } from '../../test/smoke.ts';
import type { MaxApi } from '../integrations/max/api.ts';
import { MaxApiError } from '../integrations/max/errors.ts';
import type { MaxSubscription } from '../integrations/max/types.ts';
import { MAX_UPDATE_TYPES } from '../integrations/max/updates.ts';
import { runSmoke } from './run.ts';

const TOKEN = 'max-token-0123456789abcdef';
const ENV = {
  MAX_BOT_TOKEN: TOKEN,
  MAX_BOT_USERNAME: 'ppshkin_bot',
  PUBLIC_BASE_URL: 'https://ppshkin.example',
};
const WEBHOOK_URL = 'https://ppshkin.example/max/webhook';
const BOT = { user_id: 7, first_name: 'ППшкин', username: 'ppshkin_bot' };

const subscription = (
  url: string,
  updateTypes: string[] | null = [...MAX_UPDATE_TYPES],
): MaxSubscription => ({
  url,
  time: 1,
  update_types: updateTypes,
});

function readOnlyApi(overrides: Partial<MaxApi> = {}): MaxApi {
  return fakeMaxApi({
    getMe: vi.fn(() => Promise.resolve(BOT)),
    listSubscriptions: vi.fn(() => Promise.resolve([subscription(WEBHOOK_URL)])),
    ...overrides,
  });
}

async function runMax(api: MaxApi, env: Record<string, string | undefined> = ENV, strict = false) {
  const createMaxApi = vi.fn(() => api);
  const deps = fakeSmokeDependencies({ createMaxApi });
  const results = await runSmoke({ checks: ['max'], strict, env }, deps);
  expect(api.subscribe).not.toHaveBeenCalled();
  expect(api.unsubscribe).not.toHaveBeenCalled();
  expect(api.getUpdates).not.toHaveBeenCalled();
  const byName = (name: string) => results.find((result) => result.name === name);
  return { results, createMaxApi, deps, me: byName('max.me'), webhook: byName('max.webhook') };
}

describe('max checks', () => {
  it('accepts the bot whose username is MAX_BOT_USERNAME and a complete webhook subscription', async () => {
    const api = readOnlyApi();
    const { results, createMaxApi } = await runMax(api);

    expect(results).toEqual([
      {
        name: 'max.me',
        status: 'ok',
        durationMs: 0,
        details: 'username ppshkin_bot, answered over TLS by platform-api2.max.ru',
      },
      {
        name: 'max.webhook',
        status: 'ok',
        durationMs: 0,
        details: `${WEBHOOK_URL} receives bot_started, message_created, message_callback, bot_stopped`,
      },
    ]);
    expect(createMaxApi).toHaveBeenCalledWith({
      token: TOKEN,
      baseUrl: 'https://platform-api2.max.ru',
      fetch: expect.any(Function) as typeof fetch,
    });
    expect(api.getMe).toHaveBeenCalledTimes(1);
    expect(api.listSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('fails max.me when MAX answers with another username', async () => {
    const { me } = await runMax(
      readOnlyApi({ getMe: vi.fn(() => Promise.resolve({ ...BOT, username: 'other_bot' })) }),
    );

    expect(me).toMatchObject({
      status: 'failed',
      details: 'username is other_bot, MAX_BOT_USERNAME is ppshkin_bot',
    });
  });

  it('takes MAX_API_BASE_URL from the environment', async () => {
    const { me, createMaxApi } = await runMax(readOnlyApi(), {
      ...ENV,
      MAX_API_BASE_URL: 'https://max.example/bot',
    });

    expect(me).toMatchObject({
      status: 'ok',
      details: 'username ppshkin_bot, answered over TLS by max.example',
    });
    expect(createMaxApi).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://max.example/bot' }),
    );
  });

  it.each([
    [
      'an http MAX_API_BASE_URL',
      { MAX_API_BASE_URL: 'http://127.0.0.1:8080' },
      'MAX_API_BASE_URL is not an https URL',
    ],
    [
      'certificate checks turned off',
      { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      'NODE_TLS_REJECT_UNAUTHORIZED=0',
    ],
    ['a malformed MAX_API_BASE_URL', { MAX_API_BASE_URL: 'platform-api2' }, 'MAX_API_BASE_URL: Invalid URL'],
  ])('fails max.me without a verified TLS connection: %s', async (_label, extra, details) => {
    const api = readOnlyApi();
    const { me } = await runMax(api, { ...ENV, ...extra });

    expect(me?.status).toBe('failed');
    expect(me?.details).toContain(details);
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it('finds the subscription among others and ignores a trailing slash in PUBLIC_BASE_URL', async () => {
    const { webhook } = await runMax(
      readOnlyApi({
        listSubscriptions: vi.fn(() =>
          Promise.resolve([
            subscription('https://old.example/max/webhook', []),
            subscription(WEBHOOK_URL, [...MAX_UPDATE_TYPES, 'message_edited']),
          ]),
        ),
      }),
      { ...ENV, PUBLIC_BASE_URL: 'https://ppshkin.example/' },
    );

    expect(webhook?.status).toBe('ok');
  });

  it('fails max.webhook without a subscription for the webhook address', async () => {
    const { webhook } = await runMax(
      readOnlyApi({
        listSubscriptions: vi.fn(() => Promise.resolve([subscription(`${WEBHOOK_URL}/`)])),
      }),
    );

    expect(webhook).toMatchObject({
      status: 'failed',
      details: `no subscription for ${WEBHOOK_URL} among 1 subscriptions`,
    });
  });

  it.each<[string, string[] | null, string]>([
    ['some of the types', ['bot_started', 'message_created'], 'message_callback, bot_stopped'],
    ['no types', [], 'bot_started, message_created, message_callback, bot_stopped'],
    ['types set to null', null, 'bot_started, message_created, message_callback, bot_stopped'],
  ])('fails max.webhook for a subscription with %s', async (_label, updateTypes, lacking) => {
    const { webhook } = await runMax(
      readOnlyApi({
        listSubscriptions: vi.fn(() => Promise.resolve([subscription(WEBHOOK_URL, updateTypes)])),
      }),
    );

    expect(webhook).toMatchObject({
      status: 'failed',
      details: `the subscription for ${WEBHOOK_URL} lacks ${lacking}`,
    });
  });

  it('reports MAX API errors without calling other methods', async () => {
    const failure = new MaxApiError(401, 'verify.token', 'Invalid access_token');
    const { me, webhook } = await runMax(
      readOnlyApi({
        getMe: vi.fn(() => Promise.reject(failure)),
        listSubscriptions: vi.fn(() => Promise.reject(failure)),
      }),
    );

    expect(me).toMatchObject({ status: 'failed', details: 'Invalid access_token (verify.token)' });
    expect(webhook).toMatchObject({ status: 'failed', details: 'Invalid access_token (verify.token)' });
  });

  it('points at NODE_EXTRA_CA_CERTS when the certificate of the Ministry is not trusted', async () => {
    const tls = Object.assign(new Error('unable to get local issuer certificate'), {
      code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    });
    const failure = new MaxApiError(0, 'network.error', 'MAX request failed without a response', {
      cause: new TypeError('fetch failed', { cause: tls }),
    });
    const { me } = await runMax(readOnlyApi({ getMe: vi.fn(() => Promise.reject(failure)) }));

    expect(me?.status).toBe('failed');
    expect(me?.details).toBe(
      'MAX request failed without a response: fetch failed: unable to get local issuer certificate ' +
        '(network.error, UNABLE_TO_GET_ISSUER_CERT_LOCALLY); the certificate of the Ministry of Digital Development ' +
        'is not trusted: set NODE_EXTRA_CA_CERTS to backend/certs/russian_trusted_root_ca.pem',
    );
  });

  it('does not mention the certificate for other network errors', async () => {
    const failure = new MaxApiError(0, 'network.error', 'MAX request failed without a response', {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND platform-api2.max.ru'), { code: 'ENOTFOUND' }),
    });
    const { me } = await runMax(readOnlyApi({ getMe: vi.fn(() => Promise.reject(failure)) }));

    expect(me?.details).toBe(
      'MAX request failed without a response: getaddrinfo ENOTFOUND platform-api2.max.ru (network.error, ENOTFOUND)',
    );
  });

  it('trims the variables before comparing the username and building the webhook address', async () => {
    const { results, createMaxApi } = await runMax(readOnlyApi(), {
      MAX_BOT_TOKEN: `${TOKEN}\n`,
      MAX_BOT_USERNAME: ' ppshkin_bot ',
      PUBLIC_BASE_URL: 'https://ppshkin.example/\n',
    });

    expect(results.map(({ status }) => status)).toEqual(['ok', 'ok']);
    expect(createMaxApi).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }));
  });

  it('skips the checks without their variables and fails them under --strict', async () => {
    const api = readOnlyApi();
    const skipped = await runMax(api, { MAX_BOT_TOKEN: ' ' });
    const failed = await runMax(api, { PUBLIC_BASE_URL: ENV.PUBLIC_BASE_URL }, true);

    expect(skipped.results).toEqual([
      {
        name: 'max.me',
        status: 'skipped',
        durationMs: 0,
        details: 'MAX_BOT_TOKEN, MAX_BOT_USERNAME are not set',
      },
      {
        name: 'max.webhook',
        status: 'skipped',
        durationMs: 0,
        details: 'MAX_BOT_TOKEN, PUBLIC_BASE_URL are not set',
      },
    ]);
    expect(failed.results.map(({ status, details }) => [status, details])).toEqual([
      ['failed', 'MAX_BOT_TOKEN, MAX_BOT_USERNAME are not set'],
      ['failed', 'MAX_BOT_TOKEN is not set'],
    ]);
    expect(skipped.createMaxApi).not.toHaveBeenCalled();
    expect(failed.createMaxApi).not.toHaveBeenCalled();
  });
});
