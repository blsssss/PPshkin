import type { SmokeEnv, SmokeResult } from './check.ts';

const SECRET_VARIABLES = [
  'MAX_BOT_TOKEN',
  'CHADGPT_API_KEY',
  'DEMO_GUEST_TOKEN',
  'DEMO_VENUE_TOKEN',
] as const;
const PLACEHOLDER = '[redacted]';

export type Redact = (text: string) => string;

export function secretRedactor(env: SmokeEnv): Redact {
  const secrets = [...new Set(SECRET_VARIABLES.map((name) => env[name]?.trim() ?? ''))]
    .filter((secret) => secret.length > 0)
    .sort((a, b) => b.length - a.length);
  return (text) => secrets.reduce((redacted, secret) => redacted.replaceAll(secret, PLACEHOLDER), text);
}

export function redactResults(results: readonly SmokeResult[], redact: Redact): SmokeResult[] {
  return results.map((result) => ({ ...result, name: redact(result.name), details: redact(result.details) }));
}
