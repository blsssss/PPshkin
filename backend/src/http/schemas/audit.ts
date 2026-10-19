import { z } from 'zod';
import type { AuditPageView } from '../../services/audit.ts';
import { IsoDateTime, iso } from './common.ts';

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const AuditQuerySchema = z.object({
  from: LocalDate.optional().describe('Первый день периода в часовом поясе заведения, YYYY-MM-DD'),
  to: LocalDate.optional().describe('Последний день периода в часовом поясе заведения, YYYY-MM-DD'),
  cursor: z
    .string()
    .regex(/^[1-9][0-9]{0,17}$/)
    .optional()
    .describe('nextCursor из предыдущей страницы'),
});

const AuditEventSchema = z
  .object({
    id: z.number().int(),
    action: z
      .string()
      .describe(
        'Действие: booking.redeem, deal.create, deal.update, deal.cancel, menu_item.create, menu_item.update, menu_item.archive, menu_import.apply, venue.update',
      ),
    actor: z
      .object({
        userId: z.number().int(),
        name: z.string().nullable(),
        role: z.enum(['owner', 'manager', 'cashier']),
      })
      .nullable()
      .describe('Кто выполнил действие; null, если аккаунт удалён'),
    target: z.object({
      type: z.string().describe('booking, deal, menu_item, menu_import, venue или staff'),
      id: z.number().int().nullable(),
    }),
    details: z
      .record(z.string(), z.unknown())
      .describe('Подробности действия и канал (bot или miniapp); данных гостя здесь нет, только код брони'),
    createdAt: IsoDateTime,
  })
  .meta({ id: 'AuditEvent', description: 'Запись журнала действий в заведении' });

export const AuditPageSchema = z
  .object({
    items: z.array(AuditEventSchema).describe('До 100 записей, новые сверху'),
    nextCursor: z.string().nullable().describe('Курсор следующей страницы или null, если записей больше нет'),
  })
  .meta({ id: 'AuditPage', description: 'Страница журнала действий' });

export function toAuditPage(page: AuditPageView): z.infer<typeof AuditPageSchema> {
  return {
    items: page.items.map((item) => ({ ...item, createdAt: iso(item.createdAt) })),
    nextCursor: page.nextCursor,
  };
}
