export interface LocalParts {
  date: string;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
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
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  return parts;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = numericParts(instant, timeZone);
  const date = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  return { date, hour: parts.hour, minute: parts.minute };
}

export function localDate(instant: Date, timeZone: string): string {
  return localParts(instant, timeZone).date;
}

export function formatLocalTime(instant: Date, timeZone: string): string {
  const { hour, minute } = localParts(instant, timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = numericParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function localMidnight(date: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(year, month - 1, day);
  let guess = naive - offsetMs(new Date(naive), timeZone);
  guess = naive - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

export function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function dayRange(date: string, timeZone: string): { from: Date; to: Date } {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return { from: localMidnight(date, timeZone), to: localMidnight(next, timeZone) };
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function minutesOfDay(clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}

export function isOpenAt(opensAt: string, closesAt: string, instant: Date, timeZone: string): boolean {
  const { hour, minute } = localParts(instant, timeZone);
  const now = hour * 60 + minute;
  const open = minutesOfDay(opensAt);
  const close = minutesOfDay(closesAt);
  if (open === close) return true;
  return open < close ? now >= open && now < close : now >= open || now < close;
}
