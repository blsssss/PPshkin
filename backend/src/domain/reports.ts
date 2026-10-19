import { addDays } from '../shared/time.ts';

export const CLOSEOUT_MAX = 1000;
export const CLOSEOUT_EDIT_WINDOW_MS = 48 * 3_600_000;
export const DAY_CLOSE_DELAY_MINUTES = 15;
export const NOT_CLOSED_STREAK_DAYS = 3;

export type DealSource = 'manual' | 'pos';

export interface ReportDealFacts {
  dealId: number;
  date: string;
  menuItemId: number;
  itemName: string;
  listPriceRub: number | null;
  dealPriceRub: number;
  source: DealSource;
  listed: number;
  soldViaApp: number;
  reserved: number;
  revenueRub: number;
  writtenOff: number | null;
  finished: boolean;
}

export interface ReportRowData {
  dealId: number;
  date: string;
  menuItemId: number;
  itemName: string;
  listPriceRub: number | null;
  dealPriceRub: number;
  source: DealSource;
  listed: number;
  soldViaApp: number;
  reserved: number;
  writtenOff: number | null;
  unaccounted: number | null;
  revenueRub: number;
  discountRub: number;
  finished: boolean;
  notClosed: boolean;
}

export interface ReportData {
  from: string;
  to: string;
  timezone: string;
  listed: number;
  soldViaApp: number;
  reserved: number;
  writtenOff: number;
  unaccounted: number;
  notClosed: number;
  soldShare: number;
  writeOffShare: number;
  revenueRub: number;
  discountRub: number;
  newGuests: number;
  missingListPrice: number;
  rows: ReportRowData[];
}

export function share(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part * 100) / whole) / 100;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function reportRow(facts: ReportDealFacts): ReportRowData {
  const { listed, soldViaApp, writtenOff, finished, listPriceRub } = facts;
  return {
    dealId: facts.dealId,
    date: facts.date,
    menuItemId: facts.menuItemId,
    itemName: facts.itemName,
    listPriceRub,
    dealPriceRub: facts.dealPriceRub,
    source: facts.source,
    listed,
    soldViaApp,
    reserved: facts.reserved,
    writtenOff,
    unaccounted: finished && writtenOff !== null ? Math.max(0, listed - soldViaApp - writtenOff) : null,
    revenueRub: facts.revenueRub,
    discountRub: listPriceRub === null ? 0 : listPriceRub * soldViaApp - facts.revenueRub,
    finished,
    notClosed: finished && writtenOff === null && listed - soldViaApp > 0,
  };
}

export function isCountedDeal(facts: { cancelled: boolean; bookings: number }): boolean {
  return !facts.cancelled || facts.bookings > 0;
}

export function buildReport(input: {
  from: string;
  to: string;
  timezone: string;
  deals: readonly ReportDealFacts[];
  newGuests: number;
}): ReportData {
  const rows = input.deals
    .map(reportRow)
    .sort((left, right) => left.date.localeCompare(right.date) || left.dealId - right.dealId);
  const closed = rows.filter((row) => row.writtenOff !== null);
  const listed = sum(rows.map((row) => row.listed));
  const soldViaApp = sum(rows.map((row) => row.soldViaApp));
  const writtenOff = sum(closed.map((row) => row.writtenOff ?? 0));
  return {
    from: input.from,
    to: input.to,
    timezone: input.timezone,
    listed,
    soldViaApp,
    reserved: sum(rows.map((row) => row.reserved)),
    writtenOff,
    unaccounted: sum(rows.map((row) => row.unaccounted ?? 0)),
    notClosed: rows.filter((row) => row.notClosed).length,
    soldShare: share(soldViaApp, listed),
    writeOffShare: share(writtenOff, sum(closed.map((row) => row.listed))),
    revenueRub: sum(rows.map((row) => row.revenueRub)),
    discountRub: sum(rows.map((row) => row.discountRub)),
    newGuests: input.newGuests,
    missingListPrice: rows.filter((row) => row.listPriceRub === null).length,
    rows,
  };
}

export function unsoldPortions(row: Pick<ReportRowData, 'listed' | 'soldViaApp' | 'reserved'>): number {
  return Math.max(0, row.listed - row.soldViaApp - row.reserved);
}

export function closeableRows(rows: readonly ReportRowData[]): ReportRowData[] {
  return rows.filter((row) => row.notClosed && unsoldPortions(row) > 0);
}

export function notClosedByDay(rows: readonly ReportRowData[]): Map<string, number> {
  const days = new Map<string, number>();
  for (const row of rows) {
    if (row.notClosed) days.set(row.date, (days.get(row.date) ?? 0) + 1);
  }
  return days;
}

export function notClosedStreak(
  notClosed: ReadonlyMap<string, number>,
  today: string,
  days: number,
): string[] | null {
  const streak = Array.from({ length: days }, (_, index) => addDays(today, -(index + 1))).reverse();
  return streak.every((date) => (notClosed.get(date) ?? 0) > 0) ? streak : null;
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function weekStart(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

export function previousWeek(today: string): { from: string; to: string } {
  const from = addDays(weekStart(today), -7);
  return { from, to: addDays(from, 6) };
}

export function compactDate(date: string): string {
  return date.replaceAll('-', '');
}

export function parseCompactDate(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  return match ? `${match[1] ?? ''}-${match[2] ?? ''}-${match[3] ?? ''}` : null;
}
