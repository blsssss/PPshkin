import { createHash, randomBytes } from 'node:crypto';
import { withTransaction, type Pool, type PoolClient, type Queryable } from '../db/pool.ts';
import type { AuditAction, AuditChannel } from '../domain/audit.ts';
import { innKind, isOgrnFormat, isValidInn, okvedMatches } from '../domain/inn.ts';
import type { Company, CompanyInvite, CompanyVerification, Membership } from '../domain/models.ts';
import { can, canInviteRole, canManageRole, type Role } from '../domain/roles.ts';
import type { CompanyRegistry, RegistryCompany } from '../ports/company-registry.ts';
import type { Notifications } from '../ports/notifier.ts';
import * as audit from '../repositories/audit.ts';
import * as companies from '../repositories/companies.ts';
import * as invites from '../repositories/invites.ts';
import * as memberships from '../repositories/memberships.ts';
import type { Clock } from '../shared/clock.ts';
import { badRequest, conflict, forbidden, notFound, unavailable, unprocessable } from '../shared/errors.ts';
import { listWorkplaces, type Workplace } from './access.ts';
import { requireUnblockedUser } from './moderation.ts';

export interface CompanyView {
  company: Company;
  venues: { id: number; name: string }[];
}

export interface CompanyLookup {
  company: RegistryCompany;
  okvedMatches: boolean;
  alreadyRegistered: boolean;
}

export interface MemberView {
  userId: number;
  firstName: string | null;
  role: Role;
  venueId: number | null;
  since: Date;
}

export interface InviteInput {
  role: Role;
  venueId?: number | undefined;
}

export interface CreatedInvite {
  invite: CompanyInvite;
  token: string;
  startappLink: string;
  botLink: string;
}

export interface InvitePreview {
  companyName: string;
  venueName: string | null;
  role: Role;
  expiresAt: Date;
}

export interface AcceptedInvite {
  workplace: Workplace;
  companyName: string;
  inviterId: number | null;
}

export interface MemberPatch {
  role?: Role | undefined;
  venueId?: number | null | undefined;
}

export interface CompaniesService {
  workplaces(userId: number): Promise<Workplace[]>;
  lookup(userId: number, inn: string): Promise<CompanyLookup>;
  create(userId: number, inn: string): Promise<CompanyView>;
  get(userId: number, companyId: number): Promise<CompanyView>;
  updateRequisites(userId: number, companyId: number, inn: string): Promise<CompanyView>;
  listMembers(userId: number, companyId: number): Promise<MemberView[]>;
  updateMember(userId: number, companyId: number, memberId: number, patch: MemberPatch): Promise<MemberView>;
  removeMember(userId: number, companyId: number, memberId: number): Promise<void>;
  createInvite(userId: number, companyId: number, input: InviteInput): Promise<CreatedInvite>;
  listInvites(userId: number, companyId: number): Promise<CompanyInvite[]>;
  revokeInvite(userId: number, companyId: number, inviteId: number): Promise<void>;
  previewInvite(token: string): Promise<InvitePreview>;
  acceptInvite(userId: number, token: string): Promise<AcceptedInvite>;
  createOwnerInviteAsAdmin(adminId: number, companyId: number, channel: AuditChannel): Promise<CreatedInvite>;
  listForVerification(verification: CompanyVerification, limit: number): Promise<CompanyView[]>;
  findView(companyId: number): Promise<CompanyView | null>;
}

interface CompaniesDependencies {
  pool: Pool;
  clock: Clock;
  registry: CompanyRegistry;
  notifications: Notifications;
  adminIds: readonly number[];
  verificationRequired?: boolean;
  botUsername: () => string | null;
}

const INVITE_TTL_MS = 72 * 3_600_000;
const ACTIVE_INVITE_LIMIT = 20;
const TOKEN_LENGTH = 24;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE62_UNBIASED_LIMIT = 248;
const UNIQUE_VIOLATION = '23505';

const companyNotFound = () => notFound('company_not_found', 'Company not found');
const companyForbidden = () => forbidden('company_forbidden', 'Your role does not allow this action');
const memberNotFound = () => notFound('member_not_found', 'Member not found');
const inviteNotFound = () => notFound('invite_not_found', 'Invite not found');
const venueMissing = () => notFound('venue_not_found', 'Venue not found in this company');
const companyExists = () =>
  conflict(
    'company_exists',
    'The company is already connected. Ask its owner for an invite or contact support',
  );
const lastOwner = () => conflict('last_owner', 'The company must keep at least one owner');

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  let token = '';
  while (token.length < TOKEN_LENGTH) {
    for (const byte of randomBytes(TOKEN_LENGTH)) {
      if (byte < BASE62_UNBIASED_LIMIT && token.length < TOKEN_LENGTH) {
        token += BASE62.charAt(byte % BASE62.length);
      }
    }
  }
  return token;
}

function requisitesOf(
  inn: string,
  found: RegistryCompany | null,
  fallbackName: string,
  now: Date,
): companies.Requisites {
  if (found === null) {
    return {
      kind: innKind(inn),
      inn,
      ogrn: null,
      kpp: null,
      name: fallbackName,
      address: null,
      okved: null,
      registryStatus: null,
      registryCheckedAt: null,
      managerName: null,
    };
  }
  return {
    kind: found.kind,
    inn,
    ogrn: found.ogrn !== null && isOgrnFormat(found.ogrn) ? found.ogrn : null,
    kpp: found.kpp !== null && /^\d{9}$/.test(found.kpp) ? found.kpp : null,
    name: found.name.slice(0, 300),
    address: found.address?.slice(0, 500) ?? null,
    okved: found.okved,
    registryStatus: found.status,
    registryCheckedAt: now,
    managerName: found.managerName?.slice(0, 300) ?? null,
  };
}

function withinScope(actor: Membership, venueId: number | null): boolean {
  return actor.venueId === null || actor.venueId === venueId;
}

export function createCompaniesService({
  pool,
  clock,
  registry,
  notifications,
  adminIds,
  verificationRequired = false,
  botUsername,
}: CompaniesDependencies): CompaniesService {
  async function requireMember(db: Queryable, companyId: number, userId: number): Promise<Membership> {
    const member = await memberships.find(db, companyId, userId);
    if (!member) throw companyNotFound();
    return member;
  }

  async function view(db: Queryable, company: Company, member: Membership): Promise<CompanyView> {
    const venues = await companies.listVenues(db, company.id);
    return {
      company,
      venues: member.venueId === null ? venues : venues.filter((venue) => venue.id === member.venueId),
    };
  }

  async function resolveRequisites(inn: string, fallbackName: string): Promise<companies.Requisites> {
    if (!isValidInn(inn)) throw unprocessable('inn_invalid', 'The INN has a wrong length or check digits');
    const lookup = await registry.findByInn(inn);
    if (lookup.status === 'not_found') {
      throw unprocessable('company_not_in_registry', 'No company with this INN in the state registry');
    }
    if (lookup.status === 'unavailable') return requisitesOf(inn, null, fallbackName, clock.now());
    if (lookup.company.status !== 'ACTIVE') {
      throw unprocessable('company_inactive', 'The company is not active in the state registry');
    }
    return requisitesOf(inn, lookup.company, fallbackName, clock.now());
  }

  async function announcePending(client: PoolClient, companyId: number, now: Date): Promise<void> {
    for (const adminId of adminIds) {
      await notifications.enqueue(client, { kind: 'company_pending', companyId, adminId }, now);
    }
  }

  async function recordStaff(
    client: PoolClient,
    companyId: number,
    actorUserId: number,
    action: AuditAction,
    targetUserId: number | null,
    details: Record<string, unknown>,
    now: Date,
    venueId: number | null = null,
  ): Promise<void> {
    const venueIds =
      venueId === null ? (await companies.listVenues(client, companyId)).map((venue) => venue.id) : [venueId];
    for (const id of venueIds) {
      await audit.record(
        client,
        {
          venueId: id,
          actorUserId,
          action,
          target: { type: 'staff', id: targetUserId },
          channel: 'api',
          details,
        },
        now,
      );
    }
  }

  async function lockedCompany(client: PoolClient, companyId: number): Promise<Company> {
    const company = await companies.lockById(client, companyId);
    if (!company) throw companyNotFound();
    return company;
  }

  async function assertCanTouch(
    client: PoolClient,
    actor: Membership,
    target: Membership,
    newRole: Role,
    newVenueId: number | null,
  ): Promise<void> {
    if (!can(actor.role, 'team.manage')) throw companyForbidden();
    if (!canManageRole(actor.role, target.role) || !canInviteRole(actor.role, newRole)) {
      throw companyForbidden();
    }
    if (actor.role !== 'owner' && (!withinScope(actor, target.venueId) || !withinScope(actor, newVenueId))) {
      throw companyForbidden();
    }
    if (newVenueId !== null) {
      const venues = await companies.listVenues(client, target.companyId);
      if (!venues.some((venue) => venue.id === newVenueId)) throw venueMissing();
    }
  }

  function toMemberView(member: memberships.MemberRecord): MemberView {
    return {
      userId: member.userId,
      firstName: member.firstName,
      role: member.role,
      venueId: member.venueId,
      since: member.createdAt,
    };
  }

  async function memberView(db: Queryable, companyId: number, userId: number): Promise<MemberView> {
    const found = (await memberships.listMembers(db, companyId)).find((member) => member.userId === userId);
    if (!found) throw memberNotFound();
    return toMemberView(found);
  }

  function inviteLinks(token: string): { startappLink: string; botLink: string } {
    const username = botUsername();
    if (username === null)
      throw unavailable('bot_unavailable', 'The bot is not running, links are unavailable');
    return {
      startappLink: `https://max.ru/${username}?startapp=join_${token}`,
      botLink: `https://max.ru/${username}?start=j_${token}`,
    };
  }

  async function usableInvite(
    db: Queryable,
    token: string,
    lock: boolean,
    now: Date,
  ): Promise<CompanyInvite> {
    const invite = await invites.findByTokenHash(db, hashToken(token), lock);
    if (invite?.revokedAt !== null) throw inviteNotFound();
    if (invite.acceptedAt !== null) throw conflict('invite_used', 'The invite has already been used');
    if (invite.expiresAt <= now) throw conflict('invite_expired', 'The invite has expired');
    return invite;
  }

  return {
    workplaces: (userId) => listWorkplaces(pool, userId, verificationRequired),

    async lookup(_userId, inn) {
      if (!isValidInn(inn)) throw unprocessable('inn_invalid', 'The INN has a wrong length or check digits');
      const found = await registry.findByInn(inn);
      if (found.status === 'unavailable') {
        throw unavailable('registry_unavailable', 'The state registry is unavailable, try again later');
      }
      if (found.status === 'not_found') {
        throw notFound('company_not_in_registry', 'No company with this INN in the state registry');
      }
      if (found.company.status !== 'ACTIVE') {
        throw unprocessable('company_inactive', 'The company is not active in the state registry');
      }
      return {
        company: found.company,
        okvedMatches: okvedMatches(found.company.okved),
        alreadyRegistered: (await companies.findByInn(pool, inn)) !== null,
      };
    },

    async create(userId, inn) {
      await requireUnblockedUser(pool, userId);
      const requisites = await resolveRequisites(inn, `ИНН ${inn}`);
      try {
        const created = await withTransaction(pool, async (client) => {
          if (await companies.findByInn(client, inn)) throw companyExists();
          const now = clock.now();
          const company = await companies.insert(client, requisites.name, userId, requisites, now);
          const owner = await memberships.insert(
            client,
            { companyId: company.id, userId, role: 'owner', venueId: null, invitedBy: null },
            now,
          );
          await announcePending(client, company.id, now);
          return { company, owner };
        });
        notifications.flush();
        return await view(pool, created.company, created.owner);
      } catch (error) {
        if (isUniqueViolation(error)) throw companyExists();
        throw error;
      }
    },

    async get(userId, companyId) {
      const member = await requireMember(pool, companyId, userId);
      const company = await companies.findById(pool, companyId);
      if (!company) throw companyNotFound();
      return view(pool, company, member);
    },

    async updateRequisites(userId, companyId, inn) {
      const known = await companies.findById(pool, companyId);
      if (!known) throw companyNotFound();
      const requisites = await resolveRequisites(inn, known.name);
      try {
        const updated = await withTransaction(pool, async (client) => {
          const company = await lockedCompany(client, companyId);
          const member = await requireMember(client, companyId, userId);
          if (!can(member.role, 'company.edit')) throw companyForbidden();
          if (company.verification === 'pending' || company.verification === 'verified') {
            throw conflict('requisites_locked', 'The requisites can only be changed through support');
          }
          const owner = await companies.findByInn(client, inn);
          if (owner && owner.id !== companyId) throw companyExists();
          const now = clock.now();
          const changed = await companies.applyRequisites(client, companyId, requisites, userId, now);
          await announcePending(client, companyId, now);
          return { company: changed, member };
        });
        notifications.flush();
        return await view(pool, updated.company, updated.member);
      } catch (error) {
        if (isUniqueViolation(error)) throw companyExists();
        throw error;
      }
    },

    async listMembers(userId, companyId) {
      const actor = await requireMember(pool, companyId, userId);
      if (!can(actor.role, 'team.invite')) throw companyForbidden();
      const members = await memberships.listMembers(pool, companyId);
      const visible =
        actor.role === 'owner'
          ? members
          : members.filter(
              (member) =>
                member.userId === userId || (member.role === 'cashier' && withinScope(actor, member.venueId)),
            );
      return visible.map(toMemberView);
    },

    async updateMember(userId, companyId, memberId, patch) {
      await withTransaction(pool, async (client) => {
        await lockedCompany(client, companyId);
        const members = await memberships.lockCompanyMembers(client, companyId);
        const actor = members.find((member) => member.userId === userId);
        if (!actor) throw companyNotFound();
        const target = members.find((member) => member.userId === memberId);
        if (!target) {
          if (!can(actor.role, 'team.manage')) throw companyForbidden();
          throw memberNotFound();
        }
        const role = patch.role ?? target.role;
        const venueId =
          role === 'owner' ? null : patch.venueId === undefined ? target.venueId : patch.venueId;
        await assertCanTouch(client, actor, target, role, venueId);
        const owners = members.filter((member) => member.role === 'owner').length;
        if (target.role === 'owner' && role !== 'owner' && owners <= 1) throw lastOwner();
        const now = clock.now();
        await memberships.update(client, target.id, { role, venueId }, now);
        await recordStaff(
          client,
          companyId,
          userId,
          'staff.update',
          memberId,
          { role, venueId },
          now,
          venueId,
        );
      });
      return memberView(pool, companyId, memberId);
    },

    async removeMember(userId, companyId, memberId) {
      const removed = await withTransaction(pool, async (client) => {
        await lockedCompany(client, companyId);
        const members = await memberships.lockCompanyMembers(client, companyId);
        const actor = members.find((member) => member.userId === userId);
        if (!actor) throw companyNotFound();
        const target = members.find((member) => member.userId === memberId);
        if (!target) {
          if (!can(actor.role, 'team.manage')) throw companyForbidden();
          throw memberNotFound();
        }
        const leaving = userId === memberId;
        if (!leaving) await assertCanTouch(client, actor, target, target.role, target.venueId);
        const otherOwners = members.filter(
          (member) => member.role === 'owner' && member.userId !== memberId,
        ).length;
        if (target.role === 'owner' && otherOwners === 0) throw lastOwner();
        const now = clock.now();
        await memberships.remove(client, target.id);
        await recordStaff(
          client,
          companyId,
          userId,
          'staff.remove',
          memberId,
          { role: target.role, left: leaving },
          now,
          target.venueId,
        );
        if (!leaving) {
          await notifications.enqueue(
            client,
            { kind: 'staff_removed', companyId, userId: memberId, venueId: target.venueId },
            now,
          );
        }
        return !leaving;
      });
      if (removed) notifications.flush();
    },

    async createInvite(userId, companyId, input) {
      const created = await withTransaction(pool, async (client) => {
        await lockedCompany(client, companyId);
        const actor = await requireMember(client, companyId, userId);
        if (!can(actor.role, 'team.invite') || !canInviteRole(actor.role, input.role)) {
          throw companyForbidden();
        }
        if (input.role === 'owner' && input.venueId !== undefined) {
          throw badRequest('validation_failed', 'Request validation failed', [
            { path: 'venueId', message: 'an owner invite covers the whole company' },
          ]);
        }
        const venues = await companies.listVenues(client, companyId);
        if (venues.length === 0) throw venueMissing();
        const venueId = input.role === 'owner' ? null : (input.venueId ?? actor.venueId);
        if (venueId !== null && !venues.some((venue) => venue.id === venueId)) throw venueMissing();
        if (actor.role !== 'owner' && !withinScope(actor, venueId)) throw companyForbidden();
        const now = clock.now();
        if ((await invites.countActive(client, companyId, now)) >= ACTIVE_INVITE_LIMIT) {
          throw conflict('invite_limit', `A company can have at most ${ACTIVE_INVITE_LIMIT} active invites`);
        }
        const token = newToken();
        const invite = await invites.insert(
          client,
          {
            companyId,
            venueId,
            role: input.role,
            tokenHash: hashToken(token),
            createdBy: userId,
            expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
          },
          now,
        );
        await recordStaff(
          client,
          companyId,
          userId,
          'staff.invite',
          null,
          { role: input.role, inviteId: invite.id },
          now,
          venueId,
        );
        return { invite, token };
      });
      return { ...created, ...inviteLinks(created.token) };
    },

    async listInvites(userId, companyId) {
      const actor = await requireMember(pool, companyId, userId);
      if (!can(actor.role, 'team.invite')) throw companyForbidden();
      const active = await invites.listActive(pool, companyId, clock.now());
      return actor.role === 'owner'
        ? active
        : active.filter((invite) => invite.role === 'cashier' && withinScope(actor, invite.venueId));
    },

    async revokeInvite(userId, companyId, inviteId) {
      await withTransaction(pool, async (client) => {
        await lockedCompany(client, companyId);
        const actor = await requireMember(client, companyId, userId);
        const invite = await invites.findById(client, inviteId);
        const now = clock.now();
        if (
          invite?.companyId !== companyId ||
          invite.revokedAt !== null ||
          invite.acceptedAt !== null ||
          invite.expiresAt <= now
        ) {
          throw inviteNotFound();
        }
        const allowed =
          can(actor.role, 'team.invite') &&
          (actor.role === 'owner' || (invite.role === 'cashier' && withinScope(actor, invite.venueId)));
        if (!allowed) throw companyForbidden();
        await invites.revoke(client, invite.id, now);
        await recordStaff(
          client,
          companyId,
          userId,
          'staff.invite_revoke',
          null,
          { role: invite.role, inviteId: invite.id },
          now,
          invite.venueId,
        );
      });
    },

    async previewInvite(token) {
      const invite = await usableInvite(pool, token, false, clock.now());
      const company = await companies.findById(pool, invite.companyId);
      if (!company) throw inviteNotFound();
      const venues = await companies.listVenues(pool, company.id);
      const venue = venues.find((candidate) => candidate.id === invite.venueId);
      return {
        companyName: company.name,
        venueName: venue?.name ?? null,
        role: invite.role,
        expiresAt: invite.expiresAt,
      };
    },

    async createOwnerInviteAsAdmin(adminId, companyId, channel) {
      const created = await withTransaction(pool, async (client) => {
        await lockedCompany(client, companyId);
        const now = clock.now();
        if ((await invites.countActive(client, companyId, now)) >= ACTIVE_INVITE_LIMIT) {
          throw conflict('invite_limit', `A company can have at most ${ACTIVE_INVITE_LIMIT} active invites`);
        }
        const token = newToken();
        const invite = await invites.insert(
          client,
          {
            companyId,
            venueId: null,
            role: 'owner',
            tokenHash: hashToken(token),
            createdBy: adminId,
            expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
          },
          now,
        );
        await audit.record(
          client,
          {
            venueId: null,
            companyId,
            actorUserId: adminId,
            action: 'admin.company.invite',
            target: { type: 'company', id: companyId },
            channel,
            details: { inviteId: invite.id, role: 'owner' },
          },
          now,
        );
        return { invite, token };
      });
      return { ...created, ...inviteLinks(created.token) };
    },

    async listForVerification(verification, limit) {
      const found = await companies.listByVerification(pool, verification, limit);
      return Promise.all(
        found.map(async (company) => ({ company, venues: await companies.listVenues(pool, company.id) })),
      );
    },

    async findView(companyId) {
      const company = await companies.findById(pool, companyId);
      return company ? { company, venues: await companies.listVenues(pool, company.id) } : null;
    },

    async acceptInvite(userId, token) {
      const accepted = await withTransaction(pool, async (client) => {
        const now = clock.now();
        const invite = await usableInvite(client, token, true, now);
        if (await memberships.find(client, invite.companyId, userId)) {
          throw conflict('already_member', 'You already work in this company');
        }
        const company = await companies.findById(client, invite.companyId);
        if (!company) throw inviteNotFound();
        await memberships.insert(
          client,
          {
            companyId: company.id,
            userId,
            role: invite.role,
            venueId: invite.venueId,
            invitedBy: invite.createdBy,
          },
          now,
        );
        await invites.markAccepted(client, invite.id, userId, now);
        await recordStaff(
          client,
          company.id,
          userId,
          'staff.join',
          userId,
          { role: invite.role, inviteId: invite.id },
          now,
          invite.venueId,
        );
        await notifications.enqueue(
          client,
          {
            kind: 'staff_joined',
            companyId: company.id,
            userId,
            venueId: invite.venueId,
            inviterId: invite.createdBy,
          },
          now,
        );
        return { company, invite };
      });
      notifications.flush();
      const places = await listWorkplaces(pool, userId, verificationRequired);
      const workplace = places.find((place) => place.company?.id === accepted.company.id);
      if (!workplace) throw venueMissing();
      return {
        workplace,
        companyName: accepted.company.name,
        inviterId: accepted.invite.createdBy,
      };
    },
  };
}
