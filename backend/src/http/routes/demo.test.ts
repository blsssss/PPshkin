import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp } from '../../../test/services.ts';
import { sampleVenue } from '../../../test/venues.ts';
import type { DemoService } from '../../services/demo.ts';
import { conflict, forbidden, notFound, type AppError } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const CLAIM = '/api/v1/venue/demo';
const FILL = '/api/v1/diary/demo';
const reviewer = bearer('guest-token');
const REVIEWER_ID = 101;
const copy = { ...sampleVenue, id: 12, ownerId: REVIEWER_ID, isDemo: true };

function demoStub(overrides: Partial<DemoService> = {}): DemoService {
  return {
    enabled: true,
    seed: () => Promise.reject(new Error('seed is not expected')),
    refresh: () => Promise.reject(new Error('refresh is not expected')),
    claimVenue: () => Promise.resolve(copy),
    fillDiary: () => Promise.resolve({ mealsAdded: 26, fromDate: '2026-09-21', toDate: '2026-09-25' }),
    ...overrides,
  };
}

describe('POST /api/v1/venue/demo', () => {
  it('gives the caller a copy of «Зерно» by default', async () => {
    const claimVenue = vi.fn<DemoService['claimVenue']>(() => Promise.resolve(copy));
    app = await buildTestApp({ services: { demo: demoStub({ claimVenue }) } });
    const response = await app.inject({ method: 'POST', url: CLAIM, headers: reviewer, payload: {} });
    expect(response.statusCode).toBe(201);
    expectContract(response, 'POST', CLAIM);
    expect(response.json()).toEqual({
      id: 12,
      name: 'Кофейня «Зерно»',
      address: 'ул. Баумана, 36',
      category: 'coffee',
      location: { lat: 55.7887, lon: 49.1221 },
      opensAt: '08:00',
      closesAt: '22:00',
      timezone: 'Europe/Moscow',
      isDemo: true,
    });
    expect(claimVenue).toHaveBeenCalledWith(REVIEWER_ID, 900001);
  });

  it('copies the requested demo venue', async () => {
    const claimVenue = vi.fn<DemoService['claimVenue']>(() => Promise.resolve(copy));
    app = await buildTestApp({ services: { demo: demoStub({ claimVenue }) } });
    const response = await app.inject({
      method: 'POST',
      url: CLAIM,
      headers: reviewer,
      payload: { sourceVenueId: 900003 },
    });
    expect(response.statusCode).toBe(201);
    expectContract(response, 'POST', CLAIM);
    expect(claimVenue).toHaveBeenCalledWith(REVIEWER_ID, 900003);
  });

  it('requires authentication before validating the body', async () => {
    app = await buildTestApp({ services: { demo: demoStub() } });
    const response = await app.inject({ method: 'POST', url: CLAIM, payload: { sourceVenueId: 'x' } });
    expect(response.statusCode).toBe(401);
    expectContract(response, 'POST', CLAIM);
    expect(response.json()).toMatchObject({ code: 'unauthorized' });
  });

  it('validates the body', async () => {
    const claimVenue = vi.fn<DemoService['claimVenue']>(() => Promise.resolve(copy));
    app = await buildTestApp({ services: { demo: demoStub({ claimVenue }) } });
    for (const payload of [{ sourceVenueId: 0 }, { sourceVenueId: 1.5 }, { sourceVenueId: '900001' }]) {
      const response = await app.inject({ method: 'POST', url: CLAIM, headers: reviewer, payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expectContract(response, 'POST', CLAIM);
      expect(response.json()).toMatchObject({ code: 'validation_failed' });
    }
    const missing = await app.inject({ method: 'POST', url: CLAIM, headers: reviewer });
    expect(missing.statusCode).toBe(400);
    expectContract(missing, 'POST', CLAIM);
    const xml = await app.inject({
      method: 'POST',
      url: CLAIM,
      headers: { ...reviewer, 'content-type': 'application/xml' },
      payload: '<sourceVenueId>900001</sourceVenueId>',
    });
    expect(xml.statusCode).toBe(415);
    expectContract(xml, 'POST', CLAIM);
    const huge = await app.inject({
      method: 'POST',
      url: CLAIM,
      headers: { ...reviewer, 'content-type': 'application/json' },
      payload: JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }),
    });
    expect(huge.statusCode).toBe(413);
    expectContract(huge, 'POST', CLAIM);
    expect(claimVenue).not.toHaveBeenCalled();
  });

  it.each<[string, number, AppError]>([
    ['demo_account', 403, forbidden('demo_account', 'Shared demo accounts cannot do this')],
    ['demo_mode_disabled', 404, notFound('demo_mode_disabled', 'Demo mode is turned off')],
    ['venue_not_found', 404, notFound('venue_not_found', 'There is no demo venue with this id')],
    ['venue_exists', 409, conflict('venue_exists', 'You already have a venue')],
  ])('answers %s with %i', async (code, status, error) => {
    app = await buildTestApp({ services: { demo: demoStub({ claimVenue: () => Promise.reject(error) }) } });
    const response = await app.inject({ method: 'POST', url: CLAIM, headers: reviewer, payload: {} });
    expect(response.statusCode).toBe(status);
    expectContract(response, 'POST', CLAIM);
    expect(response.json()).toMatchObject({ code, status });
  });
});

describe('POST /api/v1/diary/demo', () => {
  it('adds the sample diary', async () => {
    const fillDiary = vi.fn<DemoService['fillDiary']>(() =>
      Promise.resolve({ mealsAdded: 26, fromDate: '2026-09-21', toDate: '2026-09-25' }),
    );
    app = await buildTestApp({ services: { demo: demoStub({ fillDiary }) } });
    const response = await app.inject({ method: 'POST', url: FILL, headers: reviewer });
    expect(response.statusCode).toBe(201);
    expectContract(response, 'POST', FILL);
    expect(response.json()).toEqual({ mealsAdded: 26, fromDate: '2026-09-21', toDate: '2026-09-25' });
    expect(fillDiary).toHaveBeenCalledWith(REVIEWER_ID);
  });

  it('requires authentication', async () => {
    app = await buildTestApp({ services: { demo: demoStub() } });
    const response = await app.inject({ method: 'POST', url: FILL, headers: bearer('expired-token') });
    expect(response.statusCode).toBe(401);
    expectContract(response, 'POST', FILL);
    expect(response.json()).toMatchObject({ code: 'invalid_token' });
  });

  it.each<[string, number, AppError]>([
    ['demo_account', 403, forbidden('demo_account', 'Shared demo accounts cannot do this')],
    ['consent_required', 403, forbidden('consent_required', 'Consent is required')],
    ['demo_mode_disabled', 404, notFound('demo_mode_disabled', 'Demo mode is turned off')],
    ['user_not_found', 404, notFound('user_not_found', 'User not found')],
    ['demo_diary_exists', 409, conflict('demo_diary_exists', 'The sample diary has already been added')],
  ])('answers %s with %i', async (code, status, error) => {
    app = await buildTestApp({ services: { demo: demoStub({ fillDiary: () => Promise.reject(error) }) } });
    const response = await app.inject({ method: 'POST', url: FILL, headers: reviewer });
    expect(response.statusCode).toBe(status);
    expectContract(response, 'POST', FILL);
    expect(response.json()).toMatchObject({ code, status });
  });
});
