import { SmokeFailure, type SmokeEnv } from './check.ts';

const REQUEST_TIMEOUT_MS = 20_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, '');

export function mediaType(response: Response): string {
  const [type = ''] = (response.headers.get('content-type') ?? '').split(';');
  return type.trim().toLowerCase();
}

export async function discard(response: Response): Promise<void> {
  await response.body?.cancel();
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SmokeFailure(`status ${response.status} with a body that is not JSON`);
  }
}

export function request(fetchFn: typeof fetch, url: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetchFn(url, { redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init });
}

function parseUrl(value: string, variable: string): URL {
  const url = URL.parse(value);
  if (url === null) throw new SmokeFailure(`${variable} is not a URL`);
  return url;
}

export function requireVerifiedTls(url: string, variable: string, env: SmokeEnv): void {
  if (parseUrl(url, variable).protocol !== 'https:') {
    throw new SmokeFailure(`${variable} is not an https URL, so the certificate cannot be checked`);
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new SmokeFailure('NODE_TLS_REJECT_UNAUTHORIZED=0 turns certificate checks off');
  }
}

export function requireSecureTransport(url: string, variable: string): void {
  const { protocol, hostname } = parseUrl(url, variable);
  if (protocol === 'https:' || (protocol === 'http:' && LOOPBACK_HOSTS.has(hostname))) return;
  throw new SmokeFailure(`${variable} must be an https URL, plain http is allowed only for localhost`);
}
