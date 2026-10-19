import { isIsoDate, shiftDate } from '../diary/dates.ts';

const MINUTES_IN_DAY = 24 * 60;
const DAY_CLOSE_DELAY = 15;
const MONDAY_SHIFT = 6;

function minutes(clock: string): number {
  const [hours = '0', rest = '0'] = clock.split(':');
  return Number(hours) * 60 + Number(rest);
}

export function weekStartOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -((weekday + MONDAY_SHIFT) % 7));
}

export function previousWeekStart(today: string): string {
  return shiftDate(weekStartOf(today), -7);
}

export function defaultReportDay(
  venue: { opensAt: string; closesAt: string },
  today: string,
  localTime: string,
): string {
  const now = minutes(localTime);
  const opens = minutes(venue.opensAt);
  const closes = minutes(venue.closesAt);
  if (opens === closes) {
    return now >= MINUTES_IN_DAY - DAY_CLOSE_DELAY ? today : shiftDate(today, -1);
  }
  const closing = closes + DAY_CLOSE_DELAY;
  if (opens > closes) return now < closing ? shiftDate(today, -1) : today;
  return now >= closing ? today : shiftDate(today, -1);
}

export function parseWeekParam(value: string | null): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value ?? '');
  if (match === null) return null;
  const date = `${match[1] ?? ''}-${match[2] ?? ''}-${match[3] ?? ''}`;
  return isIsoDate(date) ? weekStartOf(date) : null;
}

export function maxWriteOff(row: { listed: number; soldViaApp: number; reserved: number }): number {
  return Math.max(0, row.listed - row.soldViaApp - row.reserved);
}
