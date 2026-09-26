import { onlyKnownTags } from '../domain/vocabulary.ts';
import type { DishEstimate, DishRecognition, DishRecognizer } from '../ports/recognition.ts';
import { clamp, clip, collapseSpaces, MAX_KCAL, roundGrams } from './normalize.ts';
import { DISH_PHOTO_REQUEST, DISH_SYSTEM_PROMPT } from './prompts.ts';
import { findReferenceDish } from './reference.ts';
import { DISH_ESTIMATE_FORMAT, type DishAnswer } from './schemas.ts';
import {
  assertVisionModels,
  preparePhoto,
  requestAnswer,
  type AnswerRequest,
  type RecognizerDeps,
} from './structured.ts';

const MAX_DISH_ITEMS = 5;
const REFERENCE_CONFIDENCE = 0.4;
const REFERENCE_BASIS = 'Оценка по справочнику типичных порций';

const TITLE_MAX_LENGTH = 200;
const BASIS_MAX_LENGTH = 300;

type DishItemAnswer = DishAnswer['items'][number];

function toEstimate(item: DishItemAnswer): DishEstimate | null {
  const title = clip(collapseSpaces(item.name_ru), TITLE_MAX_LENGTH);
  if (title.length === 0) return null;
  const portion = item.portion_g === null ? null : Math.round(item.portion_g);
  const low = clamp(Math.round(item.kcal_min), 0, MAX_KCAL);
  const high = clamp(Math.round(item.kcal_max), 0, MAX_KCAL);
  return {
    title,
    portionG: portion !== null && portion > 0 ? portion : null,
    kcalMin: Math.min(low, high),
    kcalMax: Math.max(low, high),
    proteinG: roundGrams(item.protein_g),
    fatG: roundGrams(item.fat_g),
    carbsG: roundGrams(item.carbs_g),
    tags: onlyKnownTags(item.tags),
    confidence: clamp(item.confidence, 0, 1),
  };
}

function toRecognition(answer: DishAnswer, model: string): DishRecognition {
  const basis = clip(collapseSpaces(answer.basis), BASIS_MAX_LENGTH);
  if (!answer.is_food) return { status: 'not_food', basis, model };
  const items = answer.items
    .map(toEstimate)
    .filter((item) => item !== null)
    .slice(0, MAX_DISH_ITEMS);
  return items.length > 0
    ? { status: 'recognized', items, basis, model }
    : { status: 'not_food', basis, model };
}

export function referenceRecognition(description: string): DishRecognition | null {
  const dish = findReferenceDish(description);
  if (dish === null) return null;
  return {
    status: 'recognized',
    items: [
      {
        title: dish.name,
        portionG: dish.portionG,
        kcalMin: dish.kcalMin,
        kcalMax: dish.kcalMax,
        proteinG: dish.proteinG,
        fatG: dish.fatG,
        carbsG: dish.carbsG,
        tags: [...dish.tags],
        confidence: REFERENCE_CONFIDENCE,
      },
    ],
    basis: REFERENCE_BASIS,
    model: 'reference',
  };
}

export function createDishRecognizer(deps: RecognizerDeps): DishRecognizer {
  assertVisionModels(deps);

  async function recognise(request: AnswerRequest): Promise<DishRecognition> {
    const result = await requestAnswer(deps, request, DISH_ESTIMATE_FORMAT);
    return result.ok
      ? toRecognition(result.answer, result.model)
      : { status: 'unavailable', reason: result.reason };
  }

  return {
    async fromPhoto(image) {
      const prepared = await preparePhoto(image);
      if (prepared === null) return { status: 'unavailable', reason: 'unsupported_image' };
      return recognise({
        model: deps.visionModel,
        system: DISH_SYSTEM_PROMPT,
        user: DISH_PHOTO_REQUEST,
        image: prepared,
        reasoningEffort: 'low',
      });
    },
    async fromText(description) {
      const recognition = await recognise({
        model: deps.textModel,
        system: DISH_SYSTEM_PROMPT,
        user: description.trim(),
        reasoningEffort: 'low',
      });
      if (recognition.status !== 'unavailable') return recognition;
      return referenceRecognition(description) ?? recognition;
    },
  };
}
