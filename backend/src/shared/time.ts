export interface LocalParts {
  date: string;
  hour: number;
  minute: number;
}

const DAY_MS = 86_400_000;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

const knownTimeZones = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(timeZone: string): boolean {
  return knownTimeZones.has(timeZone);
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    if (!isValidTimeZone(timeZone)) {
      throw new RangeError(`Unknown time zone ${timeZone}`);
    }
    cached = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

function numericParts(instant: Date, timeZone: string) {
  return Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = numericParts(instant, timeZone);
  return {
    date: `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`,
    hour: parts.hour,
    minute: parts.minute,
  };
}

export function localDate(instant: Date, timeZone: string): string {
  return localParts(instant, timeZone).date;
}

export function formatLocalTime(instant: Date, timeZone: string): string {
  const { hour, minute } = localParts(instant, timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

function offsetMs(instant: number, timeZone: string): number {
  const parts = numericParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

function utcMidnight(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  return value.getTime();
}

function localMidnight(date: string, timeZone: string): Date {
  const naive = utcMidnight(date);
  const candidates = [naive - offsetMs(naive - DAY_MS, timeZone), naive - offsetMs(naive + DAY_MS, timeZone)]
    .filter((candidate) => localDate(new Date(candidate), timeZone) === date)
    .sort((left, right) => left - right);
  const earliest = candidates[0] ?? naive - offsetMs(naive, timeZone);
  let start = earliest;
  while (localDate(new Date(start - 60_000), timeZone) === date) {
    start -= 60_000;
  }
  return new Date(start);
}

export function isLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  if (year < 1900 || year > 9999) return false;
  return new Date(utcMidnight(value)).toISOString().startsWith(value);
}

export function addDays(date: string, days: number): string {
  return new Date(utcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function dayRange(date: string, timeZone: string): { from: Date; to: Date } {
  return { from: localMidnight(date, timeZone), to: localMidnight(addDays(date, 1), timeZone) };
}

function minutesOfDay(clock: string): number | null {
  const match = CLOCK.exec(clock);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function isOpenAt(opensAt: string, closesAt: string, instant: Date, timeZone: string): boolean {
  const open = minutesOfDay(opensAt);
  const close = minutesOfDay(closesAt);
  if (open === null || close === null) return false;
  const { hour, minute } = localParts(instant, timeZone);
  const now = hour * 60 + minute;
  if (open === close) return true;
  return open < close ? now >= open && now < close : now >= open || now < close;
}
