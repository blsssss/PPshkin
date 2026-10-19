import { describe, expect, it } from 'vitest';
import { cspViolations, parseReportJson } from './csp.ts';

describe('cspViolations', () => {
  it('reads the effective directive and drops the query and fragment of the blocked source', () => {
    expect(
      cspViolations({
        'csp-report': {
          'effective-directive': 'style-src-attr',
          'blocked-uri': 'https://cdn.example/a.css?token=1#x',
        },
      }),
    ).toEqual([{ directive: 'style-src-attr', blocked: 'https://cdn.example/a.css' }]);
  });

  it('falls back to the first word of the violated directive', () => {
    expect(
      cspViolations({ 'csp-report': { 'violated-directive': "script-src 'self'", 'blocked-uri': 'inline' } }),
    ).toEqual([{ directive: 'script-src', blocked: 'inline' }]);
  });

  it('keeps metric labels bounded', () => {
    expect(cspViolations({ 'csp-report': { 'effective-directive': 'made-up-src' } })).toEqual([
      { directive: 'other', blocked: 'unknown' },
    ]);
    expect(cspViolations({ 'csp-report': {} })).toEqual([{ directive: 'unknown', blocked: 'unknown' }]);
    const reports = Array.from({ length: 50 }, () => ({
      type: 'csp-violation',
      body: { effectiveDirective: 'img-src', blockedURL: `https://x.example/${'a'.repeat(500)}` },
    }));
    const violations = cspViolations(reports);
    expect(violations).toHaveLength(20);
    expect(violations[0]?.blocked).toHaveLength(200);
  });

  it('ignores payloads that are not CSP reports', () => {
    expect(cspViolations(null)).toEqual([]);
    expect(cspViolations('text')).toEqual([]);
    expect(cspViolations({ other: 1 })).toEqual([]);
    expect(cspViolations([{ type: 'intervention', body: {} }, 7])).toEqual([]);
  });
});

describe('parseReportJson', () => {
  it('returns null for invalid JSON', () => {
    expect(parseReportJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseReportJson('{')).toBeNull();
  });
});
