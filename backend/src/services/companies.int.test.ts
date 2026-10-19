import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { raceBehindLock } from '../../test/locks.ts';
import { recordingNotifications } from '../../test/notifications.ts';
import { seedCompany, seedCompanyVenue, seedMember, seedUser } from '../../test/venues.ts';
import type { Company, Venue } from '../domain/models.ts';
import type { CompanyRegistry, RegistryCompany, RegistryLookup } from '../ports/company-registry.ts';
import { createCompaniesService, type CompaniesService } from './companies.ts';

const pool = testPool();
const clock = fixedClock('2026-09-26T09:00:00Z');
const OWNER = 101;
const MANAGER = 102;
const CASHIER = 103;
const STRANGER = 104;
const ADMIN = 900;
const BOT = 'ppshkin_bot';
const HOUR_MS = 3_600_000;
const INN = '7707083893';
const IP_INN = '500100732259';

const registered: RegistryCompany = {
  kind: 'legal',
  inn: INN,
  ogrn: '1027700132195',
  kpp: '770701001',
  name: 'ООО "КОФЕЙНЯ ЗЕРНО"',
  address: 'г Москва, ул Тестовая, д 1',
  okved: '56.30',
  status: 'ACTIVE',
  managerName: 'Иванов Иван Иванович',
};

let lookup: RegistryLookup;
const registry: CompanyRegistry & { findByInn: ReturnType<typeof vi.fn<CompanyRegistry['findByInn']>> } = {
  findByInn: vi.fn(() => Promise.resolve(lookup)),
};
const events = recordingNotifications();
let botUsername: string | null;
let service: CompaniesService;
let company: Company;
let zerno: Venue;
let kazan: Venue;

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-26T09:00:00Z');
  lookup = { status: 'found', company: registered };
  registry.findByInn.mockClear();
  events.clear();
  botUsername = BOT;
  service = createCompaniesService({
    pool,
    clock,
    registry,
    notifications: events.notifications,
    adminIds: [ADMIN],
    botUsername: () => botUsername,
  });
  company = await seedCompany(pool, OWNER, 'Кофейни');
  zerno = await seedCompanyVenue(pool, company.id, { name: 'Зерно' });
  kazan = await seedCompanyVenue(pool, company.id, { name: 'Казань' });
  await seedMember(pool, company.id, MANAGER, 'manager', zerno.id);
  await seedMember(pool, company.id, CASHIER, 'cashier', zerno.id);
  await seedUser(pool, STRANGER);
  await seedUser(pool, ADMIN);
});

afterAll(async () => {
  await closeTestPool();
});

async function rows<Row extends object>(text: string, values: unknown[] = []): Promise<Row[]> {
  return (await pool.query<Row>(text, values)).rows;
}

const auditActions = async () =>
  (
    await rows<{ action: string; venue_id: number }>('select action, venue_id from audit_events order by id')
  ).map((row) => `${row.action}:${String(row.venue_id)}`);

describe('lookup', () => {
  it('returns the card with the catering mark and whether the company is connected', async () => {
    expect(await service.lookup(OWNER, INN)).toEqual({
      company: registered,
      okvedMatches: true,
      alreadyRegistered: false,
    });
    await service.create(OWNER, INN);
    expect(await service.lookup(STRANGER, INN)).toMatchObject({ alreadyRegistered: true });
  });

  it('marks a company outside catering without blocking it', async () => {
    lookup = { status: 'found', company: { ...registered, okved: '62.01' } };
    expect(await service.lookup(OWNER, INN)).toMatchObject({ okvedMatches: false });
  });

  it('checks the digits before asking the registry', async () => {
    await expect(service.lookup(OWNER, '7707083894')).rejects.toMatchObject({
      status: 422,
      code: 'inn_invalid',
    });
    expect(registry.findByInn).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'not_found' }, 404, 'company_not_in_registry'],
    [{ status: 'unavailable', reason: 'timeout' }, 503, 'registry_unavailable'],
    [{ status: 'unavailable', reason: 'disabled' }, 503, 'registry_unavailable'],
    [{ status: 'found', company: { ...registered, status: 'LIQUIDATED' } }, 422, 'company_inactive'],
  ] as const)('answers %j with %s %s', async (answer, status, code) => {
    lookup = answer;
    await expect(service.lookup(OWNER, INN)).rejects.toMatchObject({ status, code });
  });
});

describe('create', () => {
  it('stores the requisites, makes the caller the owner and sends the card to the admins', async () => {
    const created = await service.create(STRANGER, INN);

    expect(created.company).toMatchObject({
      kind: 'legal',
      inn: INN,
      ogrn: '1027700132195',
      kpp: '770701001',
      name: 'ООО "КОФЕЙНЯ ЗЕРНО"',
      address: 'г Москва, ул Тестовая, д 1',
      okved: '56.30',
      registryStatus: 'ACTIVE',
      registryCheckedAt: clock.now(),
      verification: 'pending',
      verificationNote: null,
      verifiedAt: null,
      createdBy: STRANGER,
    });
    expect(created.venues).toEqual([]);
    expect(
      await rows('select role, venue_id from memberships where company_id = $1', [created.company.id]),
    ).toEqual([{ role: 'owner', venue_id: null }]);
    expect(events.events).toEqual([
      { kind: 'company_pending', companyId: created.company.id, adminId: ADMIN },
    ]);
    expect(events.notifications.flush).toHaveBeenCalledOnce();
  });

  it('refuses a company that is already connected', async () => {
    await service.create(STRANGER, INN);
    await expect(service.create(MANAGER, INN)).rejects.toMatchObject({ status: 409, code: 'company_exists' });
  });

  it('lets only one of two parallel requests connect the same INN', async () => {
    const results = await Promise.allSettled([service.create(STRANGER, INN), service.create(MANAGER, INN)]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await rows('select id from companies where inn = $1', [INN])).toHaveLength(1);
  });

  it.each([
    [{ status: 'not_found' }, 'company_not_in_registry'],
    [{ status: 'found', company: { ...registered, status: 'BANKRUPT' } }, 'company_inactive'],
  ] as const)('refuses %j', async (answer, code) => {
    lookup = answer;
    await expect(service.create(STRANGER, INN)).rejects.toMatchObject({ status: 422, code });
  });

  it('refuses wrong check digits without asking the registry', async () => {
    await expect(service.create(STRANGER, '7707083894')).rejects.toMatchObject({ code: 'inn_invalid' });
    expect(registry.findByInn).not.toHaveBeenCalled();
  });

  it('accepts the INN for the moderator when the registry is unavailable', async () => {
    lookup = { status: 'unavailable', reason: 'quota_exceeded' };

    const created = await service.create(STRANGER, IP_INN);

    expect(created.company).toMatchObject({
      kind: 'individual',
      inn: IP_INN,
      name: `ИНН ${IP_INN}`,
      ogrn: null,
      registryStatus: null,
      registryCheckedAt: null,
      verification: 'pending',
    });
    expect(events.kinds()).toEqual(['company_pending']);
  });

  it('drops a registry number the database would not accept', async () => {
    lookup = { status: 'found', company: { ...registered, ogrn: '12', kpp: 'abc' } };
    const created = await service.create(STRANGER, INN);
    expect(created.company).toMatchObject({ ogrn: null, kpp: null });
  });

  it('refuses a blocked account', async () => {
    await pool.query("update users set blocked_at = now(), blocked_reason = 'spam' where id = $1", [
      STRANGER,
    ]);
    await expect(service.create(STRANGER, INN)).rejects.toMatchObject({ status: 403, code: 'user_blocked' });
  });
});

describe('updateRequisites', () => {
  it('moves a legacy company to pending and tells the admins', async () => {
    const updated = await service.updateRequisites(OWNER, company.id, INN);

    expect(updated.company).toMatchObject({ inn: INN, name: 'ООО "КОФЕЙНЯ ЗЕРНО"', verification: 'pending' });
    expect(updated.venues.map(({ name }) => name)).toEqual(['Зерно', 'Казань']);
    expect(events.events).toEqual([{ kind: 'company_pending', companyId: company.id, adminId: ADMIN }]);
  });

  it('keeps the name when the registry is unavailable', async () => {
    lookup = { status: 'unavailable', reason: 'timeout' };
    const updated = await service.updateRequisites(OWNER, company.id, INN);
    expect(updated.company).toMatchObject({ name: 'Кофейни', inn: INN, verification: 'pending' });
  });

  it.each(['pending', 'verified'])('locks the requisites of a %s company', async (verification) => {
    await service.updateRequisites(OWNER, company.id, INN);
    await pool.query('update companies set verification = $2 where id = $1', [company.id, verification]);
    await expect(service.updateRequisites(OWNER, company.id, INN)).rejects.toMatchObject({
      status: 409,
      code: 'requisites_locked',
    });
  });

  it('lets the owner resubmit a rejected company and clears the note', async () => {
    await service.updateRequisites(OWNER, company.id, INN);
    await pool.query(
      "update companies set verification = 'rejected', verification_note = 'Не совпадает' where id = $1",
      [company.id],
    );
    events.clear();

    const resubmitted = await service.updateRequisites(OWNER, company.id, IP_INN);

    expect(resubmitted.company).toMatchObject({
      inn: IP_INN,
      verification: 'pending',
      verificationNote: null,
    });
    expect(events.kinds()).toEqual(['company_pending']);
  });

  it('refuses the INN of another company', async () => {
    await service.create(STRANGER, INN);
    await expect(service.updateRequisites(OWNER, company.id, INN)).rejects.toMatchObject({
      status: 409,
      code: 'company_exists',
    });
  });

  it.each([MANAGER, CASHIER])('is for the owner only, not for %s', async (user) => {
    await expect(service.updateRequisites(user, company.id, INN)).rejects.toMatchObject({
      status: 403,
      code: 'company_forbidden',
    });
  });

  it('hides the company from a stranger', async () => {
    await expect(service.updateRequisites(STRANGER, company.id, INN)).rejects.toMatchObject({
      status: 404,
      code: 'company_not_found',
    });
    await expect(service.updateRequisites(OWNER, 9999, INN)).rejects.toMatchObject({
      code: 'company_not_found',
    });
  });
});

describe('get and workplaces', () => {
  it('shows a scoped member only the venue of the scope', async () => {
    expect((await service.get(OWNER, company.id)).venues.map(({ name }) => name)).toEqual([
      'Зерно',
      'Казань',
    ]);
    expect((await service.get(CASHIER, company.id)).venues.map(({ name }) => name)).toEqual(['Зерно']);
    await expect(service.get(STRANGER, company.id)).rejects.toMatchObject({ code: 'company_not_found' });
  });

  it('lists the workplaces with the role and the scope', async () => {
    const owned = await service.workplaces(OWNER);
    expect(owned.map(({ venue, role, venueScoped }) => [venue.name, role, venueScoped])).toEqual([
      ['Зерно', 'owner', false],
      ['Казань', 'owner', false],
    ]);
    const [own] = await service.workplaces(CASHIER);
    expect(own).toMatchObject({
      role: 'cashier',
      venueScoped: true,
      permissions: ['venue.view', 'booking.redeem'],
      company: { id: company.id, name: 'Кофейни', verification: 'unverified' },
    });
    expect(await service.workplaces(STRANGER)).toEqual([]);
  });
});

describe('members', () => {
  it('shows the owner everybody and the manager only the cashiers of the scope', async () => {
    await seedMember(pool, company.id, 105, 'cashier', kazan.id);
    expect((await service.listMembers(OWNER, company.id)).map(({ userId }) => userId)).toEqual([
      OWNER,
      MANAGER,
      CASHIER,
      105,
    ]);
    expect((await service.listMembers(MANAGER, company.id)).map(({ userId }) => userId)).toEqual([
      MANAGER,
      CASHIER,
    ]);
    await expect(service.listMembers(CASHIER, company.id)).rejects.toMatchObject({
      code: 'company_forbidden',
    });
    await expect(service.listMembers(STRANGER, company.id)).rejects.toMatchObject({
      code: 'company_not_found',
    });
  });

  it('lets the owner promote and widen a member, and records it', async () => {
    const promoted = await service.updateMember(OWNER, company.id, CASHIER, {
      role: 'manager',
      venueId: null,
    });

    expect(promoted).toMatchObject({ userId: CASHIER, role: 'manager', venueId: null });
    expect(await auditActions()).toEqual([`staff.role_change:${zerno.id}`, `staff.role_change:${kazan.id}`].sort());
  });

  it('moves a cashier to another venue of the company', async () => {
    await service.updateMember(OWNER, company.id, CASHIER, { venueId: kazan.id });
    const [place] = await service.workplaces(CASHIER);
    expect(place?.venue.id).toBe(kazan.id);
  });

  it('refuses a venue of another company', async () => {
    const other = await seedCompany(pool, 150, 'Чужая');
    const foreign = await seedCompanyVenue(pool, other.id, { name: 'Чужое' });
    await expect(
      service.updateMember(OWNER, company.id, CASHIER, { venueId: foreign.id }),
    ).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
  });

  it('lets a manager move only cashiers inside the own scope', async () => {
    await expect(
      service.updateMember(MANAGER, company.id, CASHIER, { venueId: kazan.id }),
    ).rejects.toMatchObject({
      code: 'company_forbidden',
    });
    await expect(
      service.updateMember(MANAGER, company.id, CASHIER, { role: 'manager' }),
    ).rejects.toMatchObject({
      code: 'company_forbidden',
    });
    await expect(service.updateMember(MANAGER, company.id, OWNER, { role: 'cashier' })).rejects.toMatchObject(
      {
        code: 'company_forbidden',
      },
    );
    await expect(
      service.updateMember(CASHIER, company.id, MANAGER, { role: 'cashier' }),
    ).rejects.toMatchObject({
      code: 'company_forbidden',
    });
    expect(await service.updateMember(MANAGER, company.id, CASHIER, { venueId: zerno.id })).toMatchObject({
      role: 'cashier',
    });
  });

  it('answers 404 for a member who is not in the company', async () => {
    await expect(
      service.updateMember(OWNER, company.id, STRANGER, { role: 'manager' }),
    ).rejects.toMatchObject({
      status: 404,
      code: 'member_not_found',
    });
    await expect(service.removeMember(OWNER, company.id, STRANGER)).rejects.toMatchObject({
      code: 'member_not_found',
    });
  });

  it('keeps the last owner when he demotes himself or leaves', async () => {
    await expect(service.updateMember(OWNER, company.id, OWNER, { role: 'manager' })).rejects.toMatchObject({
      status: 409,
      code: 'last_owner',
    });
    await expect(service.removeMember(OWNER, company.id, OWNER)).rejects.toMatchObject({
      status: 409,
      code: 'last_owner',
    });
  });

  it('lets an owner leave when another owner remains', async () => {
    await service.updateMember(OWNER, company.id, MANAGER, { role: 'owner' });
    await service.removeMember(OWNER, company.id, OWNER);
    expect(await service.workplaces(OWNER)).toEqual([]);
    expect((await service.workplaces(MANAGER)).map(({ role }) => role)).toEqual(['owner', 'owner']);
    expect(events.events).toEqual([]);
  });

  it('removes a cashier at once and tells him about it', async () => {
    await service.removeMember(MANAGER, company.id, CASHIER);

    expect(await service.workplaces(CASHIER)).toEqual([]);
    expect(events.events).toEqual([
      { kind: 'staff_removed', companyId: company.id, userId: CASHIER, venueId: zerno.id },
    ]);
    expect(events.notifications.flush).toHaveBeenCalledOnce();
    expect(await auditActions()).toEqual([`staff.remove:${zerno.id}`]);
  });

  it('refuses a manager who removes a manager, an owner or a cashier of another venue', async () => {
    await seedMember(pool, company.id, 105, 'cashier', kazan.id);
    await expect(service.removeMember(MANAGER, company.id, OWNER)).rejects.toMatchObject({
      code: 'company_forbidden',
    });
    await expect(service.removeMember(MANAGER, company.id, 105)).rejects.toMatchObject({
      code: 'company_forbidden',
    });
    await expect(service.removeMember(CASHIER, company.id, MANAGER)).rejects.toMatchObject({
      code: 'company_forbidden',
    });
  });

  it('lets any member leave on his own', async () => {
    await service.removeMember(CASHIER, company.id, CASHIER);
    expect(await service.workplaces(CASHIER)).toEqual([]);
    expect(events.events).toEqual([]);
  });
});

describe('invites', () => {
  const sha = (token: string) => createHash('sha256').update(token).digest('hex');

  it('shows the token once and stores only its hash', async () => {
    const created = await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id });

    expect(created.token).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(created.botLink).toBe(`https://max.ru/${BOT}?start=j_${created.token}`);
    expect(created.startappLink).toBe(`https://max.ru/${BOT}?startapp=join_${created.token}`);
    expect(created.invite).toMatchObject({
      role: 'cashier',
      venueId: zerno.id,
      createdBy: OWNER,
      expiresAt: new Date(clock.now().getTime() + 72 * HOUR_MS),
    });
    const stored = await rows<{ token_hash: string }>('select token_hash from company_invites');
    expect(stored).toEqual([{ token_hash: sha(created.token) }]);
    expect(JSON.stringify(await rows('select * from company_invites'))).not.toContain(created.token);
    expect(await auditActions()).toEqual([`staff.invite:${zerno.id}`]);
  });

  it('creates different tokens', async () => {
    const tokens = new Set<string>();
    for (let index = 0; index < 5; index += 1) {
      tokens.add(
        (await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id })).token,
      );
    }
    expect(tokens.size).toBe(5);
  });

  it('invites an owner for the whole company only', async () => {
    const created = await service.createInvite(OWNER, company.id, { role: 'owner' });
    expect(created.invite).toMatchObject({ role: 'owner', venueId: null });
    await expect(
      service.createInvite(OWNER, company.id, { role: 'owner', venueId: zerno.id }),
    ).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
  });

  it('keeps a manager to the cashiers of the own venue', async () => {
    const own = await service.createInvite(MANAGER, company.id, { role: 'cashier' });
    expect(own.invite.venueId).toBe(zerno.id);
    for (const input of [
      { role: 'manager', venueId: zerno.id },
      { role: 'owner' },
      { role: 'cashier', venueId: kazan.id },
    ] as const) {
      await expect(service.createInvite(MANAGER, company.id, input)).rejects.toMatchObject({
        status: 403,
        code: 'company_forbidden',
      });
    }
    await expect(service.createInvite(CASHIER, company.id, { role: 'cashier' })).rejects.toMatchObject({
      code: 'company_forbidden',
    });
    await expect(service.createInvite(STRANGER, company.id, { role: 'cashier' })).rejects.toMatchObject({
      code: 'company_not_found',
    });
  });

  it('refuses a venue of another company and a company without venues', async () => {
    const other = await seedCompany(pool, 150, 'Чужая');
    const foreign = await seedCompanyVenue(pool, other.id, { name: 'Чужое' });
    await expect(
      service.createInvite(OWNER, company.id, { role: 'cashier', venueId: foreign.id }),
    ).rejects.toMatchObject({ status: 404, code: 'venue_not_found' });
    await expect(service.createInvite(150, other.id, { role: 'cashier' })).resolves.toBeDefined();
    const empty = await seedCompany(pool, 151, 'Пустая');
    await expect(service.createInvite(151, empty.id, { role: 'cashier' })).rejects.toMatchObject({
      code: 'venue_not_found',
    });
  });

  it('allows twenty active invites and not the twenty first', async () => {
    for (let index = 0; index < 20; index += 1) {
      await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id });
    }
    await expect(
      service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id }),
    ).rejects.toMatchObject({ status: 409, code: 'invite_limit' });

    clock.advance(73 * HOUR_MS);
    await expect(
      service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id }),
    ).resolves.toBeDefined();
  });

  it('fails when the bot is not running', async () => {
    botUsername = null;
    await expect(
      service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id }),
    ).rejects.toMatchObject({ status: 503, code: 'bot_unavailable' });
  });

  it('lists active invites: all for the owner, cashier invites of the scope for a manager', async () => {
    const cashier = await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id });
    await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: kazan.id });
    await service.createInvite(OWNER, company.id, { role: 'manager', venueId: zerno.id });
    const expired = await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id });
    await pool.query('update company_invites set expires_at = $2 where id = $1', [
      expired.invite.id,
      new Date(clock.now().getTime() - 1000),
    ]);

    expect(await service.listInvites(OWNER, company.id)).toHaveLength(3);
    expect((await service.listInvites(MANAGER, company.id)).map(({ id }) => id)).toEqual([cashier.invite.id]);
    expect((await service.listInvites(OWNER, company.id))[0]?.createdByName).toBeNull();
    await expect(service.listInvites(CASHIER, company.id)).rejects.toMatchObject({
      code: 'company_forbidden',
    });
  });

  it('revokes an invite and refuses the revoked token', async () => {
    const created = await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id });

    await service.revokeInvite(OWNER, company.id, created.invite.id);

    await expect(service.previewInvite(created.token)).rejects.toMatchObject({
      status: 404,
      code: 'invite_not_found',
    });
    await expect(service.acceptInvite(STRANGER, created.token)).rejects.toMatchObject({
      code: 'invite_not_found',
    });
    await expect(service.revokeInvite(OWNER, company.id, created.invite.id)).rejects.toMatchObject({
      code: 'invite_not_found',
    });
    expect(await auditActions()).toEqual([`staff.invite:${zerno.id}`, `staff.invite_revoke:${zerno.id}`]);
  });

  it('lets a manager revoke only cashier invites of the scope', async () => {
    const manager = await service.createInvite(OWNER, company.id, { role: 'manager', venueId: zerno.id });
    const cashier = await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id });
    await expect(service.revokeInvite(MANAGER, company.id, manager.invite.id)).rejects.toMatchObject({
      code: 'company_forbidden',
    });
    await service.revokeInvite(MANAGER, company.id, cashier.invite.id);
    await expect(service.revokeInvite(OWNER, company.id, 9999)).rejects.toMatchObject({
      code: 'invite_not_found',
    });
  });

  it('previews what the invited person gets', async () => {
    const created = await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id });
    const wide = await service.createInvite(OWNER, company.id, { role: 'manager' });

    expect(await service.previewInvite(created.token)).toEqual({
      companyName: 'Кофейни',
      venueName: 'Зерно',
      role: 'cashier',
      expiresAt: created.invite.expiresAt,
    });
    expect(await service.previewInvite(wide.token)).toMatchObject({ venueName: null, role: 'manager' });
    await expect(service.previewInvite('A'.repeat(24))).rejects.toMatchObject({ code: 'invite_not_found' });
  });

  it('expires after 72 hours by the clock', async () => {
    const created = await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id });

    clock.advance(72 * HOUR_MS - 1);
    await expect(service.previewInvite(created.token)).resolves.toBeDefined();
    clock.advance(1);

    await expect(service.previewInvite(created.token)).rejects.toMatchObject({
      status: 409,
      code: 'invite_expired',
    });
    await expect(service.acceptInvite(STRANGER, created.token)).rejects.toMatchObject({
      code: 'invite_expired',
    });
    expect(await service.workplaces(STRANGER)).toEqual([]);
  });
});

describe('accepting an invite', () => {
  it('gives the invited person the role in the scope and tells the inviter', async () => {
    const created = await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: kazan.id });
    events.clear();

    const accepted = await service.acceptInvite(STRANGER, created.token);

    expect(accepted).toMatchObject({
      companyName: 'Кофейни',
      inviterId: OWNER,
      workplace: { role: 'cashier', venueScoped: true, venue: { id: kazan.id } },
    });
    expect(
      await rows('select role, venue_id, invited_by from memberships where user_id = $1', [STRANGER]),
    ).toEqual([{ role: 'cashier', venue_id: kazan.id, invited_by: OWNER }]);
    expect(await rows('select accepted_by from company_invites')).toEqual([{ accepted_by: STRANGER }]);
    expect(events.events).toEqual([
      { kind: 'staff_joined', companyId: company.id, userId: STRANGER, venueId: kazan.id, inviterId: OWNER },
    ]);
    expect(await auditActions()).toContain(`staff.join:${kazan.id}`);
  });

  it('gives a company wide invite access to every venue', async () => {
    const created = await service.createInvite(OWNER, company.id, { role: 'manager' });
    await service.acceptInvite(STRANGER, created.token);
    expect((await service.workplaces(STRANGER)).map(({ venue }) => venue.name)).toEqual(['Зерно', 'Казань']);
  });

  it('works for a person who never gave the guest consent', async () => {
    const created = await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id });
    await service.acceptInvite(STRANGER, created.token);
    expect(await rows('select 1 from consents where user_id = $1', [STRANGER])).toEqual([]);
  });

  it('refuses a second use and a person who already works there', async () => {
    const created = await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id });
    await service.acceptInvite(STRANGER, created.token);

    await expect(service.acceptInvite(150, created.token)).rejects.toMatchObject({
      status: 409,
      code: 'invite_used',
    });
    await expect(service.previewInvite(created.token)).rejects.toMatchObject({ code: 'invite_used' });

    const again = await service.createInvite(OWNER, company.id, { role: 'manager', venueId: zerno.id });
    await expect(service.acceptInvite(STRANGER, again.token)).rejects.toMatchObject({
      status: 409,
      code: 'already_member',
    });
    expect(await rows('select 1 from memberships where user_id = $1', [STRANGER])).toHaveLength(1);
  });

  it('gives two parallel acceptances one membership and 409 invite_used', async () => {
    await seedUser(pool, 150);
    const created = await service.createInvite(OWNER, company.id, { role: 'cashier', venueId: zerno.id });

    const results = await raceBehindLock(
      pool,
      { text: 'select id from company_invites where id = $1 for update', values: [created.invite.id] },
      [() => service.acceptInvite(STRANGER, created.token), () => service.acceptInvite(150, created.token)],
    );

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason).toMatchObject({
      status: 409,
      code: 'invite_used',
    });
    expect(
      await rows('select user_id from memberships where user_id in ($1, $2)', [STRANGER, 150]),
    ).toHaveLength(1);
    expect(events.kinds().filter((kind) => kind === 'staff_joined')).toHaveLength(1);
  });

  it('refuses a token that never existed', async () => {
    await expect(service.acceptInvite(STRANGER, 'z'.repeat(24))).rejects.toMatchObject({
      status: 404,
      code: 'invite_not_found',
    });
  });
});
