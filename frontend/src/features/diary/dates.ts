const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function toUtc(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (match === null) throw new Error(`Invalid date ${date}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function fromUtc(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  return fromUtc(toUtc(value)) === value;
}

export function shiftDate(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortDay = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', timeZone: 'UTC' });

export function formatLongDate(date: string): string {
  const time = toUtc(date);
  return `${weekday.format(time)}, ${dayMonth.format(time)}`;
}

export function dayTitle(date: string, today: string): string {
  const offset = daysBetween(date, today);
  if (offset === 0) return 'Сегодня';
  if (offset === 1) return 'Вчера';
  return formatLongDate(date);
}

export function weekdayShort(date: string): string {
  return weekday.format(toUtc(date));
}

export function dayOfMonth(date: string): string {
  return shortDay.format(toUtc(date));
}
