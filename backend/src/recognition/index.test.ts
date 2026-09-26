import { beforeAll, describe, expect, it, vi } from 'vitest';
import { photo, TIRAMISU_ANSWER } from '../../test/recognition.ts';
import { createRecognition, type RecognitionSettings } from './index.ts';

let image: Buffer;

beforeAll(async () => {
  image = await photo();
});

const completion = (content: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    }),
    { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_1' } },
  );

function settings(overrides: Partial<RecognitionSettings> = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(completion(JSON.stringify(TIRAMISU_ANSWER))),
  );
  return {
    fetch,
    settings: {
      apiKey: undefined,
      baseUrl: 'https://ask.chadgpt.ru/api/v1',
      visionModel: 'gpt-6-luna',
      fallbackModel: 'gemini-3-flash-preview',
      timeoutMs: 45_000,
      menuTimeoutMs: 120_000,
      fetch,
      ...overrides,
    },
  };
}

describe('createRecognition without an API key', () => {
  it.each([undefined, ''])('reports photos as disabled without network calls for key %j', async (apiKey) => {
    const { fetch, settings: options } = settings({ apiKey });
    const recognition = createRecognition(options);
    await expect(recognition.dishes.fromPhoto(image)).resolves.toEqual({
      status: 'unavailable',
      reason: 'disabled',
    });
    await expect(recognition.menus.fromPhoto(image)).resolves.toEqual({
      status: 'unavailable',
      reason: 'disabled',
    });
    await recognition.dishes.fromText('съел борщ');
    await recognition.menus.fromText('Эклер 150 ₽');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('estimates text meals from the reference dishes', async () => {
    const recognition = createRecognition(settings().settings);
    await expect(recognition.dishes.fromText('съел борщ')).resolves.toMatchObject({
      status: 'recognized',
      model: 'reference',
      items: [{ title: 'Борщ', confidence: 0.4 }],
    });
    await expect(recognition.dishes.fromText('что-то вкусное')).resolves.toEqual({
      status: 'unavailable',
      reason: 'disabled',
    });
  });

  it('parses text menus with the offline parser', async () => {
    const recognition = createRecognition(settings().settings);
    await expect(recognition.menus.fromText('Эклер 150 ₽')).resolves.toMatchObject({
      status: 'parsed',
      venueName: null,
      model: 'text-heuristic',
      items: [{ name: 'Эклер', priceRub: 150 }],
    });
    await expect(recognition.menus.fromText('Напитки')).resolves.toEqual({
      status: 'unavailable',
      reason: 'disabled',
    });
  });
});

describe('createRecognition with an API key', () => {
  it('recognises photos through ChadGPT with the configured model', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { fetch, settings: options } = settings({ apiKey: 'chad-key-0123456789', logger });
    const recognition = createRecognition(options);
    await expect(recognition.dishes.fromPhoto(image)).resolves.toMatchObject({
      status: 'recognized',
      model: 'gpt-6-luna',
      items: [{ title: 'Тирамису' }],
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://ask.chadgpt.ru/api/v1/chat/completions');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer chad-key-0123456789' });
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it('uses the same model for text', async () => {
    const { fetch, settings: options } = settings({
      apiKey: 'chad-key-0123456789',
      visionModel: 'gpt-5.6-luna',
    });
    const recognition = createRecognition(options);
    await recognition.dishes.fromText('съел тирамису');
    const body = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string) as { model: string };
    expect(body.model).toBe('gpt-5.6-luna');
  });

  it('falls back to the offline parser when ChadGPT rejects the key', async () => {
    const { fetch, settings: options } = settings({ apiKey: 'chad-key-0123456789' });
    fetch.mockImplementation(() => Promise.resolve(new Response('{"error":{}}', { status: 401 })));
    const recognition = createRecognition(options);
    await expect(recognition.menus.fromText('Эклер 150 ₽')).resolves.toMatchObject({
      model: 'text-heuristic',
    });
    await expect(recognition.menus.fromPhoto(image)).resolves.toEqual({
      status: 'unavailable',
      reason: 'provider_error',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('createRecognition settings', () => {
  it.each([
    { visionModel: 'deepseek-v4-flash' },
    { fallbackModel: 'gpt-5-nano' },
    { apiKey: 'chad-key-0123456789', fallbackModel: 'gpt-5-nano' },
  ])('rejects models that cannot read images: %j', (overrides) => {
    expect(() => createRecognition(settings(overrides).settings)).toThrow(/not known to read images/);
  });
});
