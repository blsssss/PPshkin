import type { ParsedMenuItem } from '../domain/models.ts';
import { onlyKnownTags, type MenuCategory } from '../domain/vocabulary.ts';

const MAX_MENU_ITEMS = 80;
export const MAX_KCAL = 5000;

const MENU_NAME_MAX_LENGTH = 120;
const MENU_DESCRIPTION_MAX_LENGTH = 500;
const MAX_PRICE_RUB = 100_000;
const MAX_WEIGHT_G = 5000;
const MIN_STEM_LENGTH = 2;

const ENDINGS =
  'ами ями ого его ому ему ыми ими ей ой ый ий ым им ая яя ое ее ые ие ую юю ом ем ам ям ах ях ов ев ых их ью а я о е ы и у ю ь й'
    .split(' ')
    .sort((left, right) => right.length - left.length);

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length > 0);
}

export function stem(word: string): string {
  const ending = ENDINGS.find(
    (candidate) => word.endsWith(candidate) && word.length - candidate.length >= MIN_STEM_LENGTH,
  );
  return ending === undefined ? word : word.slice(0, -ending.length);
}

export function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function clip(text: string, maxLength: number): string {
  const characters = Array.from(text);
  return characters.length <= maxLength ? text : characters.slice(0, maxLength).join('').trimEnd();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundGrams(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

function integerWithin(value: number | null, min: number, max: number): number | null {
  if (value === null) return null;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : null;
}

const priceWithinBounds = (value: number | null) => integerWithin(value, 0, MAX_PRICE_RUB);
export const weightWithinBounds = (value: number | null) => integerWithin(value, 1, MAX_WEIGHT_G);

export interface MenuItemDraft {
  name: string;
  description: string | null;
  category: MenuCategory;
  priceRub: number | null;
  weightG: number | null;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  tags: readonly string[];
}

function toMenuItem(draft: MenuItemDraft): ParsedMenuItem | null {
  const name = clip(collapseSpaces(draft.name), MENU_NAME_MAX_LENGTH);
  if (name.length === 0) return null;
  const description = clip((draft.description ?? '').trim(), MENU_DESCRIPTION_MAX_LENGTH);
  return {
    name,
    description: description.length > 0 ? description : null,
    category: draft.category,
    priceRub: priceWithinBounds(draft.priceRub),
    weightG: weightWithinBounds(draft.weightG),
    kcal: clamp(Math.round(draft.kcal), 0, MAX_KCAL),
    proteinG: roundGrams(draft.proteinG),
    fatG: roundGrams(draft.fatG),
    carbsG: roundGrams(draft.carbsG),
    tags: onlyKnownTags(draft.tags),
  };
}

export function finishMenuItems(drafts: Iterable<MenuItemDraft>): ParsedMenuItem[] {
  const seen = new Set<string>();
  const items: ParsedMenuItem[] = [];
  for (const draft of drafts) {
    const item = toMenuItem(draft);
    if (item === null || seen.has(item.name.toLowerCase())) continue;
    seen.add(item.name.toLowerCase());
    items.push(item);
    if (items.length === MAX_MENU_ITEMS) break;
  }
  return items;
}
