export const NETWORK_ERROR = 'network_error';
export const TIMEOUT_ERROR = 'timeout';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Record<string, string>;
  readonly retryAfterSeconds: number | null;
  readonly receivedAt = Date.now();

  constructor(options: {
    status: number;
    code: string;
    fieldErrors?: Record<string, string>;
    retryAfterSeconds?: number | null;
  }) {
    super(options.code);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.fieldErrors = options.fieldErrors ?? {};
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

function fieldPath(path: string): string {
  return path.startsWith('body.') ? path.slice('body.'.length) : path;
}

function parseFieldErrors(errors: unknown): Record<string, string> {
  if (!Array.isArray(errors)) return {};
  const result: Record<string, string> = {};
  for (const entry of errors as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { path, message } = entry as { path?: unknown; message?: unknown };
    if (typeof path !== 'string' || typeof message !== 'string') continue;
    const key = fieldPath(path);
    result[key] ??= message;
  }
  return result;
}

export function parseRetryAfter(header: string | null): number | null {
  if (header === null) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    body = null;
  }
  const problem =
    typeof body === 'object' && body !== null ? (body as { code?: unknown; errors?: unknown }) : {};
  return new ApiError({
    status: response.status,
    code: typeof problem.code === 'string' ? problem.code : `http_${response.status}`,
    fieldErrors: parseFieldErrors(problem.errors),
    retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
  });
}
