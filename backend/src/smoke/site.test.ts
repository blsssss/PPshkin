import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { fakeSmokeDependencies, jsonResponse, routedFetch } from '../../test/smoke.ts';
import { findRepoFile } from './data-api.ts';
import { runSmoke } from './run.ts';

const BASE = 'https://ppshkin.example';
const BRIDGE = '<script src="https://st.max.ru/js/max-web-app.js"></script>';
const committedVersion = (
  parse(readFileSync(findRepoFile('openapi.yaml'), 'utf8')) as { info: { version: string } }
).info.version;

const html = (body: string, status = 200) =>
  new Response(`<!doctype html><html><head>${body}</head></html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

const healthy = {
  [`${BASE}/health`]: () => jsonResponse({ status: 'ok' }),
  [`${BASE}/ready`]: () => jsonResponse({ status: 'ready' }),
  [`${BASE}/`]: () => html(BRIDGE),
  [`${BASE}/docs/json`]: () => jsonResponse({ openapi: '3.1.0', info: { version: committedVersion } }),
};

async function runSite(
  routes: Record<string, () => Response> = healthy,
  env: Record<string, string | undefined> = { PUBLIC_BASE_URL: BASE },
) {
  const fetch = routedFetch(routes);
  const results = await runSmoke({ checks: ['site'], strict: false, env }, fakeSmokeDependencies({ fetch }));
  const byName = (name: string) => results.find((result) => result.name === name);
  return {
    fetch,
    results,
    health: byName('site.health'),
    miniapp: byName('site.miniapp'),
    docs: byName('site.docs'),
  };
}

describe('site checks', () => {
  it('accepts a healthy site with the mini app and the committed API version', async () => {
    const { results, fetch } = await runSite();

    expect(results.map(({ name, status, details }) => [name, status, details])).toEqual([
      ['site.health', 'ok', '/health 200, /ready 200'],
      ['site.miniapp', 'ok', '200 text/html, loads https://st.max.ru/js/max-web-app.js'],
      ['site.docs', 'ok', `OpenAPI 3.1.0, info.version ${committedVersion}`],
    ]);
    for (const [, init] of fetch.mock.calls) {
      expect(init?.redirect).toBe('manual');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('ignores a trailing slash in PUBLIC_BASE_URL', async () => {
    const { results } = await runSite(healthy, { PUBLIC_BASE_URL: `${BASE}/` });

    expect(results.map(({ status }) => status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('fails site.health when /ready is not 200', async () => {
    const { health } = await runSite({
      ...healthy,
      [`${BASE}/ready`]: () => jsonResponse({ status: 'not_ready' }, 503),
    });

    expect(health).toMatchObject({ status: 'failed', details: '/health 200, /ready 503, expected 200' });
  });

  it('fails site.miniapp when the page does not load the MAX Bridge script', async () => {
    const { miniapp } = await runSite({
      ...healthy,
      [`${BASE}/`]: () => html('<script src="/assets/index.js"></script>'),
    });

    expect(miniapp).toMatchObject({
      status: 'failed',
      details: 'the page does not load https://st.max.ru/js/max-web-app.js',
    });
  });

  it.each([
    ['a 404 page', () => html(BRIDGE, 404), 'status 404 with text/html, expected 200 text/html'],
    [
      'a JSON answer',
      () => jsonResponse({ page: BRIDGE }),
      'status 200 with application/json, expected 200 text/html',
    ],
    [
      'an answer without a type',
      () => new Response(null, { status: 502 }),
      'status 502 with no content type',
    ],
  ])('fails site.miniapp for %s', async (_label, route, details) => {
    const { miniapp } = await runSite({ ...healthy, [`${BASE}/`]: route });

    expect(miniapp?.status).toBe('failed');
    expect(miniapp?.details).toContain(details);
  });

  it('fails site.docs when the served info.version differs from openapi.yaml', async () => {
    const { docs } = await runSite({
      ...healthy,
      [`${BASE}/docs/json`]: () => jsonResponse({ openapi: '3.1.0', info: { version: '0.9.0' } }),
    });

    expect(docs).toMatchObject({
      status: 'failed',
      details: `info.version is 0.9.0, openapi.yaml has ${committedVersion}`,
    });
  });

  it.each([
    ['a 404', () => jsonResponse({ code: 'not_found' }, 404), 'status 404, expected 200'],
    ['an HTML page', () => html(BRIDGE), 'status 200 with a body that is not JSON'],
    [
      'a document without info',
      () => jsonResponse({ openapi: '3.1.0' }),
      'the answer is not an OpenAPI 3 document',
    ],
  ])('fails site.docs for %s', async (_label, route, details) => {
    const { docs } = await runSite({ ...healthy, [`${BASE}/docs/json`]: route });

    expect(docs).toMatchObject({ status: 'failed', details });
  });

  it.each([
    [
      { PUBLIC_BASE_URL: 'http://ppshkin.example' },
      'PUBLIC_BASE_URL is not an https URL, so the certificate cannot be checked',
    ],
    [{ PUBLIC_BASE_URL: 'ppshkin.example' }, 'PUBLIC_BASE_URL is not a URL'],
    [
      { PUBLIC_BASE_URL: BASE, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      'NODE_TLS_REJECT_UNAUTHORIZED=0 turns certificate checks off',
    ],
  ])('fails every site check without a verified certificate for %j', async (env, details) => {
    const { results, fetch } = await runSite(healthy, env);

    expect(results.map(({ status }) => status)).toEqual(['failed', 'failed', 'failed']);
    expect(results.every((result) => result.details === details)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports network errors with their codes', async () => {
    const expired = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new TypeError('fetch failed', { cause: expired })),
    );
    const results = await runSmoke(
      { checks: ['site'], strict: false, env: { PUBLIC_BASE_URL: BASE } },
      fakeSmokeDependencies({ fetch }),
    );

    expect(results.map(({ status, details }) => [status, details])).toEqual(
      Array.from({ length: 3 }, () => ['failed', 'fetch failed: certificate has expired (CERT_HAS_EXPIRED)']),
    );
  });

  it('skips the site checks without PUBLIC_BASE_URL and fails them under --strict', async () => {
    const deps = fakeSmokeDependencies();
    const skipped = await runSmoke({ checks: ['site'], strict: false, env: {} }, deps);
    const failed = await runSmoke({ checks: ['site'], strict: true, env: { PUBLIC_BASE_URL: '' } }, deps);

    expect(skipped.map(({ status, details }) => [status, details])).toEqual(
      Array.from({ length: 3 }, () => ['skipped', 'PUBLIC_BASE_URL is not set']),
    );
    expect(failed.map(({ status }) => status)).toEqual(['failed', 'failed', 'failed']);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
