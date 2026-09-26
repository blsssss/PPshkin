import { describe, expect, it, vi } from 'vitest';
import { fakeSmokeDependencies, jsonResponse, requestUrl } from '../../test/smoke.ts';
import { dataApiFile, loadDataApi, type DataApiCheck } from './data-api.ts';
import { runSmoke } from './run.ts';

const BASE = 'https://ppshkin.example';
const GUEST_TOKEN = 'guest-token-0123456789abcdef-secret';
const VENUE_TOKEN = 'venue-token-0123456789abcdef-secret';
const ENV = { PUBLIC_BASE_URL: BASE, DEMO_GUEST_TOKEN: GUEST_TOKEN, DEMO_VENUE_TOKEN: VENUE_TOKEN };

const committed = loadDataApi();

const check = (patch: Partial<DataApiCheck> = {}): DataApiCheck => ({
  id: 'probe',
  title: 'Проверка',
  method: 'GET',
  path: '/api/v1/me',
  role: 'guest',
  params: { path: {}, query: {}, headers: {}, body: null },
  expect: [{ status: 200, contentType: 'application/json', requiredFields: [] }],
  ...patch,
});

const expectFields = (requiredFields: string[]) => [
  { status: 200, contentType: 'application/json', requiredFields },
];

function documentWith(checks: unknown[]): Buffer {
  return Buffer.from(JSON.stringify({ ...committed, checks }));
}

async function runApi(
  checks: DataApiCheck[],
  answer: () => Response,
  env: Record<string, string | undefined> = ENV,
  strict = false,
) {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(answer()));
  const readFile = vi.fn((file: URL) =>
    file.href === dataApiFile().href
      ? Promise.resolve(documentWith(checks))
      : Promise.reject(new Error(`unexpected read of ${file.href}`)),
  );
  const results = await runSmoke(
    { checks: ['api'], strict, env },
    fakeSmokeDependencies({ fetch, readFile }),
  );
  const [call] = fetch.mock.calls;
  const init = call?.[1];
  return {
    results,
    fetch,
    url: call ? requestUrl(call[0]) : undefined,
    headers: new Headers(init?.headers),
    init,
  };
}

describe('api checks', () => {
  it('substitutes the guest token and sends the path, query, headers and JSON body', async () => {
    const { results, url, headers, init } = await runApi(
      [
        check({
          id: 'guest-booking',
          method: 'POST',
          path: '/api/v1/venues/{id}/bookings/{code}',
          params: {
            path: { id: 900002, code: 'A B' },
            query: { lat: 55.7887, limit: 3, open: true },
            headers: { 'x-smoke': 'yes' },
            body: { menuItemId: 910201, note: 'Капучино' },
          },
          expect: [{ status: 201, contentType: 'application/json', requiredFields: ['id', 'code'] }],
        }),
      ],
      () => jsonResponse({ id: 1, code: 'ABC123' }, 201, 'application/json; charset=utf-8'),
      { ...ENV, PUBLIC_BASE_URL: `${BASE}/` },
    );

    expect(results).toEqual([
      {
        name: 'api.guest-booking',
        status: 'ok',
        durationMs: 0,
        details: '201 application/json with id, code',
      },
    ]);
    expect(url).toBe(`${BASE}/api/v1/venues/900002/bookings/A%20B?lat=55.7887&limit=3&open=true`);
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      body: '{"menuItemId":910201,"note":"Капучино"}',
    });
    expect(Object.fromEntries(headers)).toEqual({
      authorization: `Bearer ${GUEST_TOKEN}`,
      'content-type': 'application/json',
      'x-smoke': 'yes',
    });
  });

  it('substitutes the venue token for venue checks', async () => {
    const { headers, init } = await runApi([check({ role: 'venue', path: '/api/v1/venue' })], () =>
      jsonResponse({}),
    );

    expect(headers.get('authorization')).toBe(`Bearer ${VENUE_TOKEN}`);
    expect(init?.body).toBeUndefined();
  });

  it('sends anonymous checks without the Authorization header', async () => {
    const { results, headers } = await runApi(
      [
        check({
          id: 'unauthorized',
          role: 'anonymous',
          expect: [{ status: 401, contentType: 'application/problem+json', requiredFields: ['code'] }],
        }),
      ],
      () => jsonResponse({ code: 'unauthorized' }, 401, 'application/problem+json'),
      { PUBLIC_BASE_URL: BASE },
    );

    expect(results[0]).toMatchObject({ status: 'ok', details: '401 application/problem+json with code' });
    expect(headers.has('authorization')).toBe(false);
  });

  it.each(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000'])(
    'allows plain http for a local stack at %s',
    async (base) => {
      const { results, url } = await runApi([check()], () => jsonResponse({}), {
        ...ENV,
        PUBLIC_BASE_URL: base,
      });

      expect(results[0]?.status).toBe('ok');
      expect(url).toBe(`${base}/api/v1/me`);
    },
  );

  it('refuses plain http outside localhost so that tokens never travel unencrypted', async () => {
    const { results, fetch } = await runApi(
      [check(), check({ id: 'anonymous', role: 'anonymous' })],
      () => jsonResponse({}),
      {
        ...ENV,
        PUBLIC_BASE_URL: 'http://ppshkin.example',
      },
    );

    expect(results.map(({ status, details }) => [status, details])).toEqual(
      Array.from({ length: 2 }, () => [
        'failed',
        'PUBLIC_BASE_URL must be an https URL, plain http is allowed only for localhost',
      ]),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('names PUBLIC_BASE_URL when it is not a URL', async () => {
    const { results, fetch } = await runApi([check()], () => jsonResponse({}), {
      ...ENV,
      PUBLIC_BASE_URL: 'ppshkin.example',
    });

    expect(results[0]).toMatchObject({ status: 'failed', details: 'PUBLIC_BASE_URL is not a URL' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts any expected status', async () => {
    const booking = check({
      expect: [
        { status: 201, contentType: 'application/json', requiredFields: ['id'] },
        { status: 409, contentType: 'application/problem+json', requiredFields: ['code'] },
      ],
    });
    const { results } = await runApi([booking], () =>
      jsonResponse({ code: 'deal_sold_out' }, 409, 'application/problem+json'),
    );

    expect(results[0]).toMatchObject({ status: 'ok', details: '409 application/problem+json with code' });
  });

  it('fails on a status outside expect', async () => {
    const booking = check({
      expect: [
        { status: 201, contentType: 'application/json', requiredFields: [] },
        { status: 409, contentType: 'application/problem+json', requiredFields: [] },
      ],
    });
    const { results } = await runApi([booking], () => jsonResponse({ code: 'internal' }, 500));

    expect(results[0]).toMatchObject({ status: 'failed', details: 'status 500, expected 201 or 409' });
  });

  it.each([
    [
      'another content type',
      () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
      'status 200 with text/html, expected application/json',
    ],
    [
      'problem+json instead of json',
      () => jsonResponse({ code: 'x' }, 200, 'application/problem+json'),
      'status 200 with application/problem+json, expected application/json',
    ],
    [
      'no content type',
      () => new Response(null, { status: 200 }),
      'status 200 with no content type, expected application/json',
    ],
  ])('fails on %s', async (_label, answer, details) => {
    const { results } = await runApi([check()], answer);

    expect(results[0]).toMatchObject({ status: 'failed', details });
  });

  it('fails on a missing nested field', async () => {
    const { results } = await runApi(
      [check({ expect: expectFields(['venue.name', 'venue.location.lat', 'totals.kcal']) })],
      () => jsonResponse({ venue: { name: 'Пенка', location: { lon: 49.1 } }, totals: null }),
    );

    expect(results[0]).toMatchObject({
      status: 'failed',
      details: '200 application/json without venue.location.lat, totals.kcal',
    });
  });

  it('fails on a field missing in one array element', async () => {
    const { results } = await runApi([check({ expect: expectFields(['items[].offerId']) })], () =>
      jsonResponse({ items: [{ offerId: 1 }, { title: 'Эклер' }, { offerId: 3 }] }),
    );

    expect(results[0]).toMatchObject({
      status: 'failed',
      details: '200 application/json without items[1].offerId',
    });
  });

  it('checks fields in nested arrays and lists at most five missing paths', async () => {
    const { results } = await runApi(
      [check({ expect: expectFields(['byDay[].slots[].kcal', 'meals[]']) })],
      () =>
        jsonResponse({
          byDay: [{ slots: [{}, {}, {}] }, { slots: [{}, { kcal: 1 }, {}, {}] }],
          meals: { breakfast: [] },
        }),
    );

    expect(results[0]?.details).toBe(
      '200 application/json without byDay[0].slots[0].kcal, byDay[0].slots[1].kcal, ' +
        'byDay[0].slots[2].kcal, byDay[1].slots[0].kcal, byDay[1].slots[2].kcal and 2 more',
    );
  });

  it('accepts null values, empty arrays and extra fields', async () => {
    const { results } = await runApi(
      [check({ expect: expectFields(['status', 'items[].offerId', 'venue', 'byDay[]']) })],
      () => jsonResponse({ status: 'empty', items: [], venue: null, byDay: [1, 2], extra: true }),
    );

    expect(results[0]?.status).toBe('ok');
  });

  it('fails on a body that is not JSON when fields are required', async () => {
    const { results } = await runApi(
      [check({ expect: expectFields(['id']) })],
      () => new Response('not json', { headers: { 'content-type': 'application/json' } }),
    );

    expect(results[0]).toMatchObject({
      status: 'failed',
      details: 'status 200 with a body that is not JSON',
    });
  });

  it('skips a check without its token and fails it under --strict', async () => {
    const checks = [
      check({ id: 'guest' }),
      check({ id: 'venue', role: 'venue' }),
      check({ id: 'anonymous', role: 'anonymous' }),
    ];
    const env = { PUBLIC_BASE_URL: BASE, DEMO_GUEST_TOKEN: GUEST_TOKEN };
    const skipped = await runApi(checks, () => jsonResponse({}), env);
    const failed = await runApi(checks, () => jsonResponse({}), env, true);

    expect(skipped.results.map(({ name, status, details }) => [name, status, details])).toEqual([
      ['api.guest', 'ok', '200 application/json'],
      ['api.venue', 'skipped', 'DEMO_VENUE_TOKEN is not set'],
      ['api.anonymous', 'ok', '200 application/json'],
    ]);
    expect(failed.results.map(({ status }) => status)).toEqual(['ok', 'failed', 'ok']);
    expect(skipped.fetch).toHaveBeenCalledTimes(2);
  });

  it('turns every check of the committed DATA-API.yaml into an api check', async () => {
    const results = await runSmoke({ checks: ['api'], strict: false, env: {} }, fakeSmokeDependencies());

    expect(results.map(({ name }) => name)).toEqual(committed.checks.map(({ id }) => `api.${id}`));
    expect(
      results.every(({ status, details }) => status === 'skipped' && details.startsWith('PUBLIC_BASE_URL')),
    ).toBe(true);
  });

  it('fails the api group when DATA-API.yaml does not match the schema', async () => {
    const readFile = vi.fn(() => Promise.resolve(Buffer.from('version: "2.0"\n')));
    const results = await runSmoke(
      { checks: ['api'], strict: false, env: ENV },
      fakeSmokeDependencies({ readFile }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'api', status: 'failed' });
    expect(results[0]?.details).toMatch(/^version: .+; solution: /);
    expect(results[0]?.details).not.toContain('\n');
    expect(readFile).toHaveBeenCalledWith(dataApiFile());
  });

  it.each(['literal-token', '${MAX_BOT_TOKEN}', '${SESSION_SECRET}'])(
    'refuses a DATA-API.yaml account with the token %s',
    async (token) => {
      const accounts = committed.accounts.map((account) => ({
        ...account,
        auth: { ...account.auth, token },
      }));
      const readFile = vi.fn(() =>
        Promise.resolve(Buffer.from(JSON.stringify({ ...committed, accounts, checks: [check()] }))),
      );
      const fetch = vi.fn<typeof globalThis.fetch>();
      const results = await runSmoke(
        { checks: ['api'], strict: false, env: { ...ENV, MAX_BOT_TOKEN: 'max-token-0123456789' } },
        fakeSmokeDependencies({ readFile, fetch }),
      );

      expect(results).toEqual([
        {
          name: 'api',
          status: 'failed',
          durationMs: 0,
          details: 'DATA-API.yaml must give the guest token as ${DEMO_GUEST_TOKEN} or ${DEMO_VENUE_TOKEN}',
        },
      ]);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
