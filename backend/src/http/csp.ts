export const API_CSP_DIRECTIVES = {
  defaultSrc: ["'none'"],
  frameAncestors: ["'none'"],
};

export const DOCS_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const CSP_REPORT_TYPES = ['application/csp-report', 'application/reports+json'];
export const CSP_REPORT_MAX_BYTES = 8 * 1024;

const KNOWN_DIRECTIVES = new Set([
  'default-src',
  'script-src',
  'script-src-elem',
  'script-src-attr',
  'style-src',
  'style-src-elem',
  'style-src-attr',
  'img-src',
  'font-src',
  'connect-src',
  'media-src',
  'object-src',
  'frame-src',
  'child-src',
  'worker-src',
  'manifest-src',
  'base-uri',
  'form-action',
  'frame-ancestors',
  'trusted-types',
  'require-trusted-types-for',
]);
const MAX_REPORTS_PER_REQUEST = 20;
const MAX_SOURCE_LENGTH = 200;

export interface CspViolation {
  directive: string;
  blocked: string;
}

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[name] : undefined;
}

function directiveOf(raw: unknown): string {
  if (typeof raw !== 'string') return 'unknown';
  const name = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return KNOWN_DIRECTIVES.has(name) ? name : 'other';
}

function sourceOf(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return 'unknown';
  return (raw.split(/[?#]/)[0] ?? '').slice(0, MAX_SOURCE_LENGTH);
}

function legacyViolation(report: unknown): CspViolation {
  return {
    directive: directiveOf(field(report, 'effective-directive') ?? field(report, 'violated-directive')),
    blocked: sourceOf(field(report, 'blocked-uri')),
  };
}

function reportingApiViolation(body: unknown): CspViolation {
  return {
    directive: directiveOf(field(body, 'effectiveDirective')),
    blocked: sourceOf(field(body, 'blockedURL')),
  };
}

export function cspViolations(payload: unknown): CspViolation[] {
  if (Array.isArray(payload)) {
    return payload
      .filter((report) => field(report, 'type') === 'csp-violation')
      .slice(0, MAX_REPORTS_PER_REQUEST)
      .map((report) => reportingApiViolation(field(report, 'body')));
  }
  const report = field(payload, 'csp-report');
  return report === undefined ? [] : [legacyViolation(report)];
}

export function parseReportJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
