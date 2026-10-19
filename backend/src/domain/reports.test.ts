import { describe, expect, it } from 'vitest';
import {
  buildReport,
  closeableRows,
  compactDate,
  isCountedDeal,
  notClosedByDay,
  notClosedStreak,
  parseCompactDate,
  previousWeek,
  reportRow,
  share,
  unsoldPortions,
  weekStart,
  type ReportDealFacts,
} from './reports.ts';

function deal(overrides: Partial<ReportDealFacts> = {}): ReportDealFacts {
  return {
    dealId: 1,
    date: '2026-10-18',
    menuItemId: 11,
    itemName: 'Круассан',
    listPriceRub: 200,
    dealPriceRub: 120,
    source: 'manual',
    listed: 10,
    soldViaApp: 4,
    reserved: 0,
    revenueRub: 480,
    writtenOff: null,
    finished: true,
    ...overrides,
  };
}

describe('report row', () => {
  it('counts the discount from the menu price and the revenue of redeemed bookings', () => {
    expect(reportRow(deal()).discountRub).toBe(4 * 200 - 480);
  });

  it('does not count the discount without a menu price', () => {
    expect(reportRow(deal({ listPriceRub: null })).discountRub).toBe(0);
  });

  it('leaves unaccounted empty until the write-off is marked', () => {
    const row = reportRow(deal());
    expect(row.unaccounted).toBeNull();
    expect(row.notClosed).toBe(true);
  });

  it('computes unaccounted for a closed finished deal', () => {
    const row = reportRow(deal({ writtenOff: 3 }));
    expect(row).toMatchObject({ unaccounted: 3, notClosed: false });
  });

  it('never goes below zero when bookings were redeemed after the mark', () => {
    expect(reportRow(deal({ soldViaApp: 9, writtenOff: 5 })).unaccounted).toBe(0);
  });

  it('does not wait for a mark on a running deal', () => {
    expect(reportRow(deal({ finished: false, reserved: 2 }))).toMatchObject({
      notClosed: false,
      unaccounted: null,
    });
  });

  it('does not ask for a mark when everything was sold', () => {
    expect(reportRow(deal({ soldViaApp: 10 })).notClosed).toBe(false);
  });

  it('counts unsold portions without reserved ones', () => {
    expect(unsoldPortions({ listed: 10, soldViaApp: 4, reserved: 2 })).toBe(4);
    expect(unsoldPortions({ listed: 3, soldViaApp: 3, reserved: 1 })).toBe(0);
  });
});

describe('report', () => {
  const base = { from: '2026-10-18', to: '2026-10-18', timezone: 'Europe/Moscow', newGuests: 2 };

  it('sums the day and rounds shares to hundredths', () => {
    const report = buildReport({
      ...base,
      deals: [
        deal({ dealId: 2, itemName: 'Эклер', listed: 5, soldViaApp: 5, revenueRub: 600, writtenOff: 0 }),
        deal({ dealId: 1, writtenOff: 2 }),
      ],
    });
    expect(report).toMatchObject({
      listed: 15,
      soldViaApp: 9,
      writtenOff: 2,
      unaccounted: 4,
      notClosed: 0,
      soldShare: 0.6,
      writeOffShare: 0.13,
      revenueRub: 1080,
      newGuests: 2,
      missingListPrice: 0,
    });
    expect(report.rows.map((row) => row.dealId)).toEqual([1, 2]);
  });

  it('returns zeros for an empty period', () => {
    expect(buildReport({ ...base, deals: [] })).toMatchObject({
      listed: 0,
      soldShare: 0,
      writeOffShare: 0,
      rows: [],
    });
  });

  it('counts write-off share only over deals with a mark', () => {
    const report = buildReport({
      ...base,
      deals: [deal({ dealId: 1, writtenOff: 3 }), deal({ dealId: 2, listed: 100, soldViaApp: 0 })],
    });
    expect(report.writeOffShare).toBe(0.3);
    expect(report.notClosed).toBe(1);
  });

  it('counts deals without a menu price', () => {
    const report = buildReport({ ...base, deals: [deal({ listPriceRub: null }), deal({ dealId: 2 })] });
    expect(report.missingListPrice).toBe(1);
  });

  it('sorts rows by day and deal', () => {
    const report = buildReport({
      ...base,
      deals: [deal({ dealId: 3, date: '2026-10-19' }), deal({ dealId: 5 }), deal({ dealId: 4 })],
    });
    expect(report.rows.map((row) => row.dealId)).toEqual([4, 5, 3]);
  });
});

describe('counted deals', () => {
  it('skips a deal cancelled before the first booking', () => {
    expect(isCountedDeal({ cancelled: true, bookings: 0 })).toBe(false);
    expect(isCountedDeal({ cancelled: true, bookings: 1 })).toBe(true);
    expect(isCountedDeal({ cancelled: false, bookings: 0 })).toBe(true);
  });
});

describe('closeable rows', () => {
  it('lists finished deals with portions to write off', () => {
    const rows = [
      reportRow(deal({ dealId: 1 })),
      reportRow(deal({ dealId: 2, writtenOff: 1 })),
      reportRow(deal({ dealId: 3, soldViaApp: 10 })),
      reportRow(deal({ dealId: 4, soldViaApp: 5, reserved: 5 })),
    ];
    expect(closeableRows(rows).map((row) => row.dealId)).toEqual([1]);
  });
});

describe('not closed streak', () => {
  const rows = (dates: string[]) => notClosedByDay(dates.map((date) => reportRow(deal({ date }))));

  it('finds three full days before today', () => {
    const missed = rows(['2026-10-15', '2026-10-16', '2026-10-17']);
    expect(notClosedStreak(missed, '2026-10-18', 3)).toEqual(['2026-10-15', '2026-10-16', '2026-10-17']);
  });

  it('does not count today', () => {
    expect(notClosedStreak(rows(['2026-10-16', '2026-10-17', '2026-10-18']), '2026-10-18', 3)).toBeNull();
  });

  it('breaks on a gap', () => {
    expect(notClosedStreak(rows(['2026-10-15', '2026-10-17']), '2026-10-18', 3)).toBeNull();
  });

  it('ignores closed deals', () => {
    const closed = notClosedByDay([reportRow(deal({ date: '2026-10-17', writtenOff: 1 }))]);
    expect(closed.size).toBe(0);
  });
});

describe('week helpers', () => {
  it('finds the Monday of the week', () => {
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(weekStart('2026-10-25')).toBe('2026-10-19');
  });

  it('returns the previous week from a Monday', () => {
    expect(previousWeek('2026-10-19')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });

  it('round-trips compact dates', () => {
    expect(compactDate('2026-10-12')).toBe('20261012');
    expect(parseCompactDate('20261012')).toBe('2026-10-12');
    expect(parseCompactDate('2026-10-12')).toBeNull();
  });

  it('rounds shares to hundredths', () => {
    expect(share(1, 3)).toBe(0.33);
    expect(share(1, 0)).toBe(0);
  });
});
