import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp } from '../../../test/services.ts';
import type { AuditService } from '../../services/audit.ts';
import { notFound } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const PAGE = {
  items: [
    {
      id: 7,
      action: 'booking.redeem',
      actor: { userId: 202, name: 'Ильдар', role: 'owner' as const },
      target: { type: 'booking', id: 31 },
      details: { code: 'K7MP4X', priceRub: 130, channel: 'bot' },
      createdAt: new Date('2026-09-25T10:00:00Z'),
    },
    {
      id: 6,
      action: 'deal.cancel',
      actor: null,
      target: { type: 'deal', id: 21 },
      details: { channel: 'miniapp' },
      createdAt: new Date('2026-09-25T09:00:00Z'),
    },
  ],
  nextCursor: '6',
};

async function start(list: AuditService['list']) {
  app = await buildTestApp({ services: { audit: { list } } });
  return app;
}

describe('GET /api/v1/venue/audit', () => {
  it('returns a page of the audit log of the caller venue', async () => {
    const list = vi.fn<AuditService['list']>(() => Promise.resolve(PAGE));
    const instance = await start(list);

    const response = await instance.inject({
      method: 'GET',
      url: '/api/v1/venue/audit?from=2026-09-20&to=2026-09-25&cursor=40',
      headers: bearer('venue-token'),
    });

    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/venue/audit');
    expect(response.json()).toEqual({
      items: [
        { ...PAGE.items[0], createdAt: '2026-09-25T10:00:00.000Z' },
        { ...PAGE.items[1], createdAt: '2026-09-25T09:00:00.000Z' },
      ],
      nextCursor: '6',
    });
    expect(list).toHaveBeenCalledWith(
      { userId: 202 },
      { from: '2026-09-20', to: '2026-09-25', cursor: '40' },
    );
  });

  it.each(['from=20-09-2026', 'to=yesterday', 'cursor=abc', 'cursor=0'])(
    'rejects %s with 400',
    async (query) => {
      const list = vi.fn<AuditService['list']>(() => Promise.resolve(PAGE));
      const instance = await start(list);

      const response = await instance.inject({
        method: 'GET',
        url: `/api/v1/venue/audit?${query}`,
        headers: bearer('venue-token'),
      });

      expect(response.statusCode).toBe(400);
      expectContract(response, 'GET', '/api/v1/venue/audit');
      expect(list).not.toHaveBeenCalled();
    },
  );

  it('answers 404 without a venue and 401 without a token', async () => {
    const instance = await start(() => Promise.reject(notFound('venue_not_found', 'Venue not found')));

    const missing = await instance.inject({
      method: 'GET',
      url: '/api/v1/venue/audit',
      headers: bearer('guest-token'),
    });
    expect(missing.statusCode).toBe(404);
    expectContract(missing, 'GET', '/api/v1/venue/audit');

    const anonymous = await instance.inject({ method: 'GET', url: '/api/v1/venue/audit' });
    expect(anonymous.statusCode).toBe(401);
    expectContract(anonymous, 'GET', '/api/v1/venue/audit');
  });
});
