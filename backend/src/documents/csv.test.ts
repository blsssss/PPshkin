import { describe, expect, it } from 'vitest';
import { buildReport, type ReportDealFacts } from '../domain/reports.ts';
import { csvCell, CSV_HEADER, renderReportCsv } from './csv.ts';

const deal: ReportDealFacts = {
  dealId: 1,
  date: '2026-10-18',
  menuItemId: 11,
  itemName: 'Круассан "Классик"',
  listPriceRub: 200,
  dealPriceRub: 120,
  source: 'manual',
  listed: 10,
  soldViaApp: 4,
  reserved: 0,
  revenueRub: 480,
  writtenOff: 3,
  finished: true,
};

function render(overrides: Partial<ReportDealFacts> = {}): string {
  const report = buildReport({
    from: '2026-10-18',
    to: '2026-10-18',
    timezone: 'Europe/Moscow',
    deals: [{ ...deal, ...overrides }],
    newGuests: 0,
  });
  return renderReportCsv(report).toString('utf8');
}

describe('report CSV', () => {
  it('starts with a byte order mark', () => {
    const bytes = renderReportCsv(
      buildReport({ from: 'a', to: 'b', timezone: 'UTC', deals: [], newGuests: 0 }),
    );
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('separates columns with a semicolon and quotes every value', () => {
    const [header, row, total] = render().slice(1).split('\r\n');
    expect(header).toBe(CSV_HEADER.map((title) => `"${title}"`).join(';'));
    expect(row).toBe('"2026-10-18";"Круассан ""Классик""";"200";"120";"10";"4";"3";"3";"480";"320"');
    expect(total).toBe('"Итого";"";"";"";"10";"4";"3";"3";"480";"320"');
  });

  it('leaves unknown values empty', () => {
    const [, row] = render({ writtenOff: null, listPriceRub: null }).slice(1).split('\r\n');
    expect(row?.split(';')[2]).toBe('""');
    expect(row?.split(';')[6]).toBe('""');
  });

  it.each(['=SUM(A1)', '+1', '-1', '@cmd'])('guards a cell that starts with %s', (name) => {
    expect(csvCell(name)).toBe(`"'${name}"`);
    expect(render({ itemName: name })).toContain(`;"'${name}";`);
  });

  it('does not touch numbers and ordinary text', () => {
    expect(csvCell(-5)).toBe('"-5"');
    expect(csvCell('Эклер')).toBe('"Эклер"');
  });
});
