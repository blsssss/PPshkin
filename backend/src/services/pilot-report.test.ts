import { describe, expect, it } from 'vitest';
import { parseReportArgs } from './pilot-report.ts';

describe('parseReportArgs', () => {
  it('reads the period, the venue and the format', () => {
    expect(parseReportArgs(['--from', '2026-11-02', '--to', '2026-11-08'])).toEqual({
      from: '2026-11-02',
      to: '2026-11-08',
      venueId: null,
      format: 'csv',
    });
    expect(
      parseReportArgs(['--from', '2026-11-02', '--to', '2026-11-08', '--venue', '12', '--format', 'json']),
    ).toEqual({ from: '2026-11-02', to: '2026-11-08', venueId: 12, format: 'json' });
  });

  it.each([
    [[]],
    [['--from', '2026-11-08', '--to', '2026-11-02']],
    [['--from', '2026-13-01', '--to', '2026-13-02']],
    [['--from', '2026-11-02', '--to', '2026-11-08', '--venue', '0']],
    [['--from', '2026-11-02', '--to', '2026-11-08', '--format', 'xml']],
    [['--from', '2026-11-02', '--to']],
  ])('rejects %j', (argv) => {
    expect(() => parseReportArgs(argv)).toThrow();
  });
});
