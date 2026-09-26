import { ApiError, NETWORK_ERROR, TIMEOUT_ERROR, apiErrorFromResponse } from './errors.ts';

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

async function send(request: Request, token: string | null, baseFetch: FetchLike): Promise<Response> {
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
    return await baseFetch(request, { signal: controller.signal });
  } catch (error) {
    if (timeout.reached) throw new ApiError({ status: 0, code: TIMEOUT_ERROR });
    if (request.signal.aborted) throw error;
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

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export function createApiFetch(auth: AuthBinding, baseFetch: FetchLike = defaultFetch): FetchLike {
  return async (input) => {
    const retry = input.clone();
    let response = await send(input, auth.token(), baseFetch);
    if (await isTokenProblem(response)) {
      const refreshed = await auth.refresh();
      if (refreshed) response = await send(retry, auth.token(), baseFetch);
    }
    if (!response.ok) throw await apiErrorFromResponse(response);
    return response;
  };
}
