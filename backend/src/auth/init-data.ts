import { createHmac, timingSafeEqual } from 'node:crypto';

export interface InitDataUser {
  id: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
}

export interface VerifiedInitData {
  user: InitDataUser;
  startParam: string | null;
  queryId: string | null;
  authDate: Date;
}

export type InitDataFailure = 'malformed' | 'bad_signature' | 'expired' | 'no_user';

export class InitDataError extends Error {
  readonly reason: InitDataFailure;

  constructor(reason: InitDataFailure) {
    super(`init data rejected: ${reason}`);
    this.name = 'InitDataError';
    this.reason = reason;
  }
}

export interface VerifyOptions {
  botToken: string;
  maxAgeSeconds: number;
  now: Date;
}

const CLOCK_SKEW_SECONDS = 60;

function splitPairs(raw: string): [string, string][] {
  return raw
    .split('&')
    .filter((part) => part.length > 0)
    .map((part) => {
      const index = part.indexOf('=');
      return index < 0 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
    });
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new InitDataError('malformed');
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseUser(json: string | undefined): InitDataUser {
  if (json === undefined) throw new InitDataError('no_user');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InitDataError('malformed');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new InitDataError('no_user');
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== 'number' || !Number.isSafeInteger(record.id) || record.id <= 0) {
    throw new InitDataError('no_user');
  }
  return {
    id: record.id,
    firstName: text(record.first_name),
    lastName: text(record.last_name),
    username: text(record.username),
    languageCode: text(record.language_code),
  };
}

export function verifyInitData(raw: string, options: VerifyOptions): VerifiedInitData {
  const pairs = splitPairs(raw);
  const keys = pairs.map(([key]) => key);
  if (new Set(keys).size !== keys.length) throw new InitDataError('malformed');

  const hashPair = pairs.find(([key]) => key === 'hash');
  if (!hashPair || !/^[0-9a-f]{64}$/i.test(hashPair[1])) throw new InitDataError('malformed');

  const fields = pairs
    .filter(([key]) => key !== 'hash')
    .map(([key, value]): [string, string] => [key, decode(value)])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  const secret = createHmac('sha256', 'WebAppData').update(options.botToken).digest();
  const expected = createHmac('sha256', secret)
    .update(fields.map(([key, value]) => `${key}=${value}`).join('\n'))
    .digest();
  const received = Buffer.from(hashPair[1], 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new InitDataError('bad_signature');
  }

  const values = new Map(fields);
  const authDateSeconds = Number(values.get('auth_date'));
  if (!Number.isInteger(authDateSeconds) || authDateSeconds <= 0) throw new InitDataError('malformed');
  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  if (
    nowSeconds - authDateSeconds > options.maxAgeSeconds ||
    authDateSeconds - nowSeconds > CLOCK_SKEW_SECONDS
  ) {
    throw new InitDataError('expired');
  }

  return {
    user: parseUser(values.get('user')),
    startParam: text(values.get('start_param')),
    queryId: text(values.get('query_id')),
    authDate: new Date(authDateSeconds * 1000),
  };
}
