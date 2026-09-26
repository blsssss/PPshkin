import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BORSCHT_ANSWER,
  CAT_ANSWER,
  failure,
  photo,
  scriptedClient,
  TIRAMISU_ANSWER,
  type ScriptedStep,
} from '../../test/recognition.ts';
import type { ChadGptErrorKind } from '../integrations/chadgpt/client.ts';
import type { VisionModel } from '../integrations/chadgpt/models.ts';
import type { UnavailableReason } from '../ports/recognition.ts';
import { createDishRecognizer } from './dish.ts';
import { DISH_PHOTO_REQUEST, DISH_SYSTEM_PROMPT } from './prompts.ts';
import type { DishAnswer } from './schemas.ts';

let image: Buffer;

beforeAll(async () => {
  image = await photo();
});

function setup(steps: readonly ScriptedStep[]) {
  const client = scriptedClient(steps);
  const sleep = vi.fn(() => Promise.resolve());
  const recognizer = createDishRecognizer({
    client,
    visionModel: 'gpt-6-luna',
    fallbackModel: 'gemini-3-flash-preview',
    textModel: 'gpt-5.6-luna',
    timeoutMs: 45_000,
    sleep,
  });
  return { recognizer, client, sleep, models: () => client.requests.map((request) => request.model) };
}

type DishItemAnswer = DishAnswer['items'][number];

const answerWith = (...items: Partial<DishItemAnswer>[]): DishAnswer => ({
  is_food: true,
  basis: 'Оценка по фото.',
  items: items.map((item) => ({ ...TIRAMISU_ANSWER.items[0]!, ...item })),
});

describe('dish recognizer on photos', () => {
  it('recognises borscht and drops tags outside the vocabulary', async () => {
    const { recognizer, client } = setup([BORSCHT_ANSWER]);
    await expect(recognizer.fromPhoto(image)).resolves.toEqual({
      status: 'recognized',
      items: [
        {
          title: 'Борщ со сметаной',
          portionG: 430,
          kcalMin: 250,
          kcalMax: 360,
          proteinG: 10,
          fatG: 14,
          carbsG: 28,
          tags: ['soup', 'vegetables', 'dairy'],
          confidence: 0.78,
        },
      ],
      basis: BORSCHT_ANSWER.basis,
      model: 'gpt-6-luna',
    });
    const [request] = client.requests;
    expect(request).toMatchObject({
      model: 'gpt-6-luna',
      system: DISH_SYSTEM_PROMPT,
      user: DISH_PHOTO_REQUEST,
      schemaName: 'dish_estimate',
      reasoningEffort: 'low',
      timeoutMs: 45_000,
    });
    expect(request?.image?.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('recognises tiramisu', async () => {
    const { recognizer } = setup([TIRAMISU_ANSWER]);
    const recognition = await recognizer.fromPhoto(image);
    expect(recognition).toMatchObject({
      status: 'recognized',
      items: [
        { title: 'Тирамису', kcalMin: 420, kcalMax: 480, tags: ['dessert', 'sweet', 'dairy', 'coffee'] },
      ],
    });
  });

  it('reports a photo of a cat as not food', async () => {
    const { recognizer } = setup([CAT_ANSWER]);
    await expect(recognizer.fromPhoto(image)).resolves.toEqual({
      status: 'not_food',
      basis: 'На фото серая кошка, еды и напитков не видно.',
      model: 'gpt-6-luna',
    });
  });

  it('refuses an image it cannot decode without calling the provider', async () => {
    const { recognizer, client } = setup([]);
    await expect(recognizer.fromPhoto(Buffer.from('not an image'))).resolves.toEqual({
      status: 'unavailable',
      reason: 'unsupported_image',
    });
    expect(client.requests).toHaveLength(0);
  });
});

describe('dish answer conversion', () => {
  async function convert(...items: Partial<DishItemAnswer>[]) {
    const { recognizer } = setup([answerWith(...items)]);
    return recognizer.fromPhoto(image);
  }

  it('cleans and clips titles and drops items without one', async () => {
    const recognition = await convert(
      { name_ru: '  Тирамису \n  классический ' },
      { name_ru: '   ' },
      { name_ru: 'Ж'.repeat(250) },
    );
    expect(recognition.status === 'recognized' && recognition.items.map((item) => item.title)).toEqual([
      'Тирамису классический',
      'Ж'.repeat(200),
    ]);
  });

  it.each([
    [null, null],
    [149.6, 150],
    [0, null],
    [-20, null],
  ])('turns portion %j into %j', async (portion, expected) => {
    const recognition = await convert({ portion_g: portion });
    expect(recognition).toMatchObject({ items: [{ portionG: expected }] });
  });

  it.each([
    [
      [250.4, 360.6],
      [250, 361],
    ],
    [
      [480, 420],
      [420, 480],
    ],
    [
      [-50, 20],
      [0, 20],
    ],
    [
      [4800, 7000],
      [4800, 5000],
    ],
  ])('turns calories %j into %j', async ([low, high], [kcalMin, kcalMax]) => {
    const recognition = await convert({ kcal_min: low, kcal_max: high });
    expect(recognition).toMatchObject({ items: [{ kcalMin, kcalMax }] });
  });

  it('rounds macros to one decimal and keeps them non negative', async () => {
    const recognition = await convert({ protein_g: 7.26, fat_g: -2, carbs_g: 35.04 });
    expect(recognition).toMatchObject({ items: [{ proteinG: 7.3, fatG: 0, carbsG: 35 }] });
  });

  it('keeps known tags once in their order', async () => {
    const recognition = await convert({ tags: ['Sweet', 'nuts', 'dessert', 'sweet', ' coffee '] });
    expect(recognition).toMatchObject({ items: [{ tags: ['sweet', 'dessert', 'coffee'] }] });
  });

  it.each([
    [1.4, 1],
    [-0.2, 0],
    [0.35, 0.35],
  ])('clamps confidence %d to %d', async (confidence, expected) => {
    const recognition = await convert({ confidence });
    expect(recognition).toMatchObject({ items: [{ confidence: expected }] });
  });

  it('keeps the first five items', async () => {
    const recognition = await convert(
      ...Array.from({ length: 7 }, (_, index) => ({ name_ru: `Блюдо ${index + 1}` })),
    );
    expect(recognition.status === 'recognized' && recognition.items.map((item) => item.title)).toEqual([
      'Блюдо 1',
      'Блюдо 2',
      'Блюдо 3',
      'Блюдо 4',
      'Блюдо 5',
    ]);
  });

  it('reports food without usable items as not food with the basis from the model', async () => {
    const { recognizer } = setup([
      {
        is_food: true,
        basis: '  Размытое   фото. ',
        items: [{ ...TIRAMISU_ANSWER.items[0]!, name_ru: ' ' }],
      },
    ]);
    await expect(recognizer.fromPhoto(image)).resolves.toEqual({
      status: 'not_food',
      basis: 'Размытое фото.',
      model: 'gpt-6-luna',
    });
  });
});

describe('dish recognizer retries', () => {
  it('asks the same model again after an invalid answer', async () => {
    const { recognizer, models, sleep } = setup(['не JSON', TIRAMISU_ANSWER]);
    await expect(recognizer.fromPhoto(image)).resolves.toMatchObject({
      status: 'recognized',
      model: 'gpt-6-luna',
    });
    expect(models()).toEqual(['gpt-6-luna', 'gpt-6-luna']);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('switches to the fallback model after two invalid answers and reports it as the source', async () => {
    const { recognizer, models } = setup([failure('truncated'), '{"is_food": "yes"}', TIRAMISU_ANSWER]);
    await expect(recognizer.fromPhoto(image)).resolves.toMatchObject({
      status: 'recognized',
      model: 'gemini-3-flash-preview',
    });
    expect(models()).toEqual(['gpt-6-luna', 'gpt-6-luna', 'gemini-3-flash-preview']);
  });

  it('gives up with invalid_response after three invalid answers', async () => {
    const { recognizer, client } = setup([failure('empty'), 'нет', '{}', TIRAMISU_ANSWER]);
    await expect(recognizer.fromPhoto(image)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid_response',
    });
    expect(client.requests).toHaveLength(3);
  });

  it('waits a second and retries the same model after a retryable failure', async () => {
    const { recognizer, models, sleep } = setup([failure('server'), BORSCHT_ANSWER]);
    await expect(recognizer.fromPhoto(image)).resolves.toMatchObject({
      status: 'recognized',
      model: 'gpt-6-luna',
    });
    expect(models()).toEqual(['gpt-6-luna', 'gpt-6-luna']);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1000);
  });

  it.each<[ChadGptErrorKind, UnavailableReason]>([
    ['timeout', 'timeout'],
    ['network', 'provider_error'],
    ['server', 'provider_error'],
  ])('reports a repeated %s failure as %s after two calls', async (kind, reason) => {
    const { recognizer, client, sleep } = setup([failure(kind), failure(kind), TIRAMISU_ANSWER]);
    await expect(recognizer.fromPhoto(image)).resolves.toEqual({ status: 'unavailable', reason });
    expect(client.requests).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it.each<[ChadGptErrorKind, UnavailableReason]>([
    ['auth', 'provider_error'],
    ['bad_request', 'provider_error'],
    ['quota', 'quota_exceeded'],
  ])('stops at once on a %s failure and reports %s', async (kind, reason) => {
    const { recognizer, client, sleep } = setup([failure(kind), TIRAMISU_ANSWER]);
    await expect(recognizer.fromPhoto(image)).resolves.toEqual({ status: 'unavailable', reason });
    expect(client.requests).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('never makes more than three calls when failures and invalid answers mix', async () => {
    const { recognizer, models, sleep } = setup(['мусор', failure('network'), '{}', TIRAMISU_ANSWER]);
    await expect(recognizer.fromPhoto(image)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid_response',
    });
    expect(models()).toEqual(['gpt-6-luna', 'gpt-6-luna', 'gpt-6-luna']);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('reports the failure of the last call when the fallback model fails', async () => {
    const { recognizer, models, sleep } = setup(['мусор', 'мусор', failure('timeout')]);
    await expect(recognizer.fromPhoto(image)).resolves.toEqual({ status: 'unavailable', reason: 'timeout' });
    expect(models()).toEqual(['gpt-6-luna', 'gpt-6-luna', 'gemini-3-flash-preview']);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('lets unexpected errors through', async () => {
    const recognizer = createDishRecognizer({
      client: { complete: () => Promise.reject(new RangeError('bug')) },
      visionModel: 'gpt-6-luna',
      fallbackModel: 'gemini-3-flash-preview',
      textModel: 'gpt-6-luna',
    });
    await expect(recognizer.fromText('борщ')).rejects.toBeInstanceOf(RangeError);
  });
});

describe('dish recognizer on text', () => {
  it('sends the description as text to the text model', async () => {
    const { recognizer, client } = setup([BORSCHT_ANSWER]);
    await expect(recognizer.fromText('  съел борщ и кусок хлеба ')).resolves.toMatchObject({
      status: 'recognized',
      model: 'gpt-5.6-luna',
    });
    expect(client.requests[0]).toMatchObject({ model: 'gpt-5.6-luna', user: 'съел борщ и кусок хлеба' });
    expect(client.requests[0]).not.toHaveProperty('image');
  });

  it('keeps a not food answer for a description that is not about food', async () => {
    const { recognizer } = setup([{ is_food: false, basis: 'В описании нет еды.', items: [] }]);
    await expect(recognizer.fromText('погулял в парке')).resolves.toMatchObject({ status: 'not_food' });
  });

  it('falls back to the reference dishes when the provider is unavailable', async () => {
    const { recognizer } = setup([failure('quota')]);
    await expect(recognizer.fromText('съел борщ и кусок хлеба')).resolves.toEqual({
      status: 'recognized',
      items: [
        {
          title: 'Борщ',
          portionG: 300,
          kcalMin: 180,
          kcalMax: 280,
          proteinG: 8,
          fatG: 11,
          carbsG: 22,
          tags: ['soup', 'vegetables', 'meat'],
          confidence: 0.4,
        },
      ],
      basis: 'Оценка по справочнику типичных порций',
      model: 'reference',
    });
  });

  it('keeps the original reason when no reference dish matches', async () => {
    const { recognizer } = setup([failure('timeout'), failure('timeout')]);
    await expect(recognizer.fromText('что-то вкусное')).resolves.toEqual({
      status: 'unavailable',
      reason: 'timeout',
    });
  });
});

describe('dish recognizer construction', () => {
  it.each<[string, string]>([
    ['deepseek-v4-flash', 'gemini-3-flash-preview'],
    ['gpt-6-luna', 'gpt-5-nano'],
  ])('rejects %s with fallback %s', (visionModel, fallbackModel) => {
    expect(() =>
      createDishRecognizer({
        client: scriptedClient([]),
        visionModel: visionModel as VisionModel,
        fallbackModel: fallbackModel as VisionModel,
        textModel: 'gpt-6-luna',
      }),
    ).toThrow(/not known to read images/);
  });
});
