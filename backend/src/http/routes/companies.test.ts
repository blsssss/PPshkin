import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { bearer, buildTestApp, fakeServices } from '../../../test/services.ts';
import { sampleVenue } from '../../../test/venues.ts';
import type { Company, CompanyInvite } from '../../domain/models.ts';
import { ROLE_PERMISSIONS } from '../../domain/roles.ts';
import type { CompaniesService, CompanyView } from '../../services/companies.ts';
import { conflict, notFound, unavailable, unprocessable } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const owner = bearer('venue-token');
const TOKEN = 'aB3dE5gH7jK9mN2pQ4rS6tU8';
const WHEN = new Date('2026-09-26T09:00:00Z');

const company: Company = {
  id: 3,
  kind: 'legal',
  inn: '7707083893',
  ogrn: '1027700132195',
  kpp: '770701001',
  name: 'ООО "КОФЕЙНЯ ЗЕРНО"',
  address: 'г Москва',
  okved: '56.30',
  registryStatus: 'ACTIVE',
  registryCheckedAt: WHEN,
  verification: 'pending',
  verificationNote: null,
  verifiedAt: null,
  createdBy: 202,
  createdAt: WHEN,
  updatedAt: WHEN,
};

const view: CompanyView = { company, venues: [{ id: 7, name: 'Зерно' }] };

const invite: CompanyInvite = {
  id: 9,
  companyId: 3,
  venueId: 7,
  role: 'cashier',
  createdBy: 202,
  createdByName: 'Ильдар',
  expiresAt: new Date('2026-09-29T09:00:00Z'),
  acceptedBy: null,
  acceptedAt: null,
  revokedAt: null,
  createdAt: WHEN,
};

const companyDto = {
  id: 3,
  kind: 'legal',
  inn: '7707083893',
  ogrn: '1027700132195',
  kpp: '770701001',
  name: 'ООО "КОФЕЙНЯ ЗЕРНО"',
  address: 'г Москва',
  okved: '56.30',
  registryStatus: 'ACTIVE',
  verification: 'pending',
  verificationNote: null,
  venues: [{ id: 7, name: 'Зерно' }],
};

async function appWith(overrides: Partial<CompaniesService> = {}) {
  app = await buildTestApp({ services: { companies: { ...fakeServices().companies, ...overrides } } });
  return app;
}

describe('company routes require authentication', () => {
  it.each([
    ['POST', '/api/v1/companies/lookup', '/api/v1/companies/lookup'],
    ['POST', '/api/v1/companies', '/api/v1/companies'],
    ['GET', '/api/v1/companies/3', '/api/v1/companies/{id}'],
    ['GET', '/api/v1/companies/3/members', '/api/v1/companies/{id}/members'],
    ['POST', '/api/v1/companies/3/invites', '/api/v1/companies/{id}/invites'],
    ['POST', '/api/v1/invites/preview', '/api/v1/invites/preview'],
    ['POST', '/api/v1/invites/accept', '/api/v1/invites/accept'],
    ['GET', '/api/v1/me/workplaces', '/api/v1/me/workplaces'],
  ] as const)('%s %s', async (method, url, path) => {
    const server = await appWith();
    const response = await server.inject({ method, url });
    expect(response.statusCode).toBe(401);
    expectContract(response, method, path);
  });
});

describe('GET /api/v1/me/workplaces', () => {
  it('lists the venues of the caller with the role and the permissions', async () => {
    const workplaces = vi.fn<CompaniesService['workplaces']>(() =>
      Promise.resolve([
        {
          venue: sampleVenue,
          company: { id: 3, name: 'Компания', verification: 'unverified' },
          role: 'cashier',
          permissions: ROLE_PERMISSIONS.cashier,
          venueScoped: true,
          hiddenUntilVerified: false,
        },
      ]),
    );
    const server = await appWith({ workplaces });
    const response = await server.inject({ method: 'GET', url: '/api/v1/me/workplaces', headers: owner });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/me/workplaces');
    expect(response.json()).toMatchObject({
      items: [
        {
          venue: { id: 7 },
          company: { id: 3, name: 'Компания', verification: 'unverified' },
          role: 'cashier',
          permissions: ['venue.view', 'booking.redeem'],
          venueScoped: true,
          hiddenUntilVerified: false,
        },
      ],
    });
    expect(workplaces).toHaveBeenCalledWith(202);
  });
});

describe('POST /api/v1/companies/lookup', () => {
  const lookup = {
    company: {
      kind: 'legal' as const,
      inn: '7707083893',
      ogrn: '1027700132195',
      kpp: '770701001',
      name: 'ООО "КОФЕЙНЯ ЗЕРНО"',
      address: 'г Москва',
      okved: '56.30',
      status: 'ACTIVE' as const,
      managerName: 'Иванов Иван Иванович',
    },
    okvedMatches: true,
    alreadyRegistered: false,
  };

  it('returns the card of the registry', async () => {
    const found = vi.fn<CompaniesService['lookup']>(() => Promise.resolve(lookup));
    const server = await appWith({ lookup: found });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/companies/lookup',
      headers: owner,
      payload: { inn: '7707083893' },
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'POST', '/api/v1/companies/lookup');
    expect(response.json()).toEqual({
      ...lookup.company,
      okvedMatches: true,
      alreadyRegistered: false,
    });
    expect(found).toHaveBeenCalledWith(202, '7707083893');
  });

  it.each([
    [404, notFound('company_not_in_registry', 'No company')],
    [422, unprocessable('inn_invalid', 'Bad INN')],
    [422, unprocessable('company_inactive', 'Inactive')],
    [503, unavailable('registry_unavailable', 'Down')],
  ])('answers %s with the code of the service', async (status, error) => {
    const server = await appWith({ lookup: () => Promise.reject(error) });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/companies/lookup',
      headers: owner,
      payload: { inn: '7707083893' },
    });
    expect(response.statusCode).toBe(status);
    expectContract(response, 'POST', '/api/v1/companies/lookup');
    expect(response.json()).toMatchObject({ code: error.code });
  });

  it.each(['123', '77070838ab', ''])('rejects the malformed INN %j before the service', async (inn) => {
    const lookup = vi.fn<CompaniesService['lookup']>();
    const server = await appWith({ lookup });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/companies/lookup',
      headers: owner,
      payload: { inn },
    });
    expect(response.statusCode).toBe(400);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('company routes', () => {
  it('creates a company after the attestation', async () => {
    const create = vi.fn<CompaniesService['create']>(() => Promise.resolve(view));
    const server = await appWith({ create });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: owner,
      payload: { inn: '7707083893', attest: true },
    });
    expect(response.statusCode).toBe(201);
    expectContract(response, 'POST', '/api/v1/companies');
    expect(response.json()).toEqual(companyDto);
    expect(create).toHaveBeenCalledWith(202, '7707083893');
  });

  it('refuses to create a company without the attestation', async () => {
    const create = vi.fn<CompaniesService['create']>();
    const server = await appWith({ create });
    for (const payload of [{ inn: '7707083893' }, { inn: '7707083893', attest: false }]) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/companies',
        headers: owner,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('answers 409 for a company that is already connected', async () => {
    const server = await appWith({ create: () => Promise.reject(conflict('company_exists', 'Exists')) });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: owner,
      payload: { inn: '7707083893', attest: true },
    });
    expect(response.statusCode).toBe(409);
    expectContract(response, 'POST', '/api/v1/companies');
  });

  it('returns and updates the company', async () => {
    const get = vi.fn<CompaniesService['get']>(() => Promise.resolve(view));
    const updateRequisites = vi.fn<CompaniesService['updateRequisites']>(() => Promise.resolve(view));
    const server = await appWith({ get, updateRequisites });

    const read = await server.inject({ method: 'GET', url: '/api/v1/companies/3', headers: owner });
    expect(read.statusCode).toBe(200);
    expectContract(read, 'GET', '/api/v1/companies/{id}');
    expect(read.json()).toEqual(companyDto);

    const patched = await server.inject({
      method: 'PATCH',
      url: '/api/v1/companies/3',
      headers: owner,
      payload: { inn: '7707083893', attest: true },
    });
    expect(patched.statusCode).toBe(200);
    expectContract(patched, 'PATCH', '/api/v1/companies/{id}');
    expect(updateRequisites).toHaveBeenCalledWith(202, 3, '7707083893');
  });

  it('answers 409 requisites_locked', async () => {
    const server = await appWith({
      updateRequisites: () => Promise.reject(conflict('requisites_locked', 'Locked')),
    });
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/companies/3',
      headers: owner,
      payload: { inn: '7707083893', attest: true },
    });
    expect(response.statusCode).toBe(409);
    expectContract(response, 'PATCH', '/api/v1/companies/{id}');
    expect(response.json()).toMatchObject({ code: 'requisites_locked' });
  });
});

describe('member routes', () => {
  const member = { userId: 303, firstName: 'Анна', role: 'cashier' as const, venueId: 7, since: WHEN };
  const memberDto = {
    userId: 303,
    firstName: 'Анна',
    role: 'cashier',
    venueId: 7,
    since: WHEN.toISOString(),
  };

  it('lists, updates and removes members', async () => {
    const listMembers = vi.fn<CompaniesService['listMembers']>(() => Promise.resolve([member]));
    const updateMember = vi.fn<CompaniesService['updateMember']>(() => Promise.resolve(member));
    const removeMember = vi.fn<CompaniesService['removeMember']>(() => Promise.resolve());
    const server = await appWith({ listMembers, updateMember, removeMember });

    const list = await server.inject({ method: 'GET', url: '/api/v1/companies/3/members', headers: owner });
    expect(list.statusCode).toBe(200);
    expectContract(list, 'GET', '/api/v1/companies/{id}/members');
    expect(list.json()).toEqual({ items: [memberDto] });

    const patch = await server.inject({
      method: 'PATCH',
      url: '/api/v1/companies/3/members/303',
      headers: owner,
      payload: { role: 'manager', venueId: null },
    });
    expect(patch.statusCode).toBe(200);
    expectContract(patch, 'PATCH', '/api/v1/companies/{id}/members/{userId}');
    expect(updateMember).toHaveBeenCalledWith(202, 3, 303, { role: 'manager', venueId: null });

    const removed = await server.inject({
      method: 'DELETE',
      url: '/api/v1/companies/3/members/303',
      headers: owner,
    });
    expect(removed.statusCode).toBe(204);
    expectContract(removed, 'DELETE', '/api/v1/companies/{id}/members/{userId}');
    expect(removeMember).toHaveBeenCalledWith(202, 3, 303);
  });

  it('asks for a field in the member patch', async () => {
    const server = await appWith();
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/companies/3/members/303',
      headers: owner,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('answers 409 last_owner', async () => {
    const server = await appWith({ removeMember: () => Promise.reject(conflict('last_owner', 'Last')) });
    const response = await server.inject({
      method: 'DELETE',
      url: '/api/v1/companies/3/members/202',
      headers: owner,
    });
    expect(response.statusCode).toBe(409);
    expectContract(response, 'DELETE', '/api/v1/companies/{id}/members/{userId}');
    expect(response.json()).toMatchObject({ code: 'last_owner' });
  });
});

describe('invite routes', () => {
  it('creates an invite and shows the links', async () => {
    const createInvite = vi.fn<CompaniesService['createInvite']>(() =>
      Promise.resolve({
        invite,
        token: TOKEN,
        startappLink: `https://max.ru/ppshkin_bot?startapp=join_${TOKEN}`,
        botLink: `https://max.ru/ppshkin_bot?start=j_${TOKEN}`,
      }),
    );
    const server = await appWith({ createInvite });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/companies/3/invites',
      headers: owner,
      payload: { role: 'cashier', venueId: 7 },
    });
    expect(response.statusCode).toBe(201);
    expectContract(response, 'POST', '/api/v1/companies/{id}/invites');
    expect(response.json()).toEqual({
      id: 9,
      role: 'cashier',
      venueId: 7,
      expiresAt: '2026-09-29T09:00:00.000Z',
      startappLink: `https://max.ru/ppshkin_bot?startapp=join_${TOKEN}`,
      botLink: `https://max.ru/ppshkin_bot?start=j_${TOKEN}`,
    });
    expect(createInvite).toHaveBeenCalledWith(202, 3, { role: 'cashier', venueId: 7 });
  });

  it('lists and revokes invites without tokens', async () => {
    const revokeInvite = vi.fn<CompaniesService['revokeInvite']>(() => Promise.resolve());
    const server = await appWith({ listInvites: () => Promise.resolve([invite]), revokeInvite });

    const list = await server.inject({ method: 'GET', url: '/api/v1/companies/3/invites', headers: owner });
    expect(list.statusCode).toBe(200);
    expectContract(list, 'GET', '/api/v1/companies/{id}/invites');
    expect(list.json()).toEqual({
      items: [
        {
          id: 9,
          role: 'cashier',
          venueId: 7,
          expiresAt: '2026-09-29T09:00:00.000Z',
          createdAt: WHEN.toISOString(),
          createdBy: 'Ильдар',
        },
      ],
    });

    const revoked = await server.inject({
      method: 'DELETE',
      url: '/api/v1/companies/3/invites/9',
      headers: owner,
    });
    expect(revoked.statusCode).toBe(204);
    expectContract(revoked, 'DELETE', '/api/v1/companies/{id}/invites/{inviteId}');
    expect(revokeInvite).toHaveBeenCalledWith(202, 3, 9);
  });

  it('previews an invite by the token in the body', async () => {
    const previewInvite = vi.fn<CompaniesService['previewInvite']>(() =>
      Promise.resolve({ companyName: 'Компания', venueName: 'Зерно', role: 'cashier', expiresAt: WHEN }),
    );
    const server = await appWith({ previewInvite });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/invites/preview',
      headers: owner,
      payload: { token: TOKEN },
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'POST', '/api/v1/invites/preview');
    expect(response.json()).toEqual({
      companyName: 'Компания',
      venueName: 'Зерно',
      role: 'cashier',
      expiresAt: WHEN.toISOString(),
    });
    expect(previewInvite).toHaveBeenCalledWith(TOKEN);
  });

  it.each([
    ['invite_expired', 409],
    ['invite_used', 409],
  ])('answers %s with %s when previewing', async (code, status) => {
    const server = await appWith({ previewInvite: () => Promise.reject(conflict(code, 'No')) });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/invites/preview',
      headers: owner,
      payload: { token: TOKEN },
    });
    expect(response.statusCode).toBe(status);
    expectContract(response, 'POST', '/api/v1/invites/preview');
    expect(response.json()).toMatchObject({ code });
  });

  it('accepts an invite and returns the workplace', async () => {
    const acceptInvite = vi.fn<CompaniesService['acceptInvite']>(() =>
      Promise.resolve({
        workplace: {
          venue: sampleVenue,
          company: { id: 3, name: 'Компания', verification: 'pending' },
          role: 'cashier',
          permissions: ROLE_PERMISSIONS.cashier,
          venueScoped: true,
          hiddenUntilVerified: false,
        },
        companyName: 'Компания',
        inviterId: 202,
      }),
    );
    const server = await appWith({ acceptInvite });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/invites/accept',
      headers: owner,
      payload: { token: TOKEN },
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'POST', '/api/v1/invites/accept');
    expect(response.json()).toMatchObject({ role: 'cashier', venueScoped: true, venue: { id: 7 } });
    expect(acceptInvite).toHaveBeenCalledWith(202, TOKEN);
  });

  it('answers 409 already_member', async () => {
    const server = await appWith({
      acceptInvite: () => Promise.reject(conflict('already_member', 'Member')),
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/invites/accept',
      headers: owner,
      payload: { token: TOKEN },
    });
    expect(response.statusCode).toBe(409);
    expectContract(response, 'POST', '/api/v1/invites/accept');
  });

  it.each(['short', 'bad token with spaces 1234', ''])('rejects the malformed token %j', async (token) => {
    const server = await appWith();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/invites/accept',
      headers: owner,
      payload: { token },
    });
    expect(response.statusCode).toBe(400);
  });
});
