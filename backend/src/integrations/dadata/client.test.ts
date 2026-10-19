import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createDadataRegistry, DADATA_FIND_PARTY_URL } from './client.ts';

const API_KEY = 'dadata-secret-key-0123456789';

function fixture(name: string): string {
  return readFileSync(new URL(`../../../test/fixtures/dadata/${name}.json`, import.meta.url), 'utf8');
}

const answer = (name: string, status = 200) =>
  new Response(fixture(name), { status, headers: { 'content-type': 'application/json' } });

function setup(response: () => Promise<Response>, apiKey: string | null = API_KEY) {
  const fetch = vi.fn<typeof globalThis.fetch>(response);
  const logger = { warn: vi.fn() };
  const registry = createDadataRegistry({ apiKey, fetch, logger, timeoutMs: 50 });
  return { registry, fetch, logger };
}

describe('DaData registry', () => {
  it('asks findById/party for the main branch with the token', async () => {
    const { registry, fetch } = setup(() => Promise.resolve(answer('legal')));

    await registry.findByInn('7707083893');

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(DADATA_FIND_PARTY_URL);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Token ${API_KEY}`);
    expect(JSON.parse(init?.body as string)).toEqual({ query: '7707083893', branch_type: 'MAIN', count: 1 });
  });

  it('maps a legal entity', async () => {
    const { registry } = setup(() => Promise.resolve(answer('legal')));

    expect(await registry.findByInn('7707083893')).toEqual({
      status: 'found',
      company: {
        kind: 'legal',
        inn: '7707083893',
        ogrn: '1027700132195',
        kpp: '770701001',
        name: 'ООО "КОФЕЙНЯ ЗЕРНО"',
        address: 'г Москва, ул Тестовая, д 1',
        okved: '56.30',
        status: 'ACTIVE',
        managerName: 'Иванов Иван Иванович',
      },
    });
  });

  it('maps an individual entrepreneur without a KPP and a manager', async () => {
    const { registry } = setup(() => Promise.resolve(answer('individual')));

    expect(await registry.findByInn('500100732259')).toMatchObject({
      status: 'found',
      company: { kind: 'individual', ogrn: '304500116000157', kpp: null, managerName: null, okved: '56.10' },
    });
  });

  it('reports a company that is not active', async () => {
    const { registry } = setup(() => Promise.resolve(answer('liquidated')));

    expect(await registry.findByInn('7707083893')).toMatchObject({
      status: 'found',
      company: { status: 'LIQUIDATED' },
    });
  });

  it('reports an unknown INN', async () => {
    const { registry } = setup(() => Promise.resolve(answer('not-found')));

    expect(await registry.findByInn('7707083893')).toEqual({ status: 'not_found' });
  });

  it('does not call the provider without a key', async () => {
    const { registry, fetch } = setup(() => Promise.resolve(answer('legal')), null);

    expect(await registry.findByInn('7707083893')).toEqual({ status: 'unavailable', reason: 'disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a rejected key as a provider error and keeps the key out of the log', async () => {
    const { registry, logger } = setup(() => Promise.resolve(answer('unauthorized', 401)));

    expect(await registry.findByInn('7707083893')).toEqual({
      status: 'unavailable',
      reason: 'provider_error',
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(API_KEY);
  });

  it('reports the daily limit as exhausted quota', async () => {
    const { registry } = setup(() => Promise.resolve(answer('quota', 429)));

    expect(await registry.findByInn('7707083893')).toEqual({
      status: 'unavailable',
      reason: 'quota_exceeded',
    });
  });

  it('reports a server error as a provider error', async () => {
    const { registry } = setup(() => Promise.resolve(new Response('boom', { status: 502 })));

    expect(await registry.findByInn('7707083893')).toEqual({
      status: 'unavailable',
      reason: 'provider_error',
    });
  });

  it('reports a body that is not JSON as a provider error', async () => {
    const { registry } = setup(() => Promise.resolve(new Response('<html>', { status: 200 })));

    expect(await registry.findByInn('7707083893')).toEqual({
      status: 'unavailable',
      reason: 'provider_error',
    });
  });

  it('reports a company with an unknown registry status as a provider error', async () => {
    const odd = JSON.parse(fixture('legal')) as { suggestions: { data: { state: { status: string } } }[] };
    for (const suggestion of odd.suggestions) suggestion.data.state.status = 'SOMETHING';
    const { registry } = setup(() => Promise.resolve(new Response(JSON.stringify(odd), { status: 200 })));

    expect(await registry.findByInn('7707083893')).toEqual({
      status: 'unavailable',
      reason: 'provider_error',
    });
  });

  it('reports a request that does not finish in time as a timeout', async () => {
    const { registry, logger } = setup(
      () =>
        new Promise((_resolve, reject) =>
          setTimeout(() => {
            reject(new DOMException('slow', 'TimeoutError'));
          }, 5),
        ),
    );

    expect(await registry.findByInn('7707083893')).toEqual({ status: 'unavailable', reason: 'timeout' });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('reports a network failure as a provider error', async () => {
    const { registry } = setup(() => Promise.reject(new TypeError('fetch failed')));

    expect(await registry.findByInn('7707083893')).toEqual({
      status: 'unavailable',
      reason: 'provider_error',
    });
  });
});
