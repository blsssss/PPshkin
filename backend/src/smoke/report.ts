import { SMOKE_STATUSES, type SmokeResult } from './check.ts';

const TITLE = '## Живые проверки';
const HEADER = ['| Проверка | Результат | Время | Детали |', '|---|---|---|---|'];

const cell = (text: string) => text.replace(/\s*\r?\n\s*/g, ' ').replaceAll('|', '\\|');

function duration({ status, durationMs }: SmokeResult): string {
  if (status === 'skipped') return '-';
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

export function renderReport(results: readonly SmokeResult[]): string {
  const rows = results.map(
    (result) => `| ${cell(result.name)} | ${result.status} | ${duration(result)} | ${cell(result.details)} |`,
  );
  const totals = SMOKE_STATUSES.map(
    (status) => `${status} ${results.filter((result) => result.status === status).length}`,
  ).join(', ');
  return [TITLE, '', ...HEADER, ...rows, '', `Итого: ${totals}`, ''].join('\n');
}
