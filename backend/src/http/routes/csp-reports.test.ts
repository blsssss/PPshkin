import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp } from '../../../test/services.ts';

const PATH = '/api/v1/csp-reports';

let app: FastifyInstance | undefined;

async function start() {
  app = await buildTestApp({ env: { RATE_LIMIT_PER_MINUTE: '1000' } });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const legacyReport = {
  'csp-report': {
    'document-uri': 'https://ppshkin.example/diary?token=secret',
    'effective-directive': 'script-src-elem',
    'violated-directive': 'script-src-elem',
    'blocked-uri': 'https://evil.example/x.js?session=secret#frag',
  },
};

const reportingApiReports = [
  {
    type: 'csp-violation',
    url: 'https://ppshkin.example/',
    body: { effectiveDirective: 'img-src', blockedURL: 'https://cdn.example/a.png?u=1' },
  },
  { type: 'deprecation', body: { id: 'x' } },
];

function post(instance: FastifyInstance, payload: string, contentType: string, ip = '203.0.113.7') {
  return instance.inject({
    method: 'POST',
    url: PATH,
    headers: { 'content-type': contentType },
    payload,
    remoteAddress: ip,
  });
}

async function metrics(instance: FastifyInstance) {
  return (await instance.inject({ method: 'GET', url: '/metrics' })).body;
}

describe('POST /api/v1/csp-reports', () => {
  it('accepts a report-uri report without auth and counts it by directive', async () => {
    const instance = await start();
    const response = await post(instance, JSON.stringify(legacyReport), 'application/csp-report');
    expect(response.statusCode).toBe(204);
    expectContract(response, 'POST', PATH);
    expect(await metrics(instance)).toContain(
      'ppshkin_csp_violations_total{directive="script-src-elem"} 1\n',
    );
  });

  it('accepts Reporting API batches and counts only CSP violations', async () => {
    const instance = await start();
    const response = await post(instance, JSON.stringify(reportingApiReports), 'application/reports+json');
    expect(response.statusCode).toBe(204);
    expectContract(response, 'POST', PATH);
    const body = await metrics(instance);
    expect(body).toContain('ppshkin_csp_violations_total{directive="img-src"} 1\n');
    expect(body).not.toContain('deprecation');
  });

  it('accepts malformed reports and an invalid token without counting anything', async () => {
    const instance = await start();
    const response = await instance.inject({
      method: 'POST',
      url: PATH,
      headers: { 'content-type': 'application/csp-report', ...bearer('nope') },
      payload: '{not json',
    });
    expect(response.statusCode).toBe(204);
    expectContract(response, 'POST', PATH);
    expect(await metrics(instance)).not.toMatch(/ppshkin_csp_violations_total\{/);
  });

  it('rejects a body larger than 8 KB', async () => {
    const instance = await start();
    const padded = { 'csp-report': { ...legacyReport['csp-report'], 'script-sample': 'x'.repeat(8 * 1024) } };
    const response = await post(instance, JSON.stringify(padded), 'application/csp-report');
    expect(response.statusCode).toBe(413);
    expectContract(response, 'POST', PATH);
    expect(response.json()).toMatchObject({ code: 'report_too_large' });
  });

  it('rejects other content types', async () => {
    const instance = await start();
    const response = await post(instance, JSON.stringify(legacyReport), 'application/json');
    expect(response.statusCode).toBe(415);
    expectContract(response, 'POST', PATH);
    expect(response.json()).toMatchObject({ code: 'unsupported_report_type' });
  });

  it('limits every IP to 30 reports a minute', async () => {
    const instance = await start();
    for (let index = 0; index < 30; index += 1) {
      expect((await post(instance, JSON.stringify(legacyReport), 'application/csp-report')).statusCode).toBe(
        204,
      );
    }
    const limited = await post(instance, JSON.stringify(legacyReport), 'application/csp-report');
    expect(limited.statusCode).toBe(429);
    expectContract(limited, 'POST', PATH);
    expect(limited.json()).toMatchObject({ code: 'rate_limited' });
    expect(limited.headers['retry-after']).toBeDefined();

    const other = await post(instance, JSON.stringify(legacyReport), 'application/csp-report', '203.0.113.8');
    expect(other.statusCode).toBe(204);
  });
});
