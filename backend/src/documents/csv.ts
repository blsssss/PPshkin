import type { ReportData } from '../domain/reports.ts';

export const CSV_HEADER = [
  'Дата',
  'Позиция',
  'Цена в меню, ₽',
  'Цена горящей, ₽',
  'Выставлено',
  'Продано по броням',
  'Списано',
  'Без учёта',
  'Выручка, ₽',
  'Скидка, ₽',
] as const;

const BOM = '\uFEFF';
const FORMULA_START = /^[=+\-@]/;

type Cell = string | number | null;

export function csvCell(value: Cell): string {
  if (value === null) return '""';
  const text = typeof value === 'number' ? String(value) : FORMULA_START.test(value) ? `'${value}` : value;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvLine(cells: readonly Cell[]): string {
  return cells.map(csvCell).join(';');
}

export function renderReportCsv(report: ReportData): Buffer {
  const lines = [
    csvLine(CSV_HEADER),
    ...report.rows.map((row) =>
      csvLine([
        row.date,
        row.itemName,
        row.listPriceRub,
        row.dealPriceRub,
        row.listed,
        row.soldViaApp,
        row.writtenOff,
        row.unaccounted,
        row.revenueRub,
        row.discountRub,
      ]),
    ),
    csvLine([
      'Итого',
      null,
      null,
      null,
      report.listed,
      report.soldViaApp,
      report.writtenOff,
      report.unaccounted,
      report.revenueRub,
      report.discountRub,
    ]),
  ];
  return Buffer.from(`${BOM}${lines.join('\r\n')}\r\n`, 'utf8');
}
