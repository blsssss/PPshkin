import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp } from '../../../test/services.ts';
import { buildReport, type ReportData } from '../../domain/reports.ts';
import type { ReportsService } from '../../services/reports.ts';
import { badRequest, conflict, notFound, unavailable, unprocessable } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const owner = bearer('venue-token');
const ACTOR = { userId: 202 };
const DAY = '/api/v1/venue/reports/day';
const PERIOD = '/api/v1/venue/reports';
const CLOSEOUT = '/api/v1/venue/deals/21/closeout';
const CLOSEOUT_PATH = '/api/v1/venue/deals/{id}/closeout';
const EXPORT = '/api/v1/venue/reports/export';

const report: ReportData = buildReport({
  from: '2026-10-18',
  to: '2026-10-18',
  timezone: 'Europe/Moscow',
  newGuests: 1,
  deals: [
    {
      dealId: 21,
      date: '2026-10-18',
      menuItemId: 11,
      itemName: 'Круассан',
      listPriceRub: 200,
      dealPriceRub: 120,
      source: 'manual',
      listed: 10,
      soldViaApp: 4,
      reserved: 0,
      revenueRub: 480,
      writtenOff: null,
      finished: true,
    },
  ],
});

const closeout = {
  dealId: 21,
  writtenOff: 3,
  closedAt: new Date('2026-10-18T19:30:00Z'),
  closedBy: 'Анна',
  channel: 'miniapp' as const,
  date: '2026-10-18',
};

async function appWith(reports: Partial<ReportsService> = {}) {
  app = await buildTestApp({
    services: {
      reports: {
        day: () => Promise.resolve(report),
        period: () => Promise.resolve(report),
        closeOut: () => Promise.resolve(closeout),
        exportToChat: () => Promise.resolve(),
        build: () => Promise.resolve(report),
        file: () => Promise.reject(new Error('not used')),
        queueDayClose: () => Promise.resolve(0),
        queueWeekly: () => Promise.resolve(0),
        venuesWithNotClosedStreak: () => Promise.resolve([]),
        ...reports,
      },
    },
  });
  return app;
}

describe('venue report routes', () => {
  it('require authentication', async () => {
    const server = await appWith();
    for (const [method, url] of [
      ['GET', DAY],
      ['GET', `${PERIOD}?from=2026-10-12&to=2026-10-18`],
      ['PUT', CLOSEOUT],
      ['POST', EXPORT],
    ] as const) {
      const response = await server.inject({ method, url });
      expect(response.statusCode, url).toBe(401);
      expectContract(response, method, url === CLOSEOUT ? CLOSEOUT_PATH : (url.split('?')[0] ?? url));
    }
  });

  it('returns the day report for the date and the venue', async () => {
    const day = vi.fn<ReportsService['day']>(() => Promise.resolve(report));
    const server = await appWith({ day });
    const response = await server.inject({
      method: 'GET',
      url: `${DAY}?date=2026-10-18&venueId=7`,
      headers: owner,
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', DAY);
    expect(day).toHaveBeenCalledWith({ ...ACTOR, venueId: 7 }, '2026-10-18');
    expect(response.json()).toMatchObject({
      listed: 10,
      soldViaApp: 4,
      notClosed: 1,
      rows: [{ dealId: 21, itemName: 'Круассан', writtenOff: null, unaccounted: null }],
    });
    expect(response.json<{ rows: object[] }>().rows[0]).not.toHaveProperty('finished');
  });

  it('returns the period report and validates the dates', async () => {
    const period = vi.fn<ReportsService['period']>(() => Promise.resolve(report));
    const server = await appWith({ period });
    const ok = await server.inject({
      method: 'GET',
      url: `${PERIOD}?from=2026-10-12&to=2026-10-18`,
      headers: owner,
    });
    expect(ok.statusCode).toBe(200);
    expectContract(ok, 'GET', PERIOD);
    expect(period).toHaveBeenCalledWith(ACTOR, { from: '2026-10-12', to: '2026-10-18' });
    for (const query of ['', 'from=2026-10-12', 'from=2026-02-30&to=2026-10-18']) {
      const bad = await server.inject({ method: 'GET', url: `${PERIOD}?${query}`, headers: owner });
      expect(bad.statusCode, query).toBe(400);
      expectContract(bad, 'GET', PERIOD);
      expect(bad.json()).toMatchObject({ code: 'validation_failed' });
    }
  });

  it('passes the period error of the service through', async () => {
    const server = await appWith({
      period: () => Promise.reject(badRequest('invalid_period', 'from must not be later than to')),
    });
    const response = await server.inject({
      method: 'GET',
      url: `${PERIOD}?from=2026-10-18&to=2026-10-12`,
      headers: owner,
    });
    expect(response.statusCode).toBe(400);
    expectContract(response, 'GET', PERIOD);
    expect(response.json()).toMatchObject({ code: 'invalid_period' });
  });

  it('marks the write-off', async () => {
    const closeOut = vi.fn<ReportsService['closeOut']>(() => Promise.resolve(closeout));
    const server = await appWith({ closeOut });
    const response = await server.inject({
      method: 'PUT',
      url: CLOSEOUT,
      headers: owner,
      payload: { writtenOff: 3 },
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'PUT', CLOSEOUT_PATH);
    expect(closeOut).toHaveBeenCalledWith(ACTOR, 21, 3, 'miniapp');
    expect(response.json()).toEqual({
      dealId: 21,
      writtenOff: 3,
      closedAt: '2026-10-18T19:30:00.000Z',
      closedBy: 'Анна',
      channel: 'miniapp',
    });
  });

  it.each([{ writtenOff: -1 }, { writtenOff: 1001 }, { writtenOff: 1.5 }, { writtenOff: '2' }, {}])(
    'rejects the write-off %j',
    async (payload) => {
      const closeOut = vi.fn<ReportsService['closeOut']>();
      const server = await appWith({ closeOut });
      const response = await server.inject({ method: 'PUT', url: CLOSEOUT, headers: owner, payload });
      expect(response.statusCode).toBe(400);
      expectContract(response, 'PUT', CLOSEOUT_PATH);
      expect(closeOut).not.toHaveBeenCalled();
    },
  );

  it.each([
    [404, 'deal_not_found', notFound('deal_not_found', 'Deal not found')],
    [409, 'deal_not_finished', conflict('deal_not_finished', 'The deal is still running')],
    [409, 'closeout_locked', conflict('closeout_locked', 'Locked')],
    [422, 'writeoff_too_large', unprocessable('writeoff_too_large', 'Too large')],
  ])('answers %i %s', async (status, code, error) => {
    const server = await appWith({ closeOut: () => Promise.reject(error) });
    const response = await server.inject({
      method: 'PUT',
      url: CLOSEOUT,
      headers: owner,
      payload: { writtenOff: 3 },
    });
    expect(response.statusCode).toBe(status);
    expectContract(response, 'PUT', CLOSEOUT_PATH);
    expect(response.json()).toMatchObject({ code });
  });

  it('accepts an export and answers 202', async () => {
    const exportToChat = vi.fn<ReportsService['exportToChat']>(() => Promise.resolve());
    const server = await appWith({ exportToChat });
    const response = await server.inject({
      method: 'POST',
      url: EXPORT,
      headers: owner,
      payload: { from: '2026-10-12', to: '2026-10-18', format: 'pdf' },
    });
    expect(response.statusCode).toBe(202);
    expectContract(response, 'POST', EXPORT);
    expect(response.json()).toEqual({ status: 'sending' });
    expect(exportToChat).toHaveBeenCalledWith(ACTOR, { from: '2026-10-12', to: '2026-10-18' }, 'pdf');
  });

  it('validates the export and reports an unavailable bot', async () => {
    const server = await appWith({
      exportToChat: () => Promise.reject(unavailable('messenger_unavailable', 'The bot is not running')),
    });
    const bad = await server.inject({
      method: 'POST',
      url: EXPORT,
      headers: owner,
      payload: { from: '2026-10-12', to: '2026-10-18', format: 'xlsx' },
    });
    expect(bad.statusCode).toBe(400);
    expectContract(bad, 'POST', EXPORT);
    const down = await server.inject({
      method: 'POST',
      url: EXPORT,
      headers: owner,
      payload: { from: '2026-10-12', to: '2026-10-18', format: 'csv' },
    });
    expect(down.statusCode).toBe(503);
    expectContract(down, 'POST', EXPORT);
    expect(down.json()).toMatchObject({ code: 'messenger_unavailable' });
  });

  it('limits exports to five a minute', async () => {
    const server = await appWith();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await server.inject({
        method: 'POST',
        url: EXPORT,
        headers: owner,
        payload: { from: '2026-10-12', to: '2026-10-18', format: 'csv' },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
  });
});
