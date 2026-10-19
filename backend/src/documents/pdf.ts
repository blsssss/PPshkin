import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { ReportData } from '../domain/reports.ts';

const FONT_REGULAR = fileURLToPath(new URL('../../assets/fonts/PTSans-Regular.ttf', import.meta.url));
const FONT_BOLD = fileURLToPath(new URL('../../assets/fonts/PTSans-Bold.ttf', import.meta.url));

const MARGIN = 36;
const ROW_HEIGHT = 16;
const PAGE_HEIGHT = 841;
const COLUMNS = [
  { title: 'Дата', width: 52, align: 'left' },
  { title: 'Позиция', width: 130, align: 'left' },
  { title: 'Меню, ₽', width: 46, align: 'right' },
  { title: 'Горящая, ₽', width: 52, align: 'right' },
  { title: 'Выст.', width: 36, align: 'right' },
  { title: 'Продано', width: 44, align: 'right' },
  { title: 'Списано', width: 44, align: 'right' },
  { title: 'Без уч.', width: 38, align: 'right' },
  { title: 'Выручка, ₽', width: 54, align: 'right' },
  { title: 'Скидка, ₽', width: 46, align: 'right' },
] as const;

export interface ReportPdfInput {
  venueName: string;
  report: ReportData;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function cell(value: number | string | null): string {
  return value === null ? '' : String(value);
}

export function renderReportPdf({ venueName, report }: ReportPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, compress: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);

    doc.font(FONT_BOLD).fontSize(16).text(venueName, MARGIN, MARGIN);
    doc.font(FONT_REGULAR).fontSize(10).text(`Выставлено, продано, списано: ${report.from} - ${report.to}`);
    doc.moveDown(0.5);
    const summary = [
      `Выставлено ${report.listed}, продано по броням ${report.soldViaApp} (${percent(report.soldShare)})`,
      `Списано ${report.writtenOff} (${percent(report.writeOffShare)}), без учёта ${report.unaccounted}, не отмечено позиций ${report.notClosed}`,
      `Выручка ${report.revenueRub} ₽, скидка ${report.discountRub} ₽, новых гостей ${report.newGuests}`,
    ];
    for (const line of summary) doc.text(line);
    if (report.missingListPrice > 0) doc.text(`Нет цены в меню у ${report.missingListPrice} акций`);
    doc.moveDown(0.5);

    let y = doc.y;
    const drawRow = (cells: readonly string[], bold: boolean) => {
      let x = MARGIN;
      doc.font(bold ? FONT_BOLD : FONT_REGULAR).fontSize(8);
      COLUMNS.forEach((column, index) => {
        doc.text(cells[index] ?? '', x, y, {
          width: column.width - 4,
          height: ROW_HEIGHT,
          align: column.align,
          lineBreak: false,
          ellipsis: true,
        });
        x += column.width;
      });
      y += ROW_HEIGHT;
    };

    drawRow(
      COLUMNS.map((column) => column.title),
      true,
    );
    const capacity = Math.max(1, Math.floor((PAGE_HEIGHT - MARGIN - y) / ROW_HEIGHT) - 3);
    const shown = report.rows.slice(0, capacity);
    for (const row of shown) {
      drawRow(
        [
          row.date,
          row.itemName,
          cell(row.listPriceRub),
          cell(row.dealPriceRub),
          cell(row.listed),
          cell(row.soldViaApp),
          cell(row.writtenOff),
          cell(row.unaccounted),
          cell(row.revenueRub),
          cell(row.discountRub),
        ],
        false,
      );
    }
    drawRow(
      [
        'Итого',
        shown.length < report.rows.length ? `показано ${shown.length} из ${report.rows.length}` : '',
        '',
        '',
        cell(report.listed),
        cell(report.soldViaApp),
        cell(report.writtenOff),
        cell(report.unaccounted),
        cell(report.revenueRub),
        cell(report.discountRub),
      ],
      true,
    );
    doc.end();
  });
}
