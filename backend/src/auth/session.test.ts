import { describe, expect, it } from 'vitest';
import { deriveSessionSecret, issueSession, verifySession } from './session.ts';

const SECRET = 'session-secret-for-tests-0123456789';
const NOW = new Date('2026-09-25T12:00:00Z');

describe('sessions', () => {
  it('issues a token that verifies until it expires', () => {
    const session = issueSession(42, SECRET, 3600, NOW);
    expect(session.expiresAt.toISOString()).toBe('2026-09-25T13:00:00.000Z');
    expect(verifySession(session.token, SECRET, NOW)).toEqual({ userId: 42, expiresAt: session.expiresAt });
    expect(verifySession(session.token, SECRET, new Date('2026-09-25T13:00:00Z'))).toBeNull();
  });

  it('rejects tokens signed with another secret', () => {
    const session = issueSession(42, SECRET, 3600, NOW);
    expect(verifySession(session.token, `${SECRET}x`, NOW)).toBeNull();
  });

  it('rejects tokens whose claims were changed', () => {
    const [version, , expires, signature] = issueSession(42, SECRET, 3600, NOW).token.split('.');
    expect(verifySession(`${version}.43.${expires}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    for (const token of ['', 'v1', 'v1.1.2', 'v2.1.2.sig', 'v1.a.2.sig', 'v1.1.2.sig.extra']) {
      expect(verifySession(token, SECRET, NOW)).toBeNull();
    }
  });

  it('derives a stable secret from the bot token when none is configured', () => {
    expect(deriveSessionSecret('explicit-secret', 'bot')).toBe('explicit-secret');
    const derived = deriveSessionSecret(undefined, 'bot-token');
    expect(derived).toBe(deriveSessionSecret(undefined, 'bot-token'));
    expect(derived).not.toContain('bot-token');
    expect(deriveSessionSecret(undefined, undefined)).toBeNull();
  });
});
