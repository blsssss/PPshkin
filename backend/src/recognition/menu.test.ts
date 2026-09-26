import { beforeAll, describe, expect, it, vi } from 'vitest';
import { failure, MENU_ANSWER, photo, scriptedClient, type ScriptedStep } from '../../test/recognition.ts';
import type { VisionModel } from '../integrations/chadgpt/models.ts';
import { createMenuParser } from './menu.ts';
import { MENU_PHOTO_REQUEST, MENU_SYSTEM_PROMPT } from './prompts.ts';
import type { MenuAnswer } from './schemas.ts';

let image: Buffer;

beforeAll(async () => {
  image = await photo(900, 1100);
});

function setup(steps: readonly ScriptedStep[]) {
  const client = scriptedClient(steps);
  const sleep = vi.fn(() => Promise.resolve());
  const parser = createMenuParser({
    client,
    visionModel: 'gpt-6-luna',
    fallbackModel: 'gemini-3-flash-preview',
    textModel: 'gpt-6-luna',
    timeoutMs: 120_000,
    sleep,
  });
  return { parser, client, sleep };
}

type MenuItemAnswer = MenuAnswer['items'][number];

const answerWith = (items: Partial<MenuItemAnswer>[], venueName: string | null = null): MenuAnswer => ({
  venue_name: venueName,
  items: items.map((item) => ({ ...MENU_ANSWER.items[0]!, ...item })),
});

describe('menu parser on photos', () => {
  it('parses a ten item menu with the venue name', async () => {
    const { parser, client } = setup([MENU_ANSWER]);
    const result = await parser.fromPhoto(image);
    expect(result).toMatchObject({ status: 'parsed', venueName: 'Кафе «Пушкин и Ко»', model: 'gpt-6-luna' });
    if (result.status !== 'parsed') return;
    expect(result.items).toHaveLength(10);
    expect(result.items[0]).toEqual({
      name: 'Цезарь с курицей',
      description: 'романо, куриное филе, пармезан',
      category: 'salad',
      priceRub: 490,
      weightG: 220,
      kcal: 350,
      proteinG: 10,
      fatG: 12.3,
      carbsG: 30,
      tags: ['salad', 'poultry'],
    });
    expect(result.items[9]).toMatchObject({
      name: 'Морс клюквенный',
      priceRub: null,
      weightG: null,
      tags: ['drink', 'berries'],
    });

    const [request] = client.requests;
    expect(request).toMatchObject({
      model: 'gpt-6-luna',
      system: MENU_SYSTEM_PROMPT,
      user: MENU_PHOTO_REQUEST,
      schemaName: 'menu_items',
      timeoutMs: 120_000,
    });
    expect(request).not.toHaveProperty('reasoningEffort');
    expect(request?.image?.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('accepts an empty menu and leaves the decision to the import', async () => {
    const { parser } = setup([{ venue_name: '   ', items: [] }]);
    await expect(parser.fromPhoto(image)).resolves.toEqual({
      status: 'parsed',
      venueName: null,
      items: [],
      model: 'gpt-6-luna',
    });
  });

  it('drops repeated and nameless items, keeps prices and weights within bounds', async () => {
    const { parser } = setup([
      answerWith([
        { name: 'Эклер', price_rub: 150, weight_g: 70 },
        { name: ' эклер ', price_rub: 170 },
        { name: '  ', price_rub: 100 },
        { name: 'Торт целый', price_rub: 100_001, weight_g: 5001 },
        { name: 'Вода', price_rub: 0, weight_g: 0.4 },
        { name: 'Суп дня', price_rub: 199.5, weight_g: 300.4, description: '  ' },
      ]),
    ]);
    const result = await parser.fromPhoto(image);
    expect(
      result.status === 'parsed' &&
        result.items.map((item) => [item.name, item.priceRub, item.weightG, item.description]),
    ).toEqual([
      ['Эклер', 150, 70, 'романо, куриное филе, пармезан'],
      ['Торт целый', null, null, 'романо, куриное филе, пармезан'],
      ['Вода', 0, null, 'романо, куриное филе, пармезан'],
      ['Суп дня', 200, 300, null],
    ]);
  });

  it('keeps at most 80 items', async () => {
    const { parser } = setup([
      answerWith(Array.from({ length: 85 }, (_, index) => ({ name: `Блюдо ${index + 1}` }))),
    ]);
    const result = await parser.fromPhoto(image);
    expect(result.status === 'parsed' && result.items.length).toBe(80);
  });

  it('clips a long venue name', async () => {
    const { parser } = setup([answerWith([], `  ${'Ю'.repeat(150)}`)]);
    const result = await parser.fromPhoto(image);
    expect(result.status === 'parsed' && result.venueName?.length).toBe(120);
  });

  it('retries like the dish recognizer and reports failures', async () => {
    const { parser, client } = setup(['{"venue_name": null}', 'мусор', MENU_ANSWER]);
    await expect(parser.fromPhoto(image)).resolves.toMatchObject({
      status: 'parsed',
      model: 'gemini-3-flash-preview',
    });
    expect(client.requests.map((request) => request.model)).toEqual([
      'gpt-6-luna',
      'gpt-6-luna',
      'gemini-3-flash-preview',
    ]);

    const quota = setup([failure('quota')]);
    await expect(quota.parser.fromPhoto(image)).resolves.toEqual({
      status: 'unavailable',
      reason: 'quota_exceeded',
    });
  });

  it('refuses an image it cannot decode', async () => {
    const { parser, client } = setup([]);
    await expect(parser.fromPhoto(Buffer.from('%PDF-1.7'))).resolves.toEqual({
      status: 'unavailable',
      reason: 'unsupported_image',
    });
    expect(client.requests).toHaveLength(0);
  });
});

describe('menu parser on text', () => {
  const pasted = 'Выпечка\nКруассан 70 г 150 ₽\nЭклер 150';

  it('sends the pasted text to the text model', async () => {
    const { parser, client } = setup([MENU_ANSWER]);
    await expect(parser.fromText(`  ${pasted}\n`)).resolves.toMatchObject({
      status: 'parsed',
      model: 'gpt-6-luna',
    });
    expect(client.requests[0]).toMatchObject({ user: pasted, schemaName: 'menu_items' });
    expect(client.requests[0]).not.toHaveProperty('image');
  });

  it('falls back to the offline parser when the provider is unavailable', async () => {
    const { parser } = setup([failure('auth')]);
    await expect(parser.fromText(pasted)).resolves.toMatchObject({
      status: 'parsed',
      venueName: null,
      model: 'text-heuristic',
      items: [
        { name: 'Круассан', priceRub: 150, weightG: 70, category: 'bakery' },
        { name: 'Эклер', priceRub: 150, weightG: null, category: 'dessert' },
      ],
    });
  });

  it('keeps the original reason when the offline parser finds nothing', async () => {
    const { parser } = setup([failure('bad_request')]);
    await expect(parser.fromText('Меню на сегодня')).resolves.toEqual({
      status: 'unavailable',
      reason: 'provider_error',
    });
  });
});

describe('menu parser construction', () => {
  it('rejects a primary model that cannot read images', () => {
    expect(() =>
      createMenuParser({
        client: scriptedClient([]),
        visionModel: 'gpt-5-nano' as VisionModel,
        fallbackModel: 'gemini-3-flash-preview',
        textModel: 'gpt-6-luna',
      }),
    ).toThrow(/not known to read images/);
  });
});
