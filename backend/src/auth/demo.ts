import { timingSafeEqual } from 'node:crypto';

export const DEMO_ACCOUNTS = {
  guest: { userId: 9_000_000_001, firstName: 'Демо-гость' },
  venue: { userId: 9_000_000_002, firstName: 'Демо-заведение' },
} as const;

export type DemoRole = keyof typeof DEMO_ACCOUNTS;

export interface DemoTokens {
  guest?: string | undefined;
  venue?: string | undefined;
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function matchDemoToken(token: string, tokens: DemoTokens): DemoRole | null {
  for (const role of Object.keys(DEMO_ACCOUNTS) as DemoRole[]) {
    const expected = tokens[role];
    if (expected && sameSecret(token, expected)) return role;
  }
  return null;
}
