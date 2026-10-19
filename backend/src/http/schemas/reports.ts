import { z } from 'zod';
import { CLOSEOUT_MAX, type ReportData, type ReportRowData } from '../../domain/reports.ts';
import type { CloseoutView } from '../../services/reports.ts';
import { IsoDateTime, iso, LocalDate, localDateParam, optionalLocalDate } from './common.ts';

const Count = z.number().int();
const Rub = z.number().int().describe('Рубли');

export const DayReportQuery = z.object({
  date: optionalLocalDate('День YYYY-MM-DD по часовому поясу заведения, по умолчанию сегодня'),
});

export const ReportQuery = z.object({
  from: localDateParam('Первый день периода YYYY-MM-DD по часовому поясу заведения'),
  to: localDateParam('Последний день периода включительно'),
});

export const CloseoutBody = z.object({
  writtenOff: z.number().int().min(0).max(CLOSEOUT_MAX).describe('Сколько порций списали'),
});

export const ExportBody = ReportQuery.extend({
  format: z.enum(['csv', 'pdf']).describe('Формат файла, который придёт в чат с ботом'),
});

export const ExportAcceptedSchema = z
  .object({ status: z.literal('sending') })
  .meta({ id: 'ReportExportAccepted', description: 'Файл отправляется в чат с ботом' });

const VenueReportRowSchema = z
  .object({
    dealId: z.number().int(),
    date: LocalDate.describe('День начала горящей позиции по часовому поясу заведения'),
    menuItemId: z.number().int(),
    itemName: z.string(),
    listPriceRub: Rub.nullable().describe('Цена в меню на момент акции; null у старых акций'),
    dealPriceRub: Rub.describe('Цена горящей позиции'),
    source: z.enum(['manual', 'pos']).describe('Откуда пришла акция'),
    listed: Count.describe('Выставлено порций'),
    soldViaApp: Count.describe('Погашено броней'),
    reserved: Count.describe('Активных броней'),
    writtenOff: Count.nullable().describe('Списано по отметке заведения; null, пока не отмечено'),
    unaccounted: Count.nullable().describe(
      'Продано на кассе без брони или осталось: listed - soldViaApp - writtenOff у закрытых акций; null до отметки списания',
    ),
    revenueRub: Rub.describe('Выручка по погашенным броням'),
    discountRub: Rub.describe('Сумма скидок по погашенным броням; 0, если цены в меню нет'),
  })
  .meta({ id: 'VenueReportRow', description: 'Строка отчёта: одна горящая позиция' });

export const VenueReportSchema = z
  .object({
    from: LocalDate,
    to: LocalDate,
    timezone: z.string().describe('Часовой пояс заведения, по которому считаются дни'),
    listed: Count.describe('Выставлено порций'),
    soldViaApp: Count.describe('Погашено броней'),
    reserved: Count.describe('Активных броней'),
    writtenOff: Count.describe('Списано по отметкам'),
    unaccounted: Count.describe('Продано без брони или осталось, у закрытых акций'),
    notClosed: Count.describe('Закончившихся позиций без отметки списания'),
    soldShare: z.number().describe('soldViaApp / listed, до сотых; 0 при нуле выставленного'),
    writeOffShare: z.number().describe('writtenOff / listed по акциям с отметкой, до сотых'),
    revenueRub: Rub,
    discountRub: Rub,
    newGuests: Count.describe('Гости, у которых первая погашенная бронь в заведении попала в период'),
    missingListPrice: Count.describe('Сколько акций без цены в меню: их скидка не считается'),
    rows: z.array(VenueReportRowSchema),
  })
  .meta({
    id: 'VenueReport',
    description:
      'Отчёт заведения «выставлено / продано / списано». Позиция относится ко дню своего начала. Данных гостей в ответе нет',
  });

export const DealCloseoutSchema = z
  .object({
    dealId: z.number().int(),
    writtenOff: Count,
    closedAt: IsoDateTime,
    closedBy: z.string().nullable().describe('Имя сотрудника, который отметил списание'),
    channel: z.enum(['bot', 'miniapp']),
  })
  .meta({ id: 'DealCloseout', description: 'Отметка списания по горящей позиции' });

function toRow(row: ReportRowData): z.infer<typeof VenueReportRowSchema> {
  return {
    dealId: row.dealId,
    date: row.date,
    menuItemId: row.menuItemId,
    itemName: row.itemName,
    listPriceRub: row.listPriceRub,
    dealPriceRub: row.dealPriceRub,
    source: row.source,
    listed: row.listed,
    soldViaApp: row.soldViaApp,
    reserved: row.reserved,
    writtenOff: row.writtenOff,
    unaccounted: row.unaccounted,
    revenueRub: row.revenueRub,
    discountRub: row.discountRub,
  };
}

export function toVenueReport(report: ReportData): z.infer<typeof VenueReportSchema> {
  return {
    from: report.from,
    to: report.to,
    timezone: report.timezone,
    listed: report.listed,
    soldViaApp: report.soldViaApp,
    reserved: report.reserved,
    writtenOff: report.writtenOff,
    unaccounted: report.unaccounted,
    notClosed: report.notClosed,
    soldShare: report.soldShare,
    writeOffShare: report.writeOffShare,
    revenueRub: report.revenueRub,
    discountRub: report.discountRub,
    newGuests: report.newGuests,
    missingListPrice: report.missingListPrice,
    rows: report.rows.map(toRow),
  };
}

export function toDealCloseout(view: CloseoutView): z.infer<typeof DealCloseoutSchema> {
  return {
    dealId: view.dealId,
    writtenOff: view.writtenOff,
    closedAt: iso(view.closedAt),
    closedBy: view.closedBy,
    channel: view.channel,
  };
}
