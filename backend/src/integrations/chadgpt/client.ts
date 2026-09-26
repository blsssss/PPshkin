import { z } from 'zod';
import { isVisionModel } from './models.ts';

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ChadGptLogger {
  info(object: Record<string, unknown>, message: string): void;
  warn(object: Record<string, unknown>, message: string): void;
}

export interface ChadGptClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
  logger?: ChadGptLogger;
}

export interface CompletionRequest {
  model: string;
  system: string;
  user: string;
  image?: Buffer;
  schemaName: string;
  schema: JsonSchema;
  reasoningEffort?: 'low' | 'medium';
  timeoutMs?: number;
}

export interface Completion {
  content: string;
  model: string;
  requestId: string | null;
}

export const CHADGPT_ERROR_KINDS = [
  'timeout',
  'network',
  'auth',
  'quota',
  'bad_request',
  'server',
  'truncated',
  'empty',
] as const;
export type ChadGptErrorKind = (typeof CHADGPT_ERROR_KINDS)[number];

const RETRYABLE_KINDS: ReadonlySet<ChadGptErrorKind> = new Set(['timeout', 'network', 'server']);

interface ChadGptErrorContext {
  status?: number | null;
  requestId?: string | null;
  cause?: unknown;
}

export class ChadGptError extends Error {
  readonly kind: ChadGptErrorKind;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(kind: ChadGptErrorKind, message: string, context: ChadGptErrorContext = {}) {
    super(message, context.cause === undefined ? undefined : { cause: context.cause });
    this.name = 'ChadGptError';
    this.kind = kind;
    this.retryable = RETRYABLE_KINDS.has(kind);
    this.status = context.status ?? null;
    this.requestId = context.requestId ?? null;
  }
}

export interface ChadGptClient {
  complete(request: CompletionRequest): Promise<Completion>;
}

const ChatCompletionSchema = z.object({
  choices: z.array(
    z.object({
      finish_reason: z.string().nullish(),
      message: z.object({ content: z.unknown() }).nullish(),
    }),
  ),
});

const silentLogger: ChadGptLogger = { info: () => undefined, warn: () => undefined };

function statusKind(status: number): ChadGptErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota';
  if (status >= 500) return 'server';
  return 'bad_request';
}

function userContent(request: CompletionRequest) {
  if (request.image === undefined) return request.user;
  return [
    { type: 'text', text: request.user },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${request.image.toString('base64')}` } },
  ];
}

function requestBody(request: CompletionRequest) {
  return {
    model: request.model,
    ...(request.reasoningEffort === undefined ? {} : { reasoning_effort: request.reasoningEffort }),
    response_format: {
      type: 'json_schema',
      json_schema: { name: request.schemaName, strict: true, schema: request.schema },
    },
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: userContent(request) },
    ],
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function completionContent(body: string, context: ChadGptErrorContext): string {
  const parsed = ChatCompletionSchema.safeParse(parseJson(body));
  const choice = parsed.success ? parsed.data.choices[0] : undefined;
  if (!choice) {
    throw new ChadGptError('empty', 'ChadGPT returned no completion choices', context);
  }
  if (choice.finish_reason !== 'stop') {
    throw new ChadGptError('truncated', 'ChadGPT stopped before finishing the answer', context);
  }
  const content = choice.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new ChadGptError('empty', 'ChadGPT returned an empty answer', context);
  }
  return content;
}

function transportError(error: unknown, signal: AbortSignal, context: ChadGptErrorContext): ChadGptError {
  return signal.aborted
    ? new ChadGptError('timeout', 'ChadGPT did not answer in time', { ...context, cause: error })
    : new ChadGptError('network', 'ChadGPT could not be reached', { ...context, cause: error });
}

export function createChadGptClient(options: ChadGptClientOptions): ChadGptClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const logger = options.logger ?? silentLogger;
  const headers = {
    authorization: `Bearer ${options.apiKey}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };

  async function exchange(
    request: CompletionRequest,
    signal: AbortSignal,
  ): Promise<{ completion: Completion; status: number }> {
    const body = JSON.stringify(requestBody(request));
    let response: Response;
    try {
      response = await fetchImpl(endpoint, { method: 'POST', headers, body, signal });
    } catch (error) {
      throw transportError(error, signal, {});
    }
    const context = { status: response.status, requestId: response.headers.get('x-request-id') };
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw transportError(error, signal, context);
    }
    if (!response.ok) {
      throw new ChadGptError(
        statusKind(response.status),
        `ChadGPT answered with HTTP ${response.status}`,
        context,
      );
    }
    const content = completionContent(text, context);
    return {
      completion: { content, model: request.model, requestId: context.requestId },
      status: response.status,
    };
  }

  return {
    async complete(request) {
      if (request.image !== undefined && !isVisionModel(request.model)) {
        throw new ChadGptError('bad_request', `Model ${request.model} does not accept images`);
      }
      const started = performance.now();
      const elapsed = () => Math.round(performance.now() - started);
      const signal = AbortSignal.timeout(request.timeoutMs ?? options.timeoutMs);
      try {
        const { completion, status } = await exchange(request, signal);
        logger.info(
          { model: request.model, status, durationMs: elapsed(), requestId: completion.requestId },
          'chadgpt completion received',
        );
        return completion;
      } catch (error) {
        if (error instanceof ChadGptError) {
          logger.warn(
            {
              model: request.model,
              status: error.status,
              durationMs: elapsed(),
              requestId: error.requestId,
              kind: error.kind,
            },
            'chadgpt completion failed',
          );
        }
        throw error;
      }
    },
  };
}
