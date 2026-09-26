const INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (cached === undefined) {
    cached = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

function parts(date: Date, timeZone: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(date)) result[part.type] = part.value;
  return result;
}

export function toZonedInput(date: Date, timeZone: string): string {
  const value = parts(date, timeZone);
  return `${value.year ?? ''}-${value.month ?? ''}-${value.day ?? ''}T${value.hour ?? ''}:${value.minute ?? ''}`;
}

export function zonedDate(date: Date, timeZone: string): string {
  return toZonedInput(date, timeZone).slice(0, 10);
}

function offsetMs(time: number, timeZone: string): number {
  const value = toZonedInput(new Date(time), timeZone);
  const match = INPUT_PATTERN.exec(value);
  if (match === null) return 0;
  const asUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  return asUtc - Math.floor(time / 60_000) * 60_000;
}

export function fromZonedInput(value: string, timeZone: string): Date | null {
  const match = INPUT_PATTERN.exec(value);
  if (match === null) return null;
  const wall = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  if (Number.isNaN(wall)) return null;
  let guess = wall - offsetMs(wall, timeZone);
  guess = wall - offsetMs(guess, timeZone);
  return new Date(guess);
}
