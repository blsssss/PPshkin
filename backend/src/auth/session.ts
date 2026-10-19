import { createHmac, timingSafeEqual } from 'node:crypto';

const LEGACY_VERSION = 'v1';
const VERSION = 'v2';

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

export interface SessionClaims {
  userId: number;
  epoch: number;
  expiresAt: Date;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function signedBy(payload: string, signature: string, secrets: readonly string[]): boolean {
  const received = Buffer.from(signature);
  return secrets.some((secret) => {
    const expected = Buffer.from(sign(payload, secret));
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

export function deriveSessionSecret(
  explicit: string | undefined,
  botToken: string | undefined,
): string | null {
  if (explicit) return explicit;
  if (botToken) return createHmac('sha256', 'ppshkin-session').update(botToken).digest('base64url');
  return null;
}

export function issueSession(
  userId: number,
  epoch: number,
  secret: string,
  ttlSeconds: number,
  now: Date,
): IssuedSession {
  const expiresAtSeconds = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const payload = `${VERSION}.${userId}.${epoch}.${expiresAtSeconds}`;
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt: new Date(expiresAtSeconds * 1000) };
}

interface TokenParts {
  payload: string;
  signature: string;
  userPart: string;
  epochPart: string;
  expiresPart: string;
}

function splitToken(token: string): TokenParts | null {
  const parts = token.split('.');
  if (parts[0] === VERSION && parts.length === 5) {
    const [, userPart, epochPart, expiresPart, signature] = parts as [string, string, string, string, string];
    return { payload: parts.slice(0, 4).join('.'), signature, userPart, epochPart, expiresPart };
  }
  if (parts[0] === LEGACY_VERSION && parts.length === 4) {
    const [, userPart, expiresPart, signature] = parts as [string, string, string, string];
    return { payload: parts.slice(0, 3).join('.'), signature, userPart, epochPart: '0', expiresPart };
  }
  return null;
}

export function verifySession(token: string, secrets: readonly string[], now: Date): SessionClaims | null {
  const parts = splitToken(token);
  if (!parts) return null;
  const { userPart, epochPart, expiresPart } = parts;
  if (!/^\d{1,16}$/.test(userPart) || !/^\d{1,9}$/.test(epochPart) || !/^\d{1,12}$/.test(expiresPart)) {
    return null;
  }
  if (!signedBy(parts.payload, parts.signature, secrets)) return null;

  const userId = Number(userPart);
  const expiresAt = new Date(Number(expiresPart) * 1000);
  if (!Number.isSafeInteger(userId) || userId <= 0 || expiresAt.getTime() <= now.getTime()) return null;
  return { userId, epoch: Number(epochPart), expiresAt };
}
