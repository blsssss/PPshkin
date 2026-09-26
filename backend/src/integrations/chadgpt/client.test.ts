import { describe, expect, it, vi } from 'vitest';
import {
  ChadGptError,
  createChadGptClient,
  type ChadGptClientOptions,
  type ChadGptErrorKind,
  type CompletionRequest,
} from './client.ts';
import { isVisionModel, VISION_MODELS } from './models.ts';

const API_KEY = 'chad-secret-key-0123456789';
const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const SCHEMA = { type: 'object', additionalProperties: false, required: ['ok'], properties: {} };

const request = (overrides: Partial<CompletionRequest> = {}): CompletionRequest => ({
  model: 'gpt-6-luna',
  system: 'Системный промпт',
  user: 'съел борщ',
  schemaName: 'dish_estimate',
  schema: SCHEMA,
  ...overrides,
});

const completionBody = (content: unknown, finishReason: string | null = 'stop') => ({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  model: 'gpt-6-luna',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
});

const jsonResponse = (body: unknown, status = 200, requestId: string | null = 'req_abc') =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(requestId === null ? {} : { 'x-request-id': requestId }),
    },
  });

function setup(response: () => Promise<Response>, options: Partial<ChadGptClientOptions> = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>(response);
  const logger = { info: vi.fn(), warn: vi.fn() };
  const client = createChadGptClient({
    apiKey: API_KEY,
    baseUrl: 'https://ask.chadgpt.ru/api/v1',
    timeoutMs: 5_000,
    fetch,
    logger,
    ...options,
  });
  const sentBody = () => JSON.parse(fetch.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
  return { client, fetch, logger, sentBody };
}

async function failureOf(promise: Promise<unknown>): Promise<ChadGptError> {
  const error = await promise.then(
    () => expect.unreachable('the call should fail'),
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ChadGptError);
  return error as ChadGptError;
}

const unexpectedFetch = (): Promise<Response> => Promise.reject(new Error('fetch must not be called'));

describe('vision models', () => {
  it('lists the models that were verified with images and strict schemas', () => {
    expect(VISION_MODELS).toEqual(['gpt-6-luna', 'gpt-5.6-luna', 'gemini-3-flash-preview']);
    expect(isVisionModel('gemini-3-flash-preview')).toBe(true);
    expect(isVisionModel('deepseek-v4-flash')).toBe(false);
  });
});

describe('ChadGPT client', () => {
  it('returns the answer text, the requested model and the request id', async () => {
    const { client } = setup(() => Promise.resolve(jsonResponse(completionBody('{"is_food":true}'))));
    await expect(client.complete(request())).resolves.toEqual({
      content: '{"is_food":true}',
      model: 'gpt-6-luna',
      requestId: 'req_abc',
    });
  });

  it('reports a missing request id as null', async () => {
    const { client } = setup(() => Promise.resolve(jsonResponse(completionBody('{}'), 200, null)));
    await expect(client.complete(request())).resolves.toMatchObject({ requestId: null });
  });

  it('posts an OpenAI compatible body with a strict JSON schema', async () => {
    const { client, fetch, sentBody } = setup(() => Promise.resolve(jsonResponse(completionBody('{}'))));
    await client.complete(request());
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://ask.chadgpt.ru/api/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      authorization: `Bearer ${API_KEY}`,
      'content-type': 'application/json',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(sentBody()).toEqual({
      model: 'gpt-6-luna',
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'dish_estimate', strict: true, schema: SCHEMA },
      },
      messages: [
        { role: 'system', content: 'Системный промпт' },
        { role: 'user', content: 'съел борщ' },
      ],
    });
    expect(sentBody()).not.toHaveProperty('max_tokens');
    expect(sentBody()).not.toHaveProperty('reasoning_effort');
    expect(JSON.stringify(sentBody())).not.toContain(API_KEY);
  });

  it('sends the photo as a JPEG data URL after the text part and passes the reasoning effort', async () => {
    const { client, sentBody } = setup(() => Promise.resolve(jsonResponse(completionBody('{}'))));
    await client.complete(request({ user: 'Оцени еду на фото.', image: IMAGE, reasoningEffort: 'low' }));
    const body = sentBody();
    expect(body.reasoning_effort).toBe('low');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body.messages).toEqual([
      { role: 'system', content: 'Системный промпт' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Оцени еду на фото.' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${IMAGE.toString('base64')}` } },
        ],
      },
    ]);
  });

  it('joins the base URL without doubling slashes', async () => {
    const { client, fetch } = setup(() => Promise.resolve(jsonResponse(completionBody('{}'))), {
      baseUrl: 'https://proxy.example/api/v1/',
    });
    await client.complete(request());
    expect(fetch.mock.calls[0]?.[0]).toBe('https://proxy.example/api/v1/chat/completions');
  });

  it('passes fenced JSON through unchanged for the answer parser', async () => {
    const fenced = '```json\n{"is_food":false}\n```';
    const { client } = setup(() => Promise.resolve(jsonResponse(completionBody(fenced))));
    await expect(client.complete(request())).resolves.toMatchObject({ content: fenced });
  });

  it('treats a cut off answer as truncated', async () => {
    const { client } = setup(() => Promise.resolve(jsonResponse(completionBody('{"is_fo', 'length'))));
    const error = await failureOf(client.complete(request()));
    expect(error).toMatchObject({ kind: 'truncated', retryable: false, status: 200, requestId: 'req_abc' });
  });

  it.each([
    ['no choices', { choices: [] }],
    ['an empty answer', completionBody('   ')],
    ['a null answer', completionBody(null)],
    ['a non text answer', completionBody([{ type: 'text', text: '{}' }])],
    ['a body without choices', { object: 'chat.completion' }],
    ['a body that is not JSON', '<html>gateway</html>'],
  ])('treats %s as empty', async (_case, body) => {
    const { client } = setup(() => Promise.resolve(jsonResponse(body)));
    const error = await failureOf(client.complete(request()));
    expect(error).toMatchObject({ kind: 'empty', retryable: false });
  });

  it.each<[number, ChadGptErrorKind, boolean]>([
    [400, 'bad_request', false],
    [401, 'auth', false],
    [403, 'auth', false],
    [404, 'bad_request', false],
    [429, 'quota', false],
    [500, 'server', true],
    [502, 'server', true],
  ])('classifies HTTP %i as %s', async (status, kind, retryable) => {
    const body = { error: { message: 'failed', type: 'server_error', param: null, code: null } };
    const { client } = setup(() => Promise.resolve(jsonResponse(body, status, 'req_err')));
    const error = await failureOf(client.complete(request()));
    expect(error).toMatchObject({ kind, retryable, status, requestId: 'req_err' });
    expect(error.message).not.toContain(API_KEY);
  });

  it('classifies a rejected fetch as a retryable network failure', async () => {
    const { client } = setup(() => Promise.reject(new TypeError('fetch failed')));
    const error = await failureOf(client.complete(request()));
    expect(error).toMatchObject({ kind: 'network', retryable: true, status: null, requestId: null });
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it('classifies a body that breaks off mid stream as a network failure', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('socket hang up'));
      },
    });
    const { client } = setup(() => Promise.resolve(new Response(broken, { status: 200 })));
    const error = await failureOf(client.complete(request()));
    expect(error).toMatchObject({ kind: 'network', retryable: true, status: 200 });
  });

  it('aborts a slow request after the request timeout', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        }),
    );
    const client = createChadGptClient({
      apiKey: API_KEY,
      baseUrl: 'https://x.example',
      timeoutMs: 60_000,
      fetch,
    });
    const error = await failureOf(client.complete(request({ timeoutMs: 20 })));
    expect(error).toMatchObject({ kind: 'timeout', retryable: true, status: null });
  });

  it('uses the client timeout when the request has none', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }),
    );
    const client = createChadGptClient({
      apiKey: API_KEY,
      baseUrl: 'https://x.example',
      timeoutMs: 20,
      fetch,
    });
    const error = await failureOf(client.complete(request()));
    expect(error.kind).toBe('timeout');
  });

  it('refuses to send a photo to a model that cannot see images', async () => {
    const { client, fetch } = setup(unexpectedFetch);
    const error = await failureOf(client.complete(request({ model: 'deepseek-v4-flash', image: IMAGE })));
    expect(error).toMatchObject({ kind: 'bad_request', retryable: false, status: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('logs only the model, status, duration and request id', async () => {
    const { client, logger } = setup(() => Promise.resolve(jsonResponse(completionBody('{}'))));
    await client.complete(request({ image: IMAGE }));
    expect(logger.info).toHaveBeenCalledWith(
      { model: 'gpt-6-luna', status: 200, durationMs: expect.any(Number) as number, requestId: 'req_abc' },
      'chadgpt completion received',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs failures with their kind and never logs the key, the photo or the text', async () => {
    const { client, logger } = setup(() => Promise.resolve(jsonResponse({ error: {} }, 401, 'req_401')));
    await failureOf(client.complete(request({ image: IMAGE })));
    expect(logger.warn).toHaveBeenCalledWith(
      {
        model: 'gpt-6-luna',
        status: 401,
        durationMs: expect.any(Number) as number,
        requestId: 'req_401',
        kind: 'auth',
      },
      'chadgpt completion failed',
    );
    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain(API_KEY);
    expect(logged).not.toContain(IMAGE.toString('base64'));
    expect(logged).not.toContain('съел борщ');
  });

  it('uses the global fetch when none is injected', async () => {
    const globalFetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(jsonResponse(completionBody('{}'))),
    );
    vi.stubGlobal('fetch', globalFetch);
    try {
      const client = createChadGptClient({ apiKey: API_KEY, baseUrl: 'https://x.example', timeoutMs: 1_000 });
      await client.complete(request());
      expect(globalFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails before any network call when the request cannot be serialised', async () => {
    const { client, fetch, logger } = setup(unexpectedFetch);
    await expect(client.complete(request({ schema: { limit: 10n } }))).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('works without a logger', async () => {
    const client = createChadGptClient({
      apiKey: API_KEY,
      baseUrl: 'https://x.example',
      timeoutMs: 1_000,
      fetch: () => Promise.resolve(jsonResponse(completionBody('{}'))),
    });
    await expect(client.complete(request())).resolves.toMatchObject({ content: '{}' });
  });
});
