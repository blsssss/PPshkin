const DAY_MS = 86_400_000;

export interface Ratio {
  numerator: number;
  denominator: number;
  value: number | null;
}

export function ratio(numerator: number, denominator: number): Ratio {
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 10_000,
  };
}

export function perWeek(count: number, days: number): number {
  return days <= 0 ? 0 : Math.round(((count * 7) / days) * 100) / 100;
}

export function periodDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvLine(cells: readonly (string | number | null)[]): string {
  return cells.map(csvCell).join(',');
}
