import type { ParsedMenuItem } from '../domain/models.ts';
import type { MenuCategory, Tag } from '../domain/vocabulary.ts';
import { finishMenuItems, stem, weightWithinBounds, words, type MenuItemDraft } from './normalize.ts';
import { CATEGORY_DEFAULTS, findReferenceDish } from './reference.ts';

const CATEGORY_KEYWORDS: readonly (readonly [MenuCategory, readonly string[]])[] = [
  [
    'drink',
    ['кофе', 'капучино', 'латте', 'раф', 'американо', 'эспрессо', 'чай', 'сок', 'морс', 'лимонад', 'смузи'],
  ],
  ['soup', ['суп', 'борщ', 'солянка', 'щи', 'уха']],
  ['salad', ['салат']],
  ['dessert', ['торт', 'чизкейк', 'эклер', 'пирожное', 'десерт', 'тирамису', 'медовик', 'наполеон']],
  ['bakery', ['круассан', 'булочка', 'пирожок', 'пирожки', 'слойка', 'хлеб', 'маффин']],
  ['breakfast', ['сырники', 'каша', 'овсянка', 'омлет', 'яичница', 'блины', 'блинчики']],
];

const TAG_KEYWORDS: readonly (readonly [readonly Tag[], readonly string[]])[] = [
  [['poultry'], ['курица', 'куриный', 'цыпленок', 'индейка']],
  [['meat'], ['говядина', 'свинина', 'телятина', 'баранина', 'ветчина', 'бекон']],
  [['fish'], ['рыба', 'рыбный', 'лосось', 'семга', 'форель']],
  [['seafood'], ['креветки', 'кальмар', 'мидии']],
  [['cheese'], ['сыр', 'сырный', 'моцарелла', 'пармезан']],
  [['chocolate'], ['шоколад', 'шоколадный']],
  [['berries'], ['ягоды', 'ягодный', 'вишня', 'клубника', 'малина', 'черника']],
  [
    ['coffee', 'drink'],
    ['кофе', 'капучино', 'латте', 'раф', 'американо', 'эспрессо'],
  ],
  [['tea', 'drink'], ['чай']],
  [
    ['juice', 'drink'],
    ['сок', 'фреш'],
  ],
];

const toStems = (keywords: readonly string[]): ReadonlySet<string> => new Set(keywords.map(stem));
const CATEGORY_STEMS = CATEGORY_KEYWORDS.map(
  ([category, keywords]) => [category, toStems(keywords)] as const,
);
const TAG_STEMS = TAG_KEYWORDS.map(([tags, keywords]) => [tags, toStems(keywords)] as const);

const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const SLASHED_NUMBERS = String.raw`${NUMBER}(?:\s*\/\s*${NUMBER})*`;
const GROUPED_PRICE = String.raw`\d(?:[ \u{a0}\u{202f}]\d{3})+(?=\s*(?:\u{20bd}|руб|р\.|р(?!\p{L})))`;
const UNIT = String.raw`\s*(?:(гр|г|g)|(мл|ml|л))\.?(?!\p{L})`;
const QUANTITY = new RegExp(`(${GROUPED_PRICE}|${SLASHED_NUMBERS})(?:${UNIT})?`, 'giu');
const LIST_MARKER = /^\s*\d{1,2}[.)]\s+/u;
const SEPARATORS = String.raw`[\s.,:;|(/\-\u{2013}\u{2014}\u{2026}\u{2022}\u{b7}*]+`;
const NAME_EDGES = new RegExp(`^${SEPARATORS}|${SEPARATORS}$`, 'gu');

interface Quantity {
  index: number;
  values: number[];
  unit: 'weight' | 'volume' | null;
}

function quantities(line: string): Quantity[] {
  return [...line.matchAll(QUANTITY)].map((match) => ({
    index: match.index,
    values: (match[1] ?? '').split('/').map((part) => Number(part.replace(/\s/g, '').replace(',', '.'))),
    unit: match[2] !== undefined ? 'weight' : match[3] !== undefined ? 'volume' : null,
  }));
}

function categoryOf(stems: readonly string[]): MenuCategory {
  return (
    CATEGORY_STEMS.find(([, keywords]) => stems.some((wordStem) => keywords.has(wordStem)))?.[0] ?? 'main'
  );
}

function keywordTags(stems: readonly string[]): Tag[] {
  return TAG_STEMS.filter(([, keywords]) => stems.some((wordStem) => keywords.has(wordStem))).flatMap(
    ([tags]) => tags,
  );
}

function nutrition(name: string, category: MenuCategory, weightG: number | null) {
  const dish = findReferenceDish(name);
  if (dish === null) return CATEGORY_DEFAULTS[category];
  const scale = weightG === null ? 1 : weightG / dish.portionG;
  return {
    kcal: ((dish.kcalMin + dish.kcalMax) / 2) * scale,
    proteinG: dish.proteinG * scale,
    fatG: dish.fatG * scale,
    carbsG: dish.carbsG * scale,
    tags: dish.tags,
  };
}

function parseLine(rawLine: string): MenuItemDraft | null {
  const line = rawLine.replace(LIST_MARKER, '');
  const found = quantities(line);
  const price = found.findLast((quantity) => quantity.unit === null && quantity.values.length === 1);
  const first = found[0];
  if (price === undefined || first === undefined) return null;
  const name = line.slice(0, first.index).replace(NAME_EDGES, '');
  const weight = found.find((quantity) => quantity.unit === 'weight');
  const weightG = weightWithinBounds(weight ? weight.values.reduce((sum, value) => sum + value, 0) : null);
  const stems = words(name).map(stem);
  const category = categoryOf(stems);
  const estimate = nutrition(name, category, weightG);
  return {
    name,
    description: null,
    category,
    priceRub: price.values[0] ?? null,
    weightG,
    kcal: estimate.kcal,
    proteinG: estimate.proteinG,
    fatG: estimate.fatG,
    carbsG: estimate.carbsG,
    tags: [...estimate.tags, ...keywordTags(stems)],
  };
}

export function parseTextMenu(text: string): ParsedMenuItem[] {
  return finishMenuItems(
    text
      .split(/\r?\n/)
      .map(parseLine)
      .filter((draft) => draft !== null),
  );
}
