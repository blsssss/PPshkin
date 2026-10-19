import { z } from 'zod';
import {
  BLOCK_REASON_LIMIT,
  COMPLAINT_DECISIONS,
  COMPLAINT_REASONS,
  COMPLAINT_REASON_TEXTS,
  COMPLAINT_STATUSES,
  COMPLAINT_TEXT_LIMIT,
  type AdminComplaint,
  type Complaint,
} from '../../domain/moderation.ts';
import { IsoDateTime, iso, isoOrNull } from './common.ts';

const Id = z.number().int().positive();

const ReasonSchema = z
  .enum(COMPLAINT_REASONS)
  .describe(
    `Причина: ${COMPLAINT_REASONS.map((reason) => `${reason} - ${COMPLAINT_REASON_TEXTS[reason]}`).join('; ')}`,
  );

export const ComplaintBody = z
  .object({
    venueId: Id.describe('Заведение, на которое жалоба'),
    bookingId: Id.optional().describe('Бронь гостя в этом заведении; на одну бронь одна жалоба'),
    reason: ReasonSchema,
    text: z
      .string()
      .max(COMPLAINT_TEXT_LIMIT)
      .optional()
      .describe(`Пояснение гостя, до ${String(COMPLAINT_TEXT_LIMIT)} символов`),
  })
  .meta({ id: 'ComplaintRequest', description: 'Жалоба гостя на заведение или бронь' });

export const ComplaintSchema = z
  .object({
    id: z.number().int(),
    venueId: z.number().int(),
    bookingId: z.number().int().nullable(),
    reason: ReasonSchema,
    status: z
      .enum(COMPLAINT_STATUSES)
      .describe('open - ждёт решения, resolved - решена, rejected - отклонена'),
    createdAt: IsoDateTime,
    resolvedAt: IsoDateTime.nullable(),
  })
  .meta({ id: 'Complaint', description: 'Жалоба гостя' });

export const ComplaintListSchema = z
  .object({ items: z.array(ComplaintSchema).describe('Жалобы гостя, сначала новые') })
  .meta({ id: 'ComplaintList' });

export const AdminComplaintSchema = ComplaintSchema.extend({
  text: z.string().nullable().describe('Пояснение гостя'),
  venueName: z.string(),
  bookingCode: z.string().nullable(),
  itemName: z.string().nullable(),
  resolution: z.string().nullable().describe('Комментарий администратора к решению'),
}).meta({ id: 'AdminComplaint', description: 'Жалоба в очереди администратора' });

export const AdminComplaintListSchema = z
  .object({ items: z.array(AdminComplaintSchema) })
  .meta({ id: 'AdminComplaintList' });

export const AdminComplaintQuery = z.object({
  status: z.enum(COMPLAINT_STATUSES).default('open').describe('Какие жалобы показать'),
});

export const ResolutionBody = z
  .object({
    status: z.enum(COMPLAINT_DECISIONS).describe('resolved - решена, rejected - отклонена'),
    resolution: z.string().max(500).optional().describe('Комментарий, до 500 символов'),
  })
  .meta({ id: 'ComplaintResolution', description: 'Решение по жалобе' });

export const BlockBody = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(BLOCK_REASON_LIMIT)
      .describe(`Причина блокировки, до ${String(BLOCK_REASON_LIMIT)} символов`),
  })
  .meta({ id: 'BlockRequest', description: 'Причина блокировки' });

export const BlockStateSchema = z
  .object({ blocked: z.boolean().describe('true - заблокировано, false - блокировка снята') })
  .meta({ id: 'BlockState', description: 'Состояние блокировки после действия' });

export function toComplaint(complaint: Complaint): z.infer<typeof ComplaintSchema> {
  return {
    id: complaint.id,
    venueId: complaint.venueId,
    bookingId: complaint.bookingId,
    reason: complaint.reason,
    status: complaint.status,
    createdAt: iso(complaint.createdAt),
    resolvedAt: isoOrNull(complaint.resolvedAt),
  };
}

export function toAdminComplaint(complaint: AdminComplaint): z.infer<typeof AdminComplaintSchema> {
  return {
    ...toComplaint(complaint),
    text: complaint.text,
    venueName: complaint.venueName,
    bookingCode: complaint.bookingCode,
    itemName: complaint.itemName,
    resolution: complaint.resolution,
  };
}
