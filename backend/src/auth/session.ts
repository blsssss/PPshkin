import { createHmac, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

export interface SessionClaims {
  userId: number;
  expiresAt: Date;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function deriveSessionSecret(
  explicit: string | undefined,
  botToken: string | undefined,
): string | null {
  if (explicit) return explicit;
  if (botToken) return createHmac('sha256', 'ppshkin-session').update(botToken).digest('base64url');
  return null;
}

export function issueSession(userId: number, secret: string, ttlSeconds: number, now: Date): IssuedSession {
  const expiresAtSeconds = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const payload = `${VERSION}.${userId}.${expiresAtSeconds}`;
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt: new Date(expiresAtSeconds * 1000) };
}

export function verifySession(token: string, secret: string, now: Date): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [version, userPart, expiresPart, signature] = parts as [string, string, string, string];
  if (version !== VERSION || !/^\d{1,16}$/.test(userPart) || !/^\d{1,12}$/.test(expiresPart)) return null;

  const expected = Buffer.from(sign(`${version}.${userPart}.${expiresPart}`, secret));
  const received = Buffer.from(signature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  const userId = Number(userPart);
  const expiresAt = new Date(Number(expiresPart) * 1000);
  if (!Number.isSafeInteger(userId) || userId <= 0 || expiresAt.getTime() <= now.getTime()) return null;
  return { userId, expiresAt };
}
