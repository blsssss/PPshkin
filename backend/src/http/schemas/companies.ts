import { z } from 'zod';
import { PERMISSIONS, ROLES } from '../../domain/roles.ts';
import type { CompanyInvite } from '../../domain/models.ts';
import type { Workplace } from '../../services/access.ts';
import type {
  CompanyLookup,
  CompanyView,
  CreatedInvite,
  InvitePreview,
  MemberView,
} from '../../services/companies.ts';
import { IsoDateTime, iso } from './common.ts';
import { toVenue, VenueSchema } from './venues.ts';

const VERIFICATIONS = ['unverified', 'pending', 'verified', 'rejected'] as const;

const RoleSchema = z.enum(ROLES).meta({
  id: 'Role',
  description: 'Роль сотрудника: owner - владелец, manager - управляющий, cashier - кассир',
});

const VerificationSchema = z.enum(VERIFICATIONS).meta({
  id: 'Verification',
  description:
    'Проверка компании: unverified - без реквизитов, pending - на проверке у модератора, verified - подтверждена, rejected - отклонена',
});

const Inn = z
  .string()
  .regex(/^(\d{10}|\d{12})$/)
  .describe('ИНН: 10 цифр у юрлица, 12 у ИП; контрольные цифры проверяет сервер');

const Token = z
  .string()
  .regex(/^[A-Za-z0-9]{24}$/)
  .describe('Токен приглашения из ссылки');

export const MemberParams = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

export const InviteParams = z.object({
  id: z.coerce.number().int().positive(),
  inviteId: z.coerce.number().int().positive(),
});

export const LookupBody = z.object({ inn: Inn });

export const CompanyBody = z.object({
  inn: Inn,
  attest: z.literal(true).describe('Подтверждение «Я вправе представлять эту компанию», только true'),
});

export const MemberPatchBody = z
  .object({
    role: RoleSchema.optional(),
    venueId: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .describe('Заведение сотрудника; null - все заведения компании'),
  })
  .refine((patch) => patch.role !== undefined || patch.venueId !== undefined, 'Provide a field to change')
  .meta({ minProperties: 1 });

export const InviteBody = z.object({
  role: RoleSchema,
  venueId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Заведение приглашения; без него приглашение на все заведения компании'),
});

export const TokenBody = z.object({ token: Token });

const CompanyVenueSchema = z.object({ id: z.number().int(), name: z.string() });

export const CompanySchema = z
  .object({
    id: z.number().int(),
    kind: z.enum(['legal', 'individual']).nullable(),
    inn: z.string().nullable(),
    ogrn: z.string().nullable(),
    kpp: z.string().nullable(),
    name: z.string(),
    address: z.string().nullable(),
    okved: z.string().nullable(),
    registryStatus: z.string().nullable().describe('Статус в реестре: ACTIVE, LIQUIDATING и другие'),
    verification: VerificationSchema,
    verificationNote: z.string().nullable().describe('Причина отклонения от модератора'),
    venues: z.array(CompanyVenueSchema).describe('Заведения компании, доступные пользователю'),
  })
  .meta({ id: 'Company', description: 'Компания: юрлицо или ИП с реквизитами' });

export const CompanyLookupSchema = z
  .object({
    kind: z.enum(['legal', 'individual']),
    inn: z.string(),
    ogrn: z.string().nullable(),
    kpp: z.string().nullable(),
    name: z.string(),
    address: z.string().nullable(),
    okved: z.string().nullable(),
    status: z.string(),
    managerName: z.string().nullable(),
    okvedMatches: z.boolean().describe('Основной ОКВЭД относится к общепиту; несовпадение не блокирует'),
    alreadyRegistered: z.boolean().describe('Компания с этим ИНН уже подключена'),
  })
  .meta({ id: 'CompanyLookup', description: 'Карточка компании из ЕГРЮЛ или ЕГРИП' });

export const MemberSchema = z
  .object({
    userId: z.number().int(),
    firstName: z.string().nullable(),
    role: RoleSchema,
    venueId: z.number().int().nullable(),
    since: IsoDateTime,
  })
  .meta({ id: 'Member', description: 'Сотрудник компании' });

export const MemberListSchema = z.object({ items: z.array(MemberSchema) });

export const CreatedInviteSchema = z
  .object({
    id: z.number().int(),
    role: RoleSchema,
    venueId: z.number().int().nullable(),
    expiresAt: IsoDateTime,
    startappLink: z.string().describe('Ссылка на мини-приложение, показывается один раз'),
    botLink: z.string().describe('Ссылка на бота, показывается один раз'),
  })
  .meta({ id: 'CreatedInvite', description: 'Созданное приглашение со ссылками' });

const InviteSchema = z
  .object({
    id: z.number().int(),
    role: RoleSchema,
    venueId: z.number().int().nullable(),
    expiresAt: IsoDateTime,
    createdAt: IsoDateTime,
    createdBy: z.string().nullable().describe('Имя пригласившего'),
  })
  .meta({ id: 'Invite', description: 'Действующее приглашение' });

export const InviteListSchema = z.object({ items: z.array(InviteSchema) });

export const InvitePreviewSchema = z
  .object({
    companyName: z.string(),
    venueName: z.string().nullable().describe('null - все заведения компании'),
    role: RoleSchema,
    expiresAt: IsoDateTime,
  })
  .meta({ id: 'InvitePreview', description: 'Что получит сотрудник, приняв приглашение' });

export const WorkplaceSchema = z
  .object({
    venue: VenueSchema,
    company: z
      .object({ id: z.number().int(), name: z.string(), verification: VerificationSchema })
      .nullable()
      .describe('null у демо-заведения без компании'),
    role: RoleSchema,
    permissions: z
      .array(z.enum(PERMISSIONS))
      .describe('Права роли, их же проверяет сервер на каждом запросе'),
    venueScoped: z.boolean().describe('Доступ только к этому заведению, а не ко всем заведениям компании'),
  })
  .meta({ id: 'Workplace', description: 'Заведение, с которым работает пользователь, и его роль' });

export const WorkplaceListSchema = z.object({ items: z.array(WorkplaceSchema) });

export function toCompany({ company, venues }: CompanyView): z.infer<typeof CompanySchema> {
  return {
    id: company.id,
    kind: company.kind,
    inn: company.inn,
    ogrn: company.ogrn,
    kpp: company.kpp,
    name: company.name,
    address: company.address,
    okved: company.okved,
    registryStatus: company.registryStatus,
    verification: company.verification,
    verificationNote: company.verificationNote,
    venues,
  };
}

export function toCompanyLookup(lookup: CompanyLookup): z.infer<typeof CompanyLookupSchema> {
  const { company } = lookup;
  return {
    kind: company.kind,
    inn: company.inn,
    ogrn: company.ogrn,
    kpp: company.kpp,
    name: company.name,
    address: company.address,
    okved: company.okved,
    status: company.status,
    managerName: company.managerName,
    okvedMatches: lookup.okvedMatches,
    alreadyRegistered: lookup.alreadyRegistered,
  };
}

export function toMember(member: MemberView): z.infer<typeof MemberSchema> {
  return {
    userId: member.userId,
    firstName: member.firstName,
    role: member.role,
    venueId: member.venueId,
    since: iso(member.since),
  };
}

export function toCreatedInvite(created: CreatedInvite): z.infer<typeof CreatedInviteSchema> {
  return {
    id: created.invite.id,
    role: created.invite.role,
    venueId: created.invite.venueId,
    expiresAt: iso(created.invite.expiresAt),
    startappLink: created.startappLink,
    botLink: created.botLink,
  };
}

export function toInvite(invite: CompanyInvite): z.infer<typeof InviteSchema> {
  return {
    id: invite.id,
    role: invite.role,
    venueId: invite.venueId,
    expiresAt: iso(invite.expiresAt),
    createdAt: iso(invite.createdAt),
    createdBy: invite.createdByName,
  };
}

export function toInvitePreview(preview: InvitePreview): z.infer<typeof InvitePreviewSchema> {
  return {
    companyName: preview.companyName,
    venueName: preview.venueName,
    role: preview.role,
    expiresAt: iso(preview.expiresAt),
  };
}

export function toWorkplace(place: Workplace): z.infer<typeof WorkplaceSchema> {
  return {
    venue: toVenue(place.venue),
    company: place.company,
    role: place.role,
    permissions: [...place.permissions],
    venueScoped: place.venueScoped,
  };
}
