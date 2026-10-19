import { describe, expect, it } from 'vitest';
import { buildReport, type ReportDealFacts } from '../domain/reports.ts';
import { renderReportPdf } from './pdf.ts';

const deal = (dealId: number): ReportDealFacts => ({
  dealId,
  date: '2026-10-18',
  menuItemId: 11,
  itemName: `Круассан ${dealId}`,
  listPriceRub: 200,
  dealPriceRub: 120,
  source: 'manual',
  listed: 10,
  soldViaApp: 4,
  reserved: 0,
  revenueRub: 480,
  writtenOff: 3,
  finished: true,
});

const report = (count: number) =>
  buildReport({
    from: '2026-10-18',
    to: '2026-10-18',
    timezone: 'Europe/Moscow',
    deals: Array.from({ length: count }, (_, index) => deal(index + 1)),
    newGuests: 1,
  });

function pages(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}

describe('report PDF', () => {
  it('is a PDF with the Cyrillic font embedded', async () => {
    const pdf = await renderReportPdf({ venueName: 'Кофейня «Зерно»', report: report(3) });
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.toString('latin1')).toContain('PTSans');
    expect(pdf.length).toBeGreaterThan(5000);
    expect(pages(pdf)).toBe(1);
  });

  it('keeps a long report on one page', async () => {
    const pdf = await renderReportPdf({ venueName: 'Кофейня', report: report(120) });
    expect(pages(pdf)).toBe(1);
  });

  it('renders an empty report', async () => {
    const pdf = await renderReportPdf({ venueName: 'Кофейня', report: report(0) });
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
