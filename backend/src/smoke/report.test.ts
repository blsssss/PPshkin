import { describe, expect, it } from 'vitest';
import { renderReport } from './report.ts';

describe('renderReport', () => {
  it('renders a Markdown table with the result, the time and the details of every check', () => {
    const report = renderReport([
      { name: 'max.me', status: 'ok', durationMs: 412, details: 'username ppshkin_bot' },
      {
        name: 'recognition.photo',
        status: 'failed',
        durationMs: 46_140,
        details: 'gpt-6-luna | slow\nsecond line',
      },
      { name: 'api.health', status: 'skipped', durationMs: 0, details: 'PUBLIC_BASE_URL is not set' },
    ]);

    expect(report).toBe(
      [
        '## Живые проверки',
        '',
        '| Проверка | Результат | Время | Детали |',
        '|---|---|---|---|',
        '| max.me | ok | 412 ms | username ppshkin_bot |',
        '| recognition.photo | failed | 46.1 s | gpt-6-luna \\| slow second line |',
        '| api.health | skipped | - | PUBLIC_BASE_URL is not set |',
        '',
        'Итого: ok 1, failed 1, skipped 1',
        '',
      ].join('\n'),
    );
  });

  it('shows the time of a failed check that did not start and an empty table without checks', () => {
    expect(renderReport([{ name: 'site.health', status: 'failed', durationMs: 0, details: '' }])).toContain(
      '| site.health | failed | 0 ms |  |',
    );
    expect(renderReport([])).toContain('|---|---|---|---|\n\nИтого: ok 0, failed 0, skipped 0\n');
  });
});
