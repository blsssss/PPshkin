import type { Venue } from '../domain/models.ts';
import { addDays, atLocalTime, localDate, minutesOfDay } from '../shared/time.ts';

export const DEAL_WINDOWS = ['morning', 'day', 'evening'] as const;
export type DealWindowName = (typeof DEAL_WINDOWS)[number];

export interface DealWindow {
  name: DealWindowName;
  startsAt: Date;
  endsAt: Date;
}

export type OpeningHours = Pick<Venue, 'opensAt' | 'closesAt' | 'timezone'>;

export interface OpeningPeriod {
  from: Date;
  to: Date;
}

const DAY_MINUTES = 24 * 60;
const MORNING_END = 12 * 60;
const DAY_END = 17 * 60;

function clockMinutes(clock: string): number {
  const minutes = minutesOfDay(clock);
  if (minutes === null) throw new RangeError(`Invalid time of day ${clock}`);
  return minutes;
}

function openMinutes({ opensAt, closesAt }: OpeningHours): { open: number; close: number } {
  const open = clockMinutes(opensAt);
  const close = clockMinutes(closesAt);
  return { open, close: close > open ? close : close + DAY_MINUTES };
}

function onDate(date: string, minutes: number, timeZone: string): Date {
  const days = Math.floor(minutes / DAY_MINUTES);
  return atLocalTime(addDays(date, days), minutes - days * DAY_MINUTES, timeZone);
}

export function openingPeriod(hours: OpeningHours, date: string): OpeningPeriod {
  const { open, close } = openMinutes(hours);
  return { from: onDate(date, open, hours.timezone), to: onDate(date, close, hours.timezone) };
}

export function dealWindows(hours: OpeningHours, date: string): DealWindow[] {
  const { open, close } = openMinutes(hours);
  const bounds: Record<DealWindowName, readonly [number, number]> = {
    morning: [open, Math.min(MORNING_END, close)],
    day: [Math.max(MORNING_END, open), Math.min(DAY_END, close)],
    evening: [Math.max(DAY_END, open), close],
  };
  return DEAL_WINDOWS.flatMap((name) => {
    const [start, end] = bounds[name];
    if (start >= end) return [];
    return [
      { name, startsAt: onDate(date, start, hours.timezone), endsAt: onDate(date, end, hours.timezone) },
    ];
  });
}

export function remainingDealWindows(hours: OpeningHours, now: Date): DealWindow[] {
  return dealWindows(hours, localDate(now, hours.timezone)).filter((window) => window.endsAt > now);
}
