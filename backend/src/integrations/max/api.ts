import { z } from 'zod';
import { DownloadTooLargeError, MaxApiError, UserUnreachableError } from './errors.ts';
import { createRateLimiter } from './rate-limit.ts';
import { realSleep, sleepUnlessAborted, type Sleep } from './sleep.ts';
import type {
  MaxBotCommand,
  MaxBotInfo,
  MaxCallbackAnswer,
  MaxNewMessageBody,
  MaxSubscription,
} from './types.ts';
import type { MaxUpdateType } from './updates.ts';

export interface MaxApiOptions {
  token: string;
  baseUrl: string;
  fetch?: typeof fetch;
  sleep?: Sleep;
  now?: () => number;
}

export type MaxRecipient = { userId: number } | { chatId: number };

export interface MaxApi {
  getMe(): Promise<MaxBotInfo>;
  getUpdates(options: {
    marker?: number | null;
    timeoutSeconds: number;
    types: readonly MaxUpdateType[];
    signal?: AbortSignal;
  }): Promise<{ updates: unknown[]; marker: number | null }>;
  sendMessage(to: MaxRecipient, body: MaxNewMessageBody): Promise<{ mid: string }>;
  editMessage(mid: string, body: MaxNewMessageBody): Promise<void>;
  answerCallback(callbackId: string, answer: MaxCallbackAnswer): Promise<void>;
  sendAction(chatId: number, action: 'typing_on'): Promise<void>;
  uploadImage(data: Buffer, filename: string, contentType: string): Promise<string>;
  listSubscriptions(): Promise<MaxSubscription[]>;
  subscribe(url: string, secret: string, types: readonly MaxUpdateType[]): Promise<void>;
  unsubscribe(url: string): Promise<void>;
  setCommands(commands: MaxBotCommand[]): Promise<void>;
  download(url: string, maxBytes: number): Promise<Buffer>;
}

const GLOBAL_REQUESTS_PER_SECOND = 25;
const CHAT_REQUESTS_PER_SECOND = 2;
const REQUEST_TIMEOUT_MS = 15_000;
const FILE_TIMEOUT_MS = 30_000;
const LONG_POLL_GRACE_MS = 10_000;
const UPDATES_PER_REQUEST = 100;
const MAX_ATTEMPTS = 3;
const FIRST_RETRY_DELAY_MS = 500;
const RETRY_AFTER_LIMIT_MS = 30_000;
const ATTACHMENT_RETRY_DELAYS_MS = [1000, 2000, 4000];
const MAX_COMMANDS = 32;

const BotInfoSchema = z.object({
  user_id: z.number().int().positive(),
  first_name: z.string(),
  username: z.string().min(1),
});
const UpdatesSchema = z.object({ updates: z.array(z.unknown()), marker: z.number().int().nullish() });
const SentMessageSchema = z.object({ message: z.object({ body: z.object({ mid: z.string().min(1) }) }) });
const SubscriptionsSchema = z.object({
  subscriptions: z.array(
    z.object({ url: z.string(), time: z.number(), update_types: z.array(z.string()).nullish() }),
  ),
});
const UploadEndpointSchema = z.object({ url: z.url() });
const UploadedPhotosSchema = z.object({
  photos: z.record(z.string(), z.object({ token: z.string().min(1) })),
});
const AnyResult = z.unknown();

const NOT_JSON = Symbol('not json');

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Attempt {
  method: HttpMethod;
  url: URL;
  headers: Record<string, string>;
  body?: string | FormData;
  rateKey: string | null;
  timeoutMs: number;
  signal?: AbortSignal;
}

interface ApiCall<T> {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  rateKey?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  schema: z.ZodType<T>;
  recipientCall?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter?.trim() ?? '';
  if (/^\d+$/.test(seconds)) return Math.min(Number(seconds) * 1000, RETRY_AFTER_LIMIT_MS);
  return FIRST_RETRY_DELAY_MS * 2 ** (attempt - 1);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return NOT_JSON;
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new DownloadTooLargeError(maxBytes);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks, total);
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new DownloadTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
}

export function createMaxApi(options: MaxApiOptions): MaxApi {
  const { token } = options;
  if (token.length === 0) throw new Error('MAX bot token is empty');
  const fetchFn = options.fetch ?? fetch;
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? (() => performance.now());
  const base = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
  const limiter = createRateLimiter({
    globalPerSecond: GLOBAL_REQUESTS_PER_SECOND,
    perKeyPerSecond: CHAT_REQUESTS_PER_SECOND,
    now,
    sleep,
  });

  const withoutToken = (text: string) => text.replaceAll(token, '[token]');

  const failure = (status: number, body: unknown, recipientCall: boolean): MaxApiError => {
    const fields = isRecord(body) ? body : {};
    const code =
      typeof fields.code === 'string' && fields.code.length > 0 ? fields.code : 'unexpected.response';
    const message = withoutToken(
      typeof fields.message === 'string' ? fields.message : `MAX answered with status ${status}`,
    );
    return recipientCall && status === 403
      ? new UserUnreachableError(code, message)
      : new MaxApiError(status, code, message);
  };

  const unexpected = (status: number) =>
    new MaxApiError(status, 'unexpected.response', 'MAX answered with an unexpected response body');

  async function decode<T>(response: Response, schema: z.ZodType<T>, recipientCall: boolean): Promise<T> {
    const body = await readJson(response);
    if (!response.ok) throw failure(response.status, body, recipientCall);
    if (body === NOT_JSON) throw unexpected(response.status);
    if (isRecord(body) && body.success === false) {
      const message = typeof body.message === 'string' ? body.message : 'MAX reported a failed operation';
      throw new MaxApiError(response.status, 'operation.failed', withoutToken(message));
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw unexpected(response.status);
    return parsed.data;
  }

  async function perform(attempt: Attempt): Promise<Response> {
    for (let number = 1; ; number += 1) {
      attempt.signal?.throwIfAborted();
      await limiter.acquire(attempt.rateKey);
      const timeout = AbortSignal.timeout(attempt.timeoutMs);
      let response: Response;
      try {
        response = await fetchFn(attempt.url, {
          method: attempt.method,
          headers: attempt.headers,
          body: attempt.body,
          signal: attempt.signal ? AbortSignal.any([attempt.signal, timeout]) : timeout,
        });
      } catch (error) {
        if (attempt.signal?.aborted) throw error;
        if (number >= MAX_ATTEMPTS) {
          throw new MaxApiError(0, 'network.error', 'MAX request failed without a response', {
            cause: error,
          });
        }
        await sleepUnlessAborted(sleep, retryDelay(number, null), attempt.signal);
        continue;
      }
      if (number < MAX_ATTEMPTS && isRetryable(response.status)) {
        await response.body?.cancel();
        await sleepUnlessAborted(
          sleep,
          retryDelay(number, response.headers.get('retry-after')),
          attempt.signal,
        );
        continue;
      }
      return response;
    }
  }

  async function call<T>(request: ApiCall<T>): Promise<T> {
    const url = new URL(request.path, base);
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    const headers: Record<string, string> = { authorization: token, accept: 'application/json' };
    if (request.json !== undefined) headers['content-type'] = 'application/json';
    const response = await perform({
      method: request.method,
      url,
      headers,
      body: request.json === undefined ? undefined : JSON.stringify(request.json),
      rateKey: request.rateKey ?? null,
      timeoutMs: request.timeoutMs ?? REQUEST_TIMEOUT_MS,
      signal: request.signal,
    });
    return decode(response, request.schema, request.recipientCall ?? false);
  }

  async function retryUntilAttachmentsReady<T>(send: () => Promise<T>): Promise<T> {
    for (const wait of ATTACHMENT_RETRY_DELAYS_MS) {
      try {
        return await send();
      } catch (error) {
        if (!(error instanceof MaxApiError) || error.code !== 'attachment.not.ready') throw error;
        await sleep(wait);
      }
    }
    return send();
  }

  return {
    getMe: () => call({ method: 'GET', path: 'me', schema: BotInfoSchema }),

    async getUpdates({ marker, timeoutSeconds, types, signal }) {
      const result = await call({
        method: 'GET',
        path: 'updates',
        query: {
          limit: UPDATES_PER_REQUEST,
          timeout: timeoutSeconds,
          marker: marker ?? undefined,
          types: types.length > 0 ? types.join(',') : undefined,
        },
        timeoutMs: timeoutSeconds * 1000 + LONG_POLL_GRACE_MS,
        signal,
        schema: UpdatesSchema,
      });
      return { updates: result.updates, marker: result.marker ?? null };
    },

    async sendMessage(to, body) {
      const [query, rateKey] =
        'userId' in to
          ? [{ user_id: to.userId }, `user:${to.userId}`]
          : [{ chat_id: to.chatId }, `chat:${to.chatId}`];
      const sent = await retryUntilAttachmentsReady(() =>
        call({
          method: 'POST',
          path: 'messages',
          query,
          json: body,
          rateKey,
          schema: SentMessageSchema,
          recipientCall: true,
        }),
      );
      return { mid: sent.message.body.mid };
    },

    async editMessage(mid, body) {
      await retryUntilAttachmentsReady(() =>
        call({
          method: 'PUT',
          path: 'messages',
          query: { message_id: mid },
          json: body,
          rateKey: `message:${mid}`,
          schema: AnyResult,
          recipientCall: true,
        }),
      );
    },

    async answerCallback(callbackId, answer) {
      await retryUntilAttachmentsReady(() =>
        call({
          method: 'POST',
          path: 'answers',
          query: { callback_id: callbackId },
          json: answer,
          rateKey: `callback:${callbackId}`,
          schema: AnyResult,
        }),
      );
    },

    async sendAction(chatId, action) {
      await call({
        method: 'POST',
        path: `chats/${chatId}/actions`,
        json: { action },
        rateKey: `chat:${chatId}`,
        schema: AnyResult,
      });
    },

    async uploadImage(data, filename, contentType) {
      const endpoint = await call({
        method: 'POST',
        path: 'uploads',
        query: { type: 'image' },
        schema: UploadEndpointSchema,
      });
      const form = new FormData();
      form.append('data', new Blob([new Uint8Array(data)], { type: contentType }), filename);
      const response = await perform({
        method: 'POST',
        url: new URL(endpoint.url),
        headers: {},
        body: form,
        rateKey: null,
        timeoutMs: FILE_TIMEOUT_MS,
      });
      const uploaded = await decode(response, UploadedPhotosSchema, false);
      const [photo] = Object.values(uploaded.photos);
      if (!photo) throw unexpected(response.status);
      return photo.token;
    },

    async listSubscriptions() {
      const result = await call({ method: 'GET', path: 'subscriptions', schema: SubscriptionsSchema });
      return result.subscriptions;
    },

    async subscribe(url, secret, types) {
      await call({
        method: 'POST',
        path: 'subscriptions',
        json: { url, update_types: types, secret },
        schema: AnyResult,
      });
    },

    async unsubscribe(url) {
      await call({ method: 'DELETE', path: 'subscriptions', query: { url }, schema: AnyResult });
    },

    async setCommands(commands) {
      if (commands.length > MAX_COMMANDS) {
        throw new Error(`MAX accepts at most ${MAX_COMMANDS} bot commands, got ${commands.length}`);
      }
      await call({ method: 'PATCH', path: 'me/commands', json: { commands }, schema: AnyResult });
    },

    async download(url, maxBytes) {
      const target = URL.parse(url);
      if (target?.protocol !== 'https:') throw new Error('Only https URLs can be downloaded');
      const fetchFile = (headers: Record<string, string>) =>
        perform({ method: 'GET', url: target, headers, rateKey: null, timeoutMs: FILE_TIMEOUT_MS });
      let response = await fetchFile({});
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        response = await fetchFile({ authorization: token });
      }
      if (!response.ok) throw failure(response.status, await readJson(response), false);
      return readLimited(response, maxBytes);
    },
  };
}
