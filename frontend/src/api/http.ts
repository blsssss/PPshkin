import { ApiError, NETWORK_ERROR, TIMEOUT_ERROR, apiErrorFromResponse } from './errors.ts';
import { emitApiError } from './events.ts';

export const DEFAULT_TIMEOUT_MS = 15_000;
export const LONG_TIMEOUT_MS = 90_000;

const LONG_REQUESTS = [/\/diary\/meals\/(photo|text)$/, /\/venue\/menu\/imports\/(photo|text)$/];
const TOKEN_PROBLEMS = new Set(['invalid_token', 'unauthorized']);

export interface AuthBinding {
  token(): string | null;
  refresh(): Promise<boolean>;
}

export type FetchLike = (input: Request, init?: RequestInit) => Promise<Response>;

export function timeoutFor(url: string): number {
  const path = new URL(url, 'http://localhost').pathname;
  return LONG_REQUESTS.some((pattern) => pattern.test(path)) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

function bodyless(status: number): boolean {
  return status === 204 || status === 205 || status === 304;
}

async function send(request: Request, token: string | null, baseFetch: FetchLike): Promise<Response> {
  const callerAborted = () => request.signal.aborted;
  if (callerAborted()) throw request.signal.reason;
  if (token !== null) request.headers.set('Authorization', `Bearer ${token}`);
  const controller = new AbortController();
  const timeout = { reached: false };
  const timer = setTimeout(() => {
    timeout.reached = true;
    controller.abort();
  }, timeoutFor(request.url));
  const forwardAbort = () => {
    controller.abort(request.signal.reason);
  };
  request.signal.addEventListener('abort', forwardAbort);
  try {
    const response = await baseFetch(request, { signal: controller.signal });
    const body = bodyless(response.status) ? null : await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    if (timeout.reached) throw new ApiError({ status: 0, code: TIMEOUT_ERROR });
    if (callerAborted()) throw error;
    throw new ApiError({ status: 0, code: NETWORK_ERROR });
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', forwardAbort);
  }
}

async function isTokenProblem(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  const error = await apiErrorFromResponse(response);
  return TOKEN_PROBLEMS.has(error.code);
}

async function renewedToken(auth: AuthBinding, sent: string | null): Promise<boolean> {
  const current = auth.token();
  if (current !== null && current !== sent) return true;
  return auth.refresh();
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export function createApiFetch(auth: AuthBinding, baseFetch: FetchLike = defaultFetch): FetchLike {
  return async (input) => {
    const retry = input.clone();
    const sent = auth.token();
    let response = await send(input, sent, baseFetch);
    if ((await isTokenProblem(response)) && (await renewedToken(auth, sent))) {
      response = await send(retry, auth.token(), baseFetch);
    }
    if (!response.ok) throw emitApiError(await apiErrorFromResponse(response));
    return response;
  };
}
