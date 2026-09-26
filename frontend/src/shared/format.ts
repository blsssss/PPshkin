export const NBSP = ' ';

const priceFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function formatKcal(kcal: number): string {
  return `${Math.round(kcal)}${NBSP}ккал`;
}

export function formatKcalRange(min: number, max: number): string {
  const low = Math.round(Math.min(min, max));
  const high = Math.round(Math.max(min, max));
  return low === high ? formatKcal(low) : `${low}-${high}${NBSP}ккал`;
}

export function formatPrice(rub: number): string {
  return `${priceFormat.format(rub).replace(/\s/g, NBSP)}${NBSP}₽`;
}

export function formatDistance(meters: number): string {
  const rounded = Math.max(50, Math.round(meters / 50) * 50);
  if (rounded < 1000) return `${rounded}${NBSP}м`;
  const kilometers = Math.round(meters / 100) / 10;
  const text = Number.isInteger(kilometers) ? String(kilometers) : kilometers.toFixed(1).replace('.', ',');
  return `${text}${NBSP}км`;
}

export function formatLocalTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso));
}

export function plural(count: number, forms: readonly [string, string, string]): string {
  const value = Math.abs(Math.trunc(count));
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
