import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp, fakeServices } from '../../../test/services.ts';
import { CONSENT_DOCUMENTS } from '../../domain/consents.ts';
import type { ConsentChannel, ConsentKind } from '../../domain/vocabulary.ts';
import type { ConsentsService } from '../../services/consents.ts';
import { conflict, notFound } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function consentsService(overrides: Partial<ConsentsService>): { consents: ConsentsService } {
  return { consents: { ...fakeServices().consents, ...overrides } };
}

describe('GET /api/v1/consents', () => {
  it('lists both documents with the user state', async () => {
    app = await buildTestApp({
      services: consentsService({
        list: () =>
          Promise.resolve([
            { kind: 'personal_data', ...CONSENT_DOCUMENTS.personal_data, granted: false, grantedAt: null },
            {
              kind: 'personalized_offers',
              ...CONSENT_DOCUMENTS.personalized_offers,
              granted: true,
              grantedAt: new Date('2026-09-25T09:00:00Z'),
            },
          ]),
      }),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/consents',
      headers: bearer('guest-token'),
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/consents');
    expect(response.json()).toEqual({
      items: [
        {
          kind: 'personal_data',
          version: '2026-09-25',
          title: 'Согласие на обработку персональных данных',
          text: CONSENT_DOCUMENTS.personal_data.text,
          required: true,
          granted: false,
          grantedAt: null,
        },
        {
          kind: 'personalized_offers',
          version: '2026-09-25',
          title: 'Согласие на персональные предложения',
          text: CONSENT_DOCUMENTS.personalized_offers.text,
          required: false,
          granted: true,
          grantedAt: '2026-09-25T09:00:00.000Z',
        },
      ],
    });
  });

  it('requires authentication', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/consents' });
    expect(response.statusCode).toBe(401);
    expectContract(response, 'GET', '/api/v1/consents');
  });
});

describe('PUT /api/v1/consents/{kind}', () => {
  it('grants a consent from the mini app', async () => {
    const calls: [number, ConsentKind, string, ConsentChannel][] = [];
    app = await buildTestApp({
      services: consentsService({
        grant: (...args) => {
          calls.push(args);
          return Promise.resolve({
            granted: true,
            version: args[2],
            grantedAt: new Date('2026-09-25T09:00:00Z'),
          });
        },
      }),
    });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/consents/personal_data',
      headers: bearer('guest-token'),
      payload: { version: '2026-09-25' },
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'PUT', '/api/v1/consents/{kind}');
    expect(response.json()).toEqual({
      granted: true,
      version: '2026-09-25',
      grantedAt: '2026-09-25T09:00:00.000Z',
    });
    expect(calls).toEqual([[101, 'personal_data', '2026-09-25', 'miniapp']]);
  });

  it('rejects an unknown kind and a missing version', async () => {
    app = await buildTestApp();
    const unknownKind = await app.inject({
      method: 'PUT',
      url: '/api/v1/consents/marketing',
      headers: bearer('guest-token'),
      payload: { version: '2026-09-25' },
    });
    expect(unknownKind.statusCode).toBe(400);
    expectContract(unknownKind, 'PUT', '/api/v1/consents/{kind}');
    expect(unknownKind.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'params.kind' }],
    });

    const noVersion = await app.inject({
      method: 'PUT',
      url: '/api/v1/consents/personal_data',
      headers: bearer('guest-token'),
      payload: {},
    });
    expect(noVersion.statusCode).toBe(400);
    expect(noVersion.json()).toMatchObject({ errors: [{ path: 'body.version' }] });
  });

  it('reports an outdated version and a deleted account', async () => {
    for (const error of [
      conflict('consent_version_outdated', 'Outdated'),
      notFound('user_not_found', 'User not found'),
    ]) {
      app = await buildTestApp({ services: consentsService({ grant: () => Promise.reject(error) }) });
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/consents/personal_data',
        headers: bearer('guest-token'),
        payload: { version: '2020-01-01' },
      });
      expect(response.statusCode).toBe(error.status);
      expectContract(response, 'PUT', '/api/v1/consents/{kind}');
      expect(response.json()).toMatchObject({ code: error.code });
      await app.close();
      app = undefined;
    }
  });

  it('requires authentication before validating the body', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'PUT', url: '/api/v1/consents/personal_data', payload: {} });
    expect(response.statusCode).toBe(401);
    expectContract(response, 'PUT', '/api/v1/consents/{kind}');
  });
});

describe('DELETE /api/v1/consents/{kind}', () => {
  it('revokes the personalized offers consent', async () => {
    const revoked: [number, ConsentKind][] = [];
    app = await buildTestApp({
      services: consentsService({
        revoke: (id, kind) => {
          revoked.push([id, kind]);
          return Promise.resolve();
        },
      }),
    });
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/consents/personalized_offers',
      headers: bearer('guest-token'),
    });
    expect(response.statusCode).toBe(204);
    expectContract(response, 'DELETE', '/api/v1/consents/{kind}');
    expect(revoked).toEqual([[101, 'personalized_offers']]);
  });

  it('asks to delete the account instead of revoking the personal data consent', async () => {
    app = await buildTestApp({
      services: consentsService({
        revoke: () => Promise.reject(conflict('delete_account_instead', 'Delete the account')),
      }),
    });
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/consents/personal_data',
      headers: bearer('guest-token'),
    });
    expect(response.statusCode).toBe(409);
    expectContract(response, 'DELETE', '/api/v1/consents/{kind}');
    expect(response.json()).toMatchObject({ code: 'delete_account_instead' });
  });

  it('rejects an unknown kind', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/consents/everything',
      headers: bearer('guest-token'),
    });
    expect(response.statusCode).toBe(400);
    expectContract(response, 'DELETE', '/api/v1/consents/{kind}');
  });

  it('requires authentication', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/v1/consents/personalized_offers' });
    expect(response.statusCode).toBe(401);
    expectContract(response, 'DELETE', '/api/v1/consents/{kind}');
  });
});
