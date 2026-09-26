import { z } from 'zod';
import { configSchema } from '../config.ts';
import { isVisionModel } from '../integrations/chadgpt/models.ts';
import type { DishEstimate, DishRecognition } from '../ports/recognition.ts';
import { smokeCheck, SmokeFailure, type SmokeCheck, type SmokeContext } from './check.ts';

const SAMPLES = new URL('../../testdata/samples/', import.meta.url);
const DISH_PHOTO = new URL('dish.jpg', SAMPLES);
const MENU_TEXT = new URL('menu.txt', SAMPLES);
const MEAL_DESCRIPTION = 'капучино и круассан';
const PHOTO_TIME_LIMIT_MS = 45_000;
const KCAL_CEILING = 2000;
const MIN_PRICED_MENU_ITEMS = 4;

const recognitionSettings = z.object({
  CHADGPT_BASE_URL: configSchema.shape.CHADGPT_BASE_URL,
  CHADGPT_MODEL: configSchema.shape.CHADGPT_MODEL,
  CHADGPT_FALLBACK_MODEL: configSchema.shape.CHADGPT_FALLBACK_MODEL,
  CHADGPT_TIMEOUT_MS: configSchema.shape.CHADGPT_TIMEOUT_MS,
  CHADGPT_MENU_TIMEOUT_MS: configSchema.shape.CHADGPT_MENU_TIMEOUT_MS,
});

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const describeDish = (dish: DishEstimate) => `${dish.title} ${dish.kcalMin}-${dish.kcalMax} kcal`;
const withinBounds = (dish: DishEstimate) =>
  dish.kcalMin > 0 && dish.kcalMin <= dish.kcalMax && dish.kcalMax <= KCAL_CEILING;

function requireChadGpt(model: string): void {
  if (!isVisionModel(model)) throw new SmokeFailure(`ChadGPT did not answer, the offline ${model} did`);
}

function recognizedDishes(result: DishRecognition): { items: DishEstimate[]; model: string } {
  if (result.status === 'unavailable') throw new SmokeFailure(`status unavailable, reason ${result.reason}`);
  if (result.status === 'not_food') throw new SmokeFailure(`status not_food from ${result.model}`);
  requireChadGpt(result.model);
  if (result.items.length === 0) throw new SmokeFailure(`no dishes from ${result.model}`);
  return result;
}

export function recognitionChecks({ env, deps }: SmokeContext): SmokeCheck[] {
  const recognition = (apiKey: string) => {
    const settings = recognitionSettings.parse(env);
    return deps.createRecognition({
      apiKey,
      baseUrl: settings.CHADGPT_BASE_URL,
      visionModel: settings.CHADGPT_MODEL,
      fallbackModel: settings.CHADGPT_FALLBACK_MODEL,
      timeoutMs: settings.CHADGPT_TIMEOUT_MS,
      menuTimeoutMs: settings.CHADGPT_MENU_TIMEOUT_MS,
      fetch: deps.fetch,
    });
  };

  return [
    smokeCheck('recognition.photo', ['CHADGPT_API_KEY'], async (apiKey) => {
      const { dishes } = recognition(apiKey);
      const image = await deps.readFile(DISH_PHOTO);
      const started = deps.clock.now().getTime();
      const result = await dishes.fromPhoto(image);
      const tookMs = deps.clock.now().getTime() - started;
      const { items, model } = recognizedDishes(result);
      const summary = `${model} in ${seconds(tookMs)}: ${items.map(describeDish).join(', ')}`;
      const outOfBounds = items.filter((dish) => !withinBounds(dish));
      if (outOfBounds.length > 0) {
        throw new SmokeFailure(`${summary}; kcal outside 0 < min <= max <= ${KCAL_CEILING}`);
      }
      if (tookMs > PHOTO_TIME_LIMIT_MS) {
        throw new SmokeFailure(`${summary}; slower than ${seconds(PHOTO_TIME_LIMIT_MS)}`);
      }
      return summary;
    }),

    smokeCheck('recognition.text', ['CHADGPT_API_KEY'], async (apiKey) => {
      const { items, model } = recognizedDishes(await recognition(apiKey).dishes.fromText(MEAL_DESCRIPTION));
      return `${model}: ${items.map(describeDish).join(', ')}`;
    }),

    smokeCheck('recognition.menu', ['CHADGPT_API_KEY'], async (apiKey) => {
      const { menus } = recognition(apiKey);
      const result = await menus.fromText((await deps.readFile(MENU_TEXT)).toString('utf8'));
      if (result.status === 'unavailable') {
        throw new SmokeFailure(`status unavailable, reason ${result.reason}`);
      }
      requireChadGpt(result.model);
      const priced = result.items.filter((item) => item.priceRub !== null).length;
      const summary = `${result.model}: ${result.items.length} items, ${priced} with a price`;
      if (priced < MIN_PRICED_MENU_ITEMS) {
        throw new SmokeFailure(`${summary}, expected at least ${MIN_PRICED_MENU_ITEMS}`);
      }
      return summary;
    }),
  ];
}
