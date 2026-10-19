import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveSessionSecret, issueSession, verifySession } from './session.ts';

const SECRET = 'session-secret-for-tests-0123456789';
const PREVIOUS = 'previous-session-secret-0123456789';
const NOW = new Date('2026-09-25T12:00:00Z');

function legacyToken(userId: number, expiresAt: Date, secret: string): string {
  const payload = `v1.${userId}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

describe('sessions', () => {
  it('issues a v2 token with the session epoch that verifies until it expires', () => {
    const session = issueSession(42, 3, SECRET, 3600, NOW);
    expect(session.token.startsWith('v2.42.3.')).toBe(true);
    expect(session.expiresAt.toISOString()).toBe('2026-09-25T13:00:00.000Z');
    expect(verifySession(session.token, [SECRET], NOW)).toEqual({
      userId: 42,
      epoch: 3,
      expiresAt: session.expiresAt,
    });
    expect(verifySession(session.token, [SECRET], new Date('2026-09-25T13:00:00Z'))).toBeNull();
  });

  it('rejects tokens signed with another secret', () => {
    const session = issueSession(42, 0, SECRET, 3600, NOW);
    expect(verifySession(session.token, [`${SECRET}x`], NOW)).toBeNull();
    expect(verifySession(session.token, [], NOW)).toBeNull();
  });

  it('accepts tokens signed with any of the configured secrets', () => {
    const session = issueSession(42, 0, PREVIOUS, 3600, NOW);
    expect(verifySession(session.token, [SECRET, PREVIOUS], NOW)).toMatchObject({ userId: 42 });
    expect(verifySession(session.token, [SECRET], NOW)).toBeNull();
  });

  it('keeps accepting v1 tokens until they expire and treats them as epoch 0', () => {
    const expiresAt = new Date('2026-09-25T13:00:00Z');
    const token = legacyToken(42, expiresAt, SECRET);
    expect(verifySession(token, [SECRET], NOW)).toEqual({ userId: 42, epoch: 0, expiresAt });
    expect(verifySession(token, [SECRET], expiresAt)).toBeNull();
  });

  it('rejects tokens whose claims were changed', () => {
    const [version, , epoch, expires, signature] = issueSession(42, 1, SECRET, 3600, NOW).token.split('.');
    expect(verifySession(`${version}.43.${epoch}.${expires}.${signature}`, [SECRET], NOW)).toBeNull();
    expect(verifySession(`${version}.42.2.${expires}.${signature}`, [SECRET], NOW)).toBeNull();
    expect(verifySession(`v1.42.${expires}.${signature}`, [SECRET], NOW)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    for (const token of [
      '',
      'v1',
      'v1.1.2',
      'v2.1.2.sig',
      'v1.a.2.sig',
      'v1.1.2.sig.extra',
      'v2.1.x.2.sig',
      'v2.1.1234567890.2.sig',
      'v3.1.0.2.sig',
    ]) {
      expect(verifySession(token, [SECRET], NOW)).toBeNull();
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
