import { describe, expect, it, vi } from 'vitest';
import { waitForAbort } from '../../../test/max-api.ts';
import { createMaxApi, type MaxApi } from './api.ts';
import { DownloadTooLargeError, MaxApiError, UserUnreachableError } from './errors.ts';
import { MAX_UPDATE_TYPES } from './updates.ts';

const TOKEN = 'secret-bot-token-0001';
const BASE_URL = 'https://max.test';

interface SentRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | undefined;
}

type Reply = Response | Error | ((request: SentRequest) => Response | Promise<Response>);

async function describeBody(body: RequestInit['body']): Promise<unknown> {
  if (typeof body === 'string') return JSON.parse(body) as unknown;
  if (!(body instanceof FormData)) return undefined;
  const fields: unknown[] = [];
  for (const [name, value] of body) {
    fields.push(
      typeof value === 'string'
        ? { name, value }
        : { name, filename: value.name, type: value.type, bytes: Buffer.from(await value.arrayBuffer()) },
    );
  }
  return fields;
}

function fakeFetch(replies: Reply[]) {
  const requests: SentRequest[] = [];
  const fetchFn = async (input: string | URL | Request, init: RequestInit = {}) => {
    const request: SentRequest = {
      method: init.method ?? 'GET',
      url: input instanceof Request ? input.url : String(input),
      headers: Object.fromEntries(new Headers(init.headers)),
      body: await describeBody(init.body),
      signal: init.signal ?? undefined,
    };
    requests.push(request);
    const reply = replies.shift();
    if (!reply) throw new Error(`Unexpected request ${request.method} ${request.url}`);
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(request) : reply;
  };
  return { fetch: fetchFn, requests };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const ok = () => json({ success: true });
const sent = (mid = 'mid.1') => json({ message: { body: { mid, seq: 1, text: 'hi' } } });
const notReady = () => json({ code: 'attachment.not.ready', message: 'Key: errors.process.attachment' }, 400);

function breakingBody(pull: () => Promise<never>) {
  return new Response(new ReadableStream<Uint8Array>({ pull }), {
    headers: { 'content-type': 'application/json' },
  });
}

const brokenBody = (cause: Error) => breakingBody(() => Promise.reject(cause));

function setup(replies: Reply[], options: { sleep?: (ms: number) => Promise<void>; baseUrl?: string } = {}) {
  let time = 0;
  const sleeps: number[] = [];
  const http = fakeFetch(replies);
  const api = createMaxApi({
    token: TOKEN,
    baseUrl: options.baseUrl ?? BASE_URL,
    fetch: http.fetch,
    now: () => time,
    sleep:
      options.sleep ??
      ((ms) => {
        sleeps.push(ms);
        time += ms;
        return Promise.resolve();
      }),
  });
  return { api, requests: http.requests, sleeps };
}

const botInfo = { user_id: 700, first_name: 'ППшкин', username: 'ppshkin_bot', is_bot: true };

describe('MAX API requests', () => {
  it('reads the bot info with the raw token in the Authorization header', async () => {
    const { api, requests } = setup([json({ ...botInfo, last_activity_time: 1 })]);
    expect(await api.getMe()).toEqual({ user_id: 700, first_name: 'ППшкин', username: 'ppshkin_bot' });
    expect(requests).toMatchObject([{ method: 'GET', url: 'https://max.test/me' }]);
    expect(requests[0]!.headers.authorization).toBe(TOKEN);
  });

  it('keeps the path of the base URL', async () => {
    for (const baseUrl of ['https://proxy.test/max/api', 'https://proxy.test/max/api/']) {
      const { api, requests } = setup([json(botInfo)], { baseUrl });
      await api.getMe();
      expect(requests[0]!.url).toBe('https://proxy.test/max/api/me');
    }
  });

  it('long polls updates with the limit, timeout and comma separated types', async () => {
    const update = { update_type: 'bot_started', timestamp: 1 };
    const { api, requests } = setup([json({ updates: [update], marker: 42 })]);
    const result = await api.getUpdates({ marker: 41, timeoutSeconds: 30, types: MAX_UPDATE_TYPES });
    expect(result).toEqual({ updates: [update], marker: 42 });
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe('/updates');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '100',
      timeout: '30',
      marker: '41',
      types: 'bot_started,message_created,message_callback,bot_stopped',
    });
  });

  it('omits the marker until MAX returns one', async () => {
    const { api, requests } = setup([
      json({ updates: [], marker: null }),
      json({ updates: [] }),
      json({ updates: [], marker: 0 }),
    ]);
    expect(await api.getUpdates({ marker: null, timeoutSeconds: 30, types: ['message_created'] })).toEqual({
      updates: [],
      marker: null,
    });
    expect((await api.getUpdates({ timeoutSeconds: 5, types: [] })).marker).toBeNull();
    expect((await api.getUpdates({ marker: 0, timeoutSeconds: 5, types: [] })).marker).toBe(0);
    const params = requests.map((request) => new URL(request.url).searchParams);
    expect(params[0]!.has('marker')).toBe(false);
    expect(params[1]!.has('marker')).toBe(false);
    expect(params[1]!.has('types')).toBe(false);
    expect(params[2]!.get('marker')).toBe('0');
  });

  it('sends messages to users and to chats', async () => {
    const { api, requests } = setup([sent('mid.user'), sent('mid.chat')]);
    const body = { text: 'Привет', format: 'markdown' as const };
    expect(await api.sendMessage({ userId: 101 }, body)).toEqual({ mid: 'mid.user' });
    expect(await api.sendMessage({ chatId: -5 }, body)).toEqual({ mid: 'mid.chat' });
    expect(requests).toMatchObject([
      { method: 'POST', url: 'https://max.test/messages?user_id=101', body },
      { method: 'POST', url: 'https://max.test/messages?chat_id=-5', body },
    ]);
    expect(requests[0]!.headers['content-type']).toBe('application/json');
  });

  it('edits messages', async () => {
    const { api, requests } = setup([ok()]);
    await api.editMessage('mid.7', { text: 'Готово', attachments: [] });
    expect(requests).toMatchObject([
      {
        method: 'PUT',
        url: 'https://max.test/messages?message_id=mid.7',
        body: { text: 'Готово', attachments: [] },
      },
    ]);
  });

  it('answers callbacks with a notification', async () => {
    const { api, requests } = setup([ok()]);
    await api.answerCallback('cb.1', { notification: 'Забронировано' });
    expect(requests).toMatchObject([
      {
        method: 'POST',
        url: 'https://max.test/answers?callback_id=cb.1',
        body: { notification: 'Забронировано' },
      },
    ]);
  });

  it('sends a typing action to a chat', async () => {
    const { api, requests } = setup([ok()]);
    await api.sendAction(555, 'typing_on');
    expect(requests).toMatchObject([
      { method: 'POST', url: 'https://max.test/chats/555/actions', body: { action: 'typing_on' } },
    ]);
  });

  it('lists, creates and removes webhook subscriptions', async () => {
    const subscription = { url: 'https://bot.example/max/webhook', time: 1, update_types: ['bot_started'] };
    const { api, requests } = setup([json({ subscriptions: [subscription] }), ok(), ok()]);
    expect(await api.listSubscriptions()).toEqual([subscription]);
    await api.subscribe('https://bot.example/max/webhook', 'hook_secret-1', MAX_UPDATE_TYPES);
    await api.unsubscribe('https://old.example/hook?x=1');
    expect(requests).toMatchObject([
      { method: 'GET', url: 'https://max.test/subscriptions' },
      {
        method: 'POST',
        url: 'https://max.test/subscriptions',
        body: {
          url: 'https://bot.example/max/webhook',
          update_types: [...MAX_UPDATE_TYPES],
          secret: 'hook_secret-1',
        },
      },
      { method: 'DELETE' },
    ]);
    expect(new URL(requests[2]!.url).searchParams.get('url')).toBe('https://old.example/hook?x=1');
  });

  it('sets bot commands and refuses more than 32 of them', async () => {
    const { api, requests } = setup([json(botInfo)]);
    const commands = [{ name: 'start', description: 'Начать' }];
    await api.setCommands(commands);
    expect(requests).toMatchObject([
      { method: 'PATCH', url: 'https://max.test/me/commands', body: { commands } },
    ]);
    const tooMany = Array.from({ length: 33 }, (_, index) => ({ name: `c${index}`, description: 'x' }));
    await expect(api.setCommands(tooMany)).rejects.toThrow(/at most 32/);
    expect(requests).toHaveLength(1);
  });

  it('sends the token only in the Authorization header', async () => {
    const { api, requests } = setup([
      json(botInfo),
      json({ updates: [], marker: 1 }),
      sent(),
      ok(),
      ok(),
      ok(),
      json({ subscriptions: [] }),
      ok(),
      ok(),
      ok(),
    ]);
    await api.getMe();
    await api.getUpdates({ timeoutSeconds: 1, types: MAX_UPDATE_TYPES });
    await api.sendMessage({ userId: 1 }, { text: 'x' });
    await api.editMessage('m', { text: 'x' });
    await api.answerCallback('c', {});
    await api.sendAction(1, 'typing_on');
    await api.listSubscriptions();
    await api.subscribe('https://bot.example/hook', 'secret', []);
    await api.unsubscribe('https://bot.example/hook');
    await api.setCommands([]);
    expect(requests).toHaveLength(10);
    for (const request of requests) {
      expect(request.url).not.toContain(TOKEN);
      expect(request.headers.authorization).toBe(TOKEN);
      expect(JSON.stringify(request.body ?? null)).not.toContain(TOKEN);
    }
  });
});

describe('MAX API retries', () => {
  it('waits for Retry-After on 429', async () => {
    const { api, requests, sleeps } = setup([
      json({ code: 'too.many.requests' }, 429, { 'retry-after': '2' }),
      sent(),
    ]);
    expect(await api.sendMessage({ userId: 1 }, { text: 'x' })).toEqual({ mid: 'mid.1' });
    expect(requests).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it('never waits longer than 30 seconds for Retry-After', async () => {
    const { api, sleeps } = setup([json({}, 429, { 'retry-after': '120' }), json(botInfo)]);
    await api.getMe();
    expect(sleeps).toEqual([30_000]);
  });

  it('backs off 500 ms and then 1000 ms without Retry-After', async () => {
    const { api, sleeps } = setup([json({}, 429), json({}, 429, { 'retry-after': 'soon' }), json(botInfo)]);
    await api.getMe();
    expect(sleeps).toEqual([500, 1000]);
  });

  it('retries server errors', async () => {
    const { api, requests, sleeps } = setup([
      new Response('Bad gateway', { status: 502 }),
      json({ code: 'internal.error' }, 500),
      json(botInfo),
    ]);
    expect(await api.getMe()).toMatchObject({ user_id: 700 });
    expect(requests).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('retries network errors', async () => {
    const { api, requests } = setup([new TypeError('fetch failed'), json(botInfo)]);
    expect(await api.getMe()).toMatchObject({ user_id: 700 });
    expect(requests).toHaveLength(2);
  });

  it('gives up after three attempts with the last MAX error', async () => {
    const { api, requests, sleeps } = setup([
      json({}, 503),
      json({}, 503),
      json({ code: 'service.unavailable', message: 'Try later' }, 503),
    ]);
    await expect(api.getMe()).rejects.toMatchObject({
      name: 'MaxApiError',
      status: 503,
      code: 'service.unavailable',
      message: 'Try later',
    });
    expect(requests).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('reports a network failure after three attempts', async () => {
    const cause = new TypeError('fetch failed');
    const { api, requests } = setup([cause, cause, cause]);
    const error = await api.getMe().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(MaxApiError);
    expect(error).toMatchObject({ status: 0, code: 'network.error', cause });
    expect(requests).toHaveLength(3);
  });

  it('does not retry client errors', async () => {
    const { api, requests } = setup([json({ code: 'proto.payload', message: 'Bad body' }, 400)]);
    await expect(api.sendMessage({ userId: 1 }, { text: 'x' })).rejects.toMatchObject({
      status: 400,
      code: 'proto.payload',
    });
    expect(requests).toHaveLength(1);
  });

  it('does not retry a request cancelled by the caller', async () => {
    const controller = new AbortController();
    const { api, requests, sleeps } = setup([(request) => waitForAbort(request.signal)]);
    const pending = api.getUpdates({
      timeoutSeconds: 30,
      types: MAX_UPDATE_TYPES,
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('stops waiting for a retry when the caller cancels', async () => {
    const controller = new AbortController();
    const { api, requests } = setup([json({}, 503)], { sleep: () => new Promise<void>(() => undefined) });
    const pending = api.getUpdates({
      timeoutSeconds: 30,
      types: MAX_UPDATE_TYPES,
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toHaveLength(1);
  });

  it('gives the long poll ten seconds more than its own timeout', async () => {
    const { api, requests } = setup([json({ updates: [], marker: null })]);
    const spy = vi.spyOn(AbortSignal, 'timeout');
    try {
      await api.getUpdates({ timeoutSeconds: 30, types: [] });
      expect(spy).toHaveBeenCalledWith(40_000);
    } finally {
      spy.mockRestore();
    }
    expect(requests[0]!.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('MAX API errors', () => {
  it('treats 200 with success false as a failed operation', async () => {
    const { api } = setup([json({ success: false, message: 'Callback is expired' })]);
    await expect(api.answerCallback('cb', { notification: 'x' })).rejects.toMatchObject({
      name: 'MaxApiError',
      status: 200,
      code: 'operation.failed',
      message: 'Callback is expired',
    });
  });

  it('keeps the code and message of MAX errors', async () => {
    const { api } = setup([json({ code: 'verify.token', message: 'Invalid access_token' }, 401)]);
    await expect(api.getMe()).rejects.toMatchObject({
      status: 401,
      code: 'verify.token',
      message: 'Invalid access_token',
    });
  });

  it('reports 403 on sending and editing as an unreachable user', async () => {
    const forbidden = () => json({ code: 'chat.denied', message: 'Bot is blocked' }, 403);
    const { api } = setup([forbidden(), forbidden(), forbidden()]);
    const sendError = await api.sendMessage({ userId: 1 }, { text: 'x' }).catch((error: unknown) => error);
    const editError = await api.editMessage('mid', { text: 'x' }).catch((error: unknown) => error);
    const answerError = await api.answerCallback('cb', {}).catch((error: unknown) => error);
    for (const error of [sendError, editError]) {
      expect(error).toBeInstanceOf(UserUnreachableError);
      expect(error).toBeInstanceOf(MaxApiError);
      expect(error).toMatchObject({ status: 403, code: 'chat.denied', message: 'Bot is blocked' });
    }
    expect(answerError).toBeInstanceOf(MaxApiError);
    expect(answerError).not.toBeInstanceOf(UserUnreachableError);
  });

  it('reports bodies that are not JSON as unexpected responses', async () => {
    const { api } = setup([
      new Response('<html>oops</html>', { status: 404 }),
      new Response('fine', { status: 200 }),
    ]);
    await expect(api.getMe()).rejects.toMatchObject({ status: 404, code: 'unexpected.response' });
    await expect(api.getMe()).rejects.toMatchObject({ status: 200, code: 'unexpected.response' });
  });

  it('reports responses of an unexpected shape', async () => {
    const { api } = setup([json({ message: {} }), json({ user_id: 'x' })]);
    await expect(api.sendMessage({ userId: 1 }, { text: 'x' })).rejects.toMatchObject({
      code: 'unexpected.response',
    });
    await expect(api.getMe()).rejects.toMatchObject({ code: 'unexpected.response' });
  });

  it('reports a body that breaks off as a network error without sending the request again', async () => {
    const cause = new TypeError('terminated');
    const { api, requests, sleeps } = setup([brokenBody(cause)]);
    const error = await api.sendMessage({ userId: 1 }, { text: 'x' }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(MaxApiError);
    expect(error).toMatchObject({ status: 0, code: 'network.error', cause });
    expect(requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('reports a cancellation by the caller while the body is read as an abort', async () => {
    const controller = new AbortController();
    const { api, requests } = setup([(request) => breakingBody(() => waitForAbort(request.signal))]);
    const pending = api.getUpdates({ timeoutSeconds: 30, types: [], signal: controller.signal });
    await vi.waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    controller.abort();
    const error = await pending.catch((failure: unknown) => failure);
    expect(error).not.toBeInstanceOf(MaxApiError);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('keeps the token out of error messages', async () => {
    const { api } = setup([json({ code: 'verify.token', message: `Token ${TOKEN} is revoked` }, 401)]);
    await expect(api.getMe()).rejects.toThrow(/^Token \[token\] is revoked$/);
  });

  it('refuses an empty token', () => {
    expect(() => createMaxApi({ token: '', baseUrl: BASE_URL })).toThrow(/empty/);
  });
});

describe('MAX API rate limits', () => {
  it('spaces requests to one chat without delaying other chats', async () => {
    const { api, sleeps } = setup([sent(), sent(), sent(), sent()]);
    await api.sendMessage({ userId: 1 }, { text: 'a' });
    await api.sendMessage({ userId: 1 }, { text: 'b' });
    await api.sendMessage({ userId: 2 }, { text: 'c' });
    expect(sleeps).toEqual([]);
    await api.sendMessage({ userId: 1 }, { text: 'd' });
    expect(sleeps).toEqual([1000]);
  });

  const keyedCalls: [string, (api: MaxApi) => Promise<unknown>, (api: MaxApi) => Promise<unknown>][] = [
    [
      'a chat for messages and typing',
      (api) => api.sendAction(5, 'typing_on'),
      (api) => api.sendMessage({ chatId: 5 }, { text: 'x' }),
    ],
    [
      'one message for edits',
      (api) => api.editMessage('mid.1', { text: 'x' }),
      (api) => api.editMessage('mid.1', { text: 'y' }),
    ],
    [
      'one callback for answers',
      (api) => api.answerCallback('cb.1', {}),
      (api) => api.answerCallback('cb.1', { notification: 'x' }),
    ],
  ];

  it.each(keyedCalls)('spaces requests to %s', async (_name, first, second) => {
    const { api, sleeps } = setup([sent(), sent(), sent(), sent(), sent(), sent()]);
    await first(api);
    await second(api);
    await api.sendMessage({ userId: 5 }, { text: 'other key' });
    await api.editMessage('mid.2', { text: 'other key' });
    await api.answerCallback('cb.2', {});
    expect(sleeps).toEqual([]);
    await first(api);
    expect(sleeps).toEqual([1000]);
  });

  it('holds other methods only to the global limit of 25 requests per second', async () => {
    const { api, sleeps } = setup(Array.from({ length: 26 }, () => json(botInfo)));
    for (let request = 0; request < 25; request += 1) {
      await api.getMe();
    }
    expect(sleeps).toEqual([]);
    await api.getMe();
    expect(sleeps).toEqual([1000]);
  });
});

describe('MAX attachments', () => {
  const upload = (requests: { url: string }[]) => requests.map((request) => request.url);

  it('uploads an image in two steps and returns its token', async () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { api, requests } = setup([
      json({ url: 'https://upload.max.test/u?sig=abc' }),
      json({ photos: { '9001': { token: 'photo-token' } } }),
    ]);
    expect(await api.uploadImage(image, 'qr.png', 'image/png')).toBe('photo-token');
    expect(upload(requests)).toEqual([
      'https://max.test/uploads?type=image',
      'https://upload.max.test/u?sig=abc',
    ]);
    expect(requests[0]).toMatchObject({ method: 'POST', headers: { authorization: TOKEN } });
    expect(requests[1]!.method).toBe('POST');
    expect(requests[1]!.headers.authorization).toBeUndefined();
    expect(requests[1]!.body).toEqual([
      { name: 'data', filename: 'qr.png', type: 'image/png', bytes: image },
    ]);
  });

  it('fails when the upload returns no token', async () => {
    const { api } = setup([json({ url: 'https://upload.max.test/u' }), json({ photos: {} })]);
    await expect(api.uploadImage(Buffer.from('x'), 'qr.png', 'image/png')).rejects.toMatchObject({
      name: 'MaxApiError',
      code: 'unexpected.response',
    });
  });

  const attachmentCalls: [string, (api: MaxApi) => Promise<unknown>, Reply][] = [
    ['sending', (api) => api.sendMessage({ userId: 1 }, { text: 'x' }), sent()],
    ['editing', (api) => api.editMessage('mid', { text: 'x' }), ok()],
    ['answering a callback', (api) => api.answerCallback('cb', { notification: 'x' }), ok()],
  ];

  it.each(attachmentCalls)('retries %s while attachments are not ready', async (_name, run, success) => {
    const { api, requests, sleeps } = setup([notReady(), notReady(), success]);
    await run(api);
    expect(requests).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it.each(attachmentCalls)('gives up %s after waiting 1, 2 and 4 seconds', async (_name, run) => {
    const { api, requests, sleeps } = setup([notReady(), notReady(), notReady(), notReady()]);
    await expect(run(api)).rejects.toMatchObject({ name: 'MaxApiError', code: 'attachment.not.ready' });
    expect(requests).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });
});

describe('MAX file downloads', () => {
  const photoUrl = 'https://i.oneme.test/photo?id=1';

  it('downloads without the token first', async () => {
    const { api, requests } = setup([new Response(Buffer.from('jpeg-bytes'))]);
    expect((await api.download(photoUrl, 1024)).toString()).toBe('jpeg-bytes');
    expect(requests).toMatchObject([{ method: 'GET', url: photoUrl }]);
    expect(requests[0]!.headers.authorization).toBeUndefined();
  });

  it.each([401, 403])('retries once with the token after %i', async (status) => {
    const { api, requests } = setup([new Response('denied', { status }), new Response(Buffer.from('jpeg'))]);
    expect((await api.download(photoUrl, 1024)).toString()).toBe('jpeg');
    expect(requests[0]!.headers.authorization).toBeUndefined();
    expect(requests[1]!.headers.authorization).toBe(TOKEN);
  });

  it('fails when the file is still denied with the token', async () => {
    const { api, requests } = setup([
      new Response('denied', { status: 403 }),
      json({ code: 'access.denied', message: 'No access' }, 403),
    ]);
    await expect(api.download(photoUrl, 1024)).rejects.toMatchObject({ status: 403, code: 'access.denied' });
    expect(requests).toHaveLength(2);
  });

  it('refuses URLs that are not https', async () => {
    const { api, requests } = setup([]);
    for (const url of ['http://i.oneme.test/photo', 'ftp://i.oneme.test/photo', 'not a url']) {
      await expect(api.download(url, 1024)).rejects.toThrow('Only https URLs can be downloaded');
    }
    expect(requests).toHaveLength(0);
  });

  it('rejects files larger than the limit by Content-Length', async () => {
    const { api } = setup([new Response('x', { headers: { 'content-length': '2048' } })]);
    const error = await api.download(photoUrl, 1024).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(DownloadTooLargeError);
    expect(error).toMatchObject({ limitBytes: 1024 });
  });

  it('stops reading a file that grows beyond the limit', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(4));
      },
    });
    const { api } = setup([new Response(stream)]);
    const error = await api.download(photoUrl, 10).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(DownloadTooLargeError);
    expect(pulled).toBeLessThan(10);
  });

  it('reports a file that breaks off as a network error', async () => {
    const cause = new TypeError('terminated');
    const { api } = setup([brokenBody(cause)]);
    const error = await api.download(photoUrl, 1024).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(MaxApiError);
    expect(error).toMatchObject({ status: 0, code: 'network.error', cause });
  });

  it('returns an empty buffer for a response without a body', async () => {
    const { api } = setup([new Response(null, { status: 200 })]);
    expect(await api.download(photoUrl, 8)).toHaveLength(0);
  });

  it('accepts a file exactly at the limit', async () => {
    const { api } = setup([new Response(new Uint8Array(8))]);
    expect(await api.download(photoUrl, 8)).toHaveLength(8);
  });
});
