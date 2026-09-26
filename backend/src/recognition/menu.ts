import type { MenuParser, MenuParseResult } from '../ports/recognition.ts';
import { clip, collapseSpaces, finishMenuItems } from './normalize.ts';
import { MENU_PHOTO_REQUEST, MENU_SYSTEM_PROMPT } from './prompts.ts';
import { MENU_ITEMS_FORMAT, type MenuAnswer } from './schemas.ts';
import {
  assertVisionModels,
  preparePhoto,
  requestAnswer,
  type AnswerRequest,
  type RecognizerDeps,
} from './structured.ts';
import { parseTextMenu } from './text-menu.ts';

const VENUE_NAME_MAX_LENGTH = 120;

function toParseResult(answer: MenuAnswer, model: string): MenuParseResult {
  const venueName = clip(collapseSpaces(answer.venue_name ?? ''), VENUE_NAME_MAX_LENGTH);
  return {
    status: 'parsed',
    venueName: venueName.length > 0 ? venueName : null,
    items: finishMenuItems(
      answer.items.map((item) => ({
        name: item.name,
        description: item.description,
        category: item.category,
        priceRub: item.price_rub,
        weightG: item.weight_g,
        kcal: item.kcal,
        proteinG: item.protein_g,
        fatG: item.fat_g,
        carbsG: item.carbs_g,
        tags: item.tags,
      })),
    ),
    model,
  };
}

export function heuristicMenu(text: string): MenuParseResult | null {
  const items = parseTextMenu(text);
  return items.length > 0 ? { status: 'parsed', venueName: null, items, model: 'text-heuristic' } : null;
}

export function createMenuParser(deps: RecognizerDeps): MenuParser {
  assertVisionModels(deps);

  async function parse(request: AnswerRequest): Promise<MenuParseResult> {
    const result = await requestAnswer(deps, request, MENU_ITEMS_FORMAT);
    return result.ok
      ? toParseResult(result.answer, result.model)
      : { status: 'unavailable', reason: result.reason };
  }

  return {
    async fromPhoto(image) {
      const prepared = await preparePhoto(image);
      if (prepared === null) return { status: 'unavailable', reason: 'unsupported_image' };
      return parse({
        model: deps.visionModel,
        system: MENU_SYSTEM_PROMPT,
        user: MENU_PHOTO_REQUEST,
        image: prepared,
      });
    },
    async fromText(text) {
      const result = await parse({ model: deps.textModel, system: MENU_SYSTEM_PROMPT, user: text.trim() });
      if (result.status !== 'unavailable') return result;
      return heuristicMenu(text) ?? result;
    },
  };
}
