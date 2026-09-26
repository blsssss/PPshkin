import { readFileSync, statSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { fakeRecognition, fakeSmokeDependencies } from '../../test/smoke.ts';
import type { ParsedMenuItem } from '../domain/models.ts';
import type { DishEstimate, DishRecognition, MenuParseResult } from '../ports/recognition.ts';
import { heuristicMenu } from '../recognition/menu.ts';
import { runSmoke } from './run.ts';

const SAMPLES = new URL('../../testdata/samples/', import.meta.url);
const DISH_PHOTO = new URL('dish.jpg', SAMPLES);
const MENU_TEXT = new URL('menu.txt', SAMPLES);
const ENV = { CHADGPT_API_KEY: 'chadgpt-key-0123456789' };

const menuText = readFileSync(MENU_TEXT, 'utf8');

function chadGptMenu(): MenuParseResult {
  const parsed = heuristicMenu(menuText);
  return parsed?.status === 'parsed'
    ? { ...parsed, model: 'gpt-6-luna' }
    : { status: 'unavailable', reason: 'invalid_response' };
}

const dish = (patch: Partial<DishEstimate> = {}): DishEstimate => ({
  title: 'Борщ со сметаной',
  portionG: 430,
  kcalMin: 250,
  kcalMax: 360,
  proteinG: 10,
  fatG: 14,
  carbsG: 28,
  tags: ['soup'],
  confidence: 0.8,
  ...patch,
});

const recognized = (items: DishEstimate[] = [dish()], model = 'gpt-6-luna'): DishRecognition => ({
  status: 'recognized',
  items,
  basis: 'Свекольный суп со сметаной.',
  model,
});

const menuItem = (name: string, priceRub: number | null): ParsedMenuItem => ({
  name,
  description: null,
  category: 'dessert',
  priceRub,
  weightG: null,
  kcal: 300,
  proteinG: 5,
  fatG: 15,
  carbsG: 35,
  tags: [],
});

interface Answers {
  photo?: DishRecognition;
  photoMs?: number;
  text?: DishRecognition;
  menu?: MenuParseResult;
}

async function runRecognition(
  answers: Answers = {},
  env: Record<string, string | undefined> = ENV,
  strict = false,
) {
  const createRecognition = vi.fn(() => recognition);
  const deps = fakeSmokeDependencies({ createRecognition });
  const recognition = fakeRecognition({
    dishes: {
      fromPhoto: vi.fn(() => {
        deps.clock.advance(answers.photoMs ?? 0);
        return Promise.resolve(answers.photo ?? recognized());
      }),
      fromText: vi.fn(() =>
        Promise.resolve(answers.text ?? recognized([dish({ title: 'Капучино', kcalMin: 90, kcalMax: 130 })])),
      ),
    },
    menus: {
      fromText: vi.fn(() => Promise.resolve(answers.menu ?? chadGptMenu())),
    },
  });
  const results = await runSmoke({ checks: ['recognition'], strict, env }, deps);
  const byName = (name: string) => results.find((result) => result.name === name);
  return {
    deps,
    recognition,
    createRecognition,
    results,
    photo: byName('recognition.photo'),
    text: byName('recognition.text'),
    menu: byName('recognition.menu'),
  };
}

describe('recognition checks', () => {
  it('reports the answering model, the response time, the dishes and their kcal range', async () => {
    const { photo, deps, recognition, createRecognition } = await runRecognition({ photoMs: 6_200 });

    expect(photo).toEqual({
      name: 'recognition.photo',
      status: 'ok',
      durationMs: 6_200,
      details: 'gpt-6-luna in 6.2 s: Борщ со сметаной 250-360 kcal',
    });
    expect(deps.readFile).toHaveBeenCalledWith(DISH_PHOTO);
    expect(recognition.dishes.fromPhoto).toHaveBeenCalledWith(readFileSync(DISH_PHOTO));
    expect(createRecognition).toHaveBeenCalledWith({
      apiKey: ENV.CHADGPT_API_KEY,
      baseUrl: 'https://ask.chadgpt.ru/api/v1',
      visionModel: 'gpt-6-luna',
      fallbackModel: 'gemini-3-flash-preview',
      timeoutMs: 45_000,
      menuTimeoutMs: 120_000,
      fetch: expect.any(Function) as typeof fetch,
    });
  });

  it('takes the ChadGPT settings from the environment', async () => {
    const { createRecognition, results } = await runRecognition(
      {},
      {
        CHADGPT_API_KEY: ` ${ENV.CHADGPT_API_KEY} `,
        CHADGPT_BASE_URL: 'https://chadgpt.example/api/v1',
        CHADGPT_MODEL: 'gemini-3-flash-preview',
        CHADGPT_FALLBACK_MODEL: 'gpt-5.6-luna',
        CHADGPT_TIMEOUT_MS: '30000',
        CHADGPT_MENU_TIMEOUT_MS: '',
      },
    );

    expect(results.map(({ status }) => status)).toEqual(['ok', 'ok', 'ok']);
    expect(createRecognition).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: ENV.CHADGPT_API_KEY,
        baseUrl: 'https://chadgpt.example/api/v1',
        visionModel: 'gemini-3-flash-preview',
        fallbackModel: 'gpt-5.6-luna',
        timeoutMs: 30_000,
        menuTimeoutMs: 120_000,
      }),
    );
  });

  it('fails every recognition check on an invalid setting', async () => {
    const { results, createRecognition } = await runRecognition({}, { ...ENV, CHADGPT_MODEL: 'gpt-2' });

    expect(results.map(({ status }) => status)).toEqual(['failed', 'failed', 'failed']);
    expect(results.every((result) => result.details.startsWith('CHADGPT_MODEL: '))).toBe(true);
    expect(createRecognition).not.toHaveBeenCalled();
  });

  it.each<[string, DishRecognition, string]>([
    [
      'not_food',
      { status: 'not_food', basis: 'На фото кружка.', model: 'gpt-6-luna' },
      'status not_food from gpt-6-luna',
    ],
    [
      'unavailable',
      { status: 'unavailable', reason: 'quota_exceeded' },
      'status unavailable, reason quota_exceeded',
    ],
    ['no dishes', recognized([]), 'no dishes from gpt-6-luna'],
  ])('fails the photo check on %s', async (_label, photo, details) => {
    const result = await runRecognition({ photo });

    expect(result.photo).toMatchObject({ status: 'failed', details });
  });

  it.each([
    ['zero kcalMin', dish({ title: 'Вода', kcalMin: 0, kcalMax: 5 })],
    ['kcalMin above kcalMax', dish({ title: 'Суп', kcalMin: 400, kcalMax: 360 })],
    ['kcalMax above 2000', dish({ title: 'Торт', kcalMin: 1500, kcalMax: 2001 })],
  ])('fails the photo check on %s', async (_label, outOfBounds) => {
    const { photo } = await runRecognition({ photo: recognized([dish(), outOfBounds]) });

    expect(photo?.status).toBe('failed');
    expect(photo?.details).toBe(
      `gpt-6-luna in 0.0 s: Борщ со сметаной 250-360 kcal, ${outOfBounds.title} ` +
        `${outOfBounds.kcalMin}-${outOfBounds.kcalMax} kcal; kcal outside 0 < min <= max <= 2000`,
    );
  });

  it('accepts the photo answered in exactly 45 s and fails a slower one by the injected clock', async () => {
    const onTime = await runRecognition({ photoMs: 45_000 });
    const late = await runRecognition({
      photoMs: 45_100,
      photo: recognized([dish()], 'gemini-3-flash-preview'),
    });

    expect(onTime.photo).toMatchObject({ status: 'ok', durationMs: 45_000 });
    expect(late.photo).toEqual({
      name: 'recognition.photo',
      status: 'failed',
      durationMs: 45_100,
      details: 'gemini-3-flash-preview in 45.1 s: Борщ со сметаной 250-360 kcal; slower than 45.0 s',
    });
  });

  it('recognizes the text meal', async () => {
    const { text, recognition } = await runRecognition();

    expect(text).toMatchObject({ status: 'ok', details: 'gpt-6-luna: Капучино 90-130 kcal' });
    expect(recognition.dishes.fromText).toHaveBeenCalledWith('капучино и круассан');
  });

  it.each<[string, DishRecognition, string]>([
    ['unavailable', { status: 'unavailable', reason: 'timeout' }, 'status unavailable, reason timeout'],
    [
      'not_food',
      { status: 'not_food', basis: 'Не еда.', model: 'reference' },
      'status not_food from reference',
    ],
  ])('fails the text check when the answer is %s', async (_label, answer, details) => {
    const { text } = await runRecognition({ text: answer });

    expect(text).toMatchObject({ status: 'failed', details });
  });

  it('parses the menu sample and names the model that answered', async () => {
    const { menu, recognition, deps } = await runRecognition();

    expect(menu).toMatchObject({ status: 'ok', details: 'gpt-6-luna: 8 items, 8 with a price' });
    expect(deps.readFile).toHaveBeenCalledWith(MENU_TEXT);
    expect(recognition.menus.fromText).toHaveBeenCalledWith(menuText);
  });

  it('fails the text and menu checks when the offline fallback answered instead of ChadGPT', async () => {
    const { text, menu } = await runRecognition({
      text: recognized([dish({ title: 'Капучино' })], 'reference'),
      menu: heuristicMenu(menuText) ?? { status: 'unavailable', reason: 'invalid_response' },
    });

    expect(text).toMatchObject({
      status: 'failed',
      details: 'ChadGPT did not answer, the offline reference did',
    });
    expect(menu).toMatchObject({
      status: 'failed',
      details: 'ChadGPT did not answer, the offline text-heuristic did',
    });
  });

  it.each<[string, MenuParseResult, string]>([
    [
      'fewer than 4 priced items',
      {
        status: 'parsed',
        venueName: null,
        items: [menuItem('Эклер', 150), menuItem('Капучино', 190), menuItem('Чай', null)],
        model: 'gpt-6-luna',
      },
      'gpt-6-luna: 3 items, 2 with a price, expected at least 4',
    ],
    [
      'an unavailable parser',
      { status: 'unavailable', reason: 'provider_error' },
      'status unavailable, reason provider_error',
    ],
  ])('fails the menu check with %s', async (_label, answer, details) => {
    const { menu } = await runRecognition({ menu: answer });

    expect(menu).toMatchObject({ status: 'failed', details });
  });

  it('skips without CHADGPT_API_KEY instead of falling back to the offline recognizer', async () => {
    const skipped = await runRecognition({}, { CHADGPT_MODEL: 'gpt-6-luna' });
    const failed = await runRecognition({}, { CHADGPT_API_KEY: '' }, true);

    expect(skipped.results.map(({ name, status, details }) => [name, status, details])).toEqual([
      ['recognition.photo', 'skipped', 'CHADGPT_API_KEY is not set'],
      ['recognition.text', 'skipped', 'CHADGPT_API_KEY is not set'],
      ['recognition.menu', 'skipped', 'CHADGPT_API_KEY is not set'],
    ]);
    expect(failed.results.map(({ status }) => status)).toEqual(['failed', 'failed', 'failed']);
    expect(skipped.createRecognition).not.toHaveBeenCalled();
    expect(failed.createRecognition).not.toHaveBeenCalled();
  });
});

describe('recognition samples', () => {
  it('keep the menu in 6 to 8 lines with at least 4 prices that the heuristic understands', () => {
    const lines = menuText.split('\n').filter((line) => line.trim().length > 0);
    const parsed = heuristicMenu(menuText);
    const priced = parsed?.status === 'parsed' ? parsed.items.filter((item) => item.priceRub !== null) : [];

    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(priced.length).toBeGreaterThanOrEqual(4);
  });

  it('keep the dish photo a JPEG up to 300 KB and 1280 px without metadata', async () => {
    const metadata = await sharp(readFileSync(DISH_PHOTO)).metadata();

    expect(metadata.format).toBe('jpeg');
    expect(Math.max(metadata.width, metadata.height)).toBeLessThanOrEqual(1280);
    expect(statSync(DISH_PHOTO).size).toBeLessThanOrEqual(300 * 1024);
    expect([metadata.exif, metadata.xmp, metadata.iptc]).toEqual([undefined, undefined, undefined]);
  });
});
