import { MEAL_LIMITS } from '../../domain/meals.ts';
import { PROFILE_LIMITS } from '../../domain/profile.ts';
import { DESCRIPTION_MAX_LENGTH } from '../../services/diary.ts';
import { capitalize } from '../texts.ts';

export interface ManualEntry {
  title: string;
  kcal: number;
}

export interface FixInput {
  title?: string;
  kcal: number;
}

export type TextIntent =
  { kind: 'manual'; entry: ManualEntry } | { kind: 'recognize' } | { kind: 'confirm' } | { kind: 'help' };

const MIN_DESCRIPTION_LENGTH = 2;
const MANUAL_ENTRY = /^(.+?)[\s,;:-]+(\d{1,4})\s*(?:ккал|кал|kcal)?\.?$/iu;
const MANUAL_TITLE_MAX_WORDS = 6;
const DECIMAL_TAIL = /\d[.,]\d+\s*(?:ккал|кал|kcal)?\.?$/iu;
const KCAL_ONLY = /^(\d{1,4})\s*(?:ккал|кал|kcal)?\.?$/iu;
const KCAL_TARGET = /^(\d[\d ]{2,5})\s*(?:ккал|кал|kcal)?\.?$/iu;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const TRAILING_SEPARATORS = /[\s,;:.-]+$/u;
const LETTER = /\p{L}/u;

const FOOD_VERBS = new Set(['съел', 'съела', 'поел', 'поела', 'выпил', 'выпила', 'перекусил', 'перекусила']);
const MEAL_PHRASES = new Set(['на завтрак', 'на обед', 'на ужин']);
const SMALL_TALK = new Set(['привет', 'спасибо', 'помощь', 'help', 'меню']);
const FOOD_STEMS = [
  'банан',
  'бизе',
  'блин',
  'борщ',
  'булочк',
  'бургер',
  'бутерброд',
  'вафл',
  'вино',
  'гарнир',
  'гречк',
  'десерт',
  'запеканк',
  'йогурт',
  'капучино',
  'картоф',
  'картош',
  'каш',
  'кекс',
  'кефир',
  'кола',
  'колбас',
  'компот',
  'котлет',
  'кофе',
  'круассан',
  'кури',
  'лазань',
  'лапш',
  'латте',
  'лимонад',
  'липтон',
  'макарон',
  'маффин',
  'молок',
  'морожен',
  'морс',
  'мяс',
  'наггетс',
  'овощ',
  'овсянк',
  'омлет',
  'орех',
  'паст',
  'пельмен',
  'печень',
  'пив',
  'пирог',
  'пирож',
  'пицц',
  'плов',
  'помидор',
  'пюре',
  'рагу',
  'рис',
  'ролл',
  'рыб',
  'салат',
  'сок',
  'солянк',
  'сосиск',
  'стейк',
  'суп',
  'суши',
  'сыр',
  'сэндвич',
  'творог',
  'торт',
  'тост',
  'фри',
  'хлеб',
  'чай',
  'чизкейк',
  'шаурм',
  'шоколад',
  'эклер',
  'яблок',
  'яичниц',
  'яйц',
];

function token(word: string): string {
  return word.toLowerCase().replaceAll('ё', 'е').replace(EDGE_PUNCTUATION, '');
}

function words(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function leadingFoodWords(tokens: readonly string[]): number {
  const [first = '', second = ''] = tokens;
  if (FOOD_VERBS.has(first)) return 1;
  return MEAL_PHRASES.has(`${first} ${second}`) ? 2 : 0;
}

function withoutFoodWords(text: string): string {
  let rest = words(text);
  let skip = leadingFoodWords(rest.map(token));
  while (skip > 0) {
    rest = rest.slice(skip);
    skip = leadingFoodWords(rest.map(token));
  }
  return rest.join(' ').replace(TRAILING_SEPARATORS, '');
}

const isKcal = (value: number) => value >= 1 && value <= MEAL_LIMITS.kcal;

function looksLikeListOfDishes(title: string): boolean {
  return title.includes(',') || words(title).length > MANUAL_TITLE_MAX_WORDS;
}

export function parseManualEntry(text: string): ManualEntry | null {
  if (DECIMAL_TAIL.test(text.trim())) return null;
  const [, rawTitle = '', digits = ''] = MANUAL_ENTRY.exec(text.trim()) ?? [];
  const title = capitalize(withoutFoodWords(rawTitle));
  const kcal = Number(digits);
  if (!isKcal(kcal) || !LETTER.test(title) || title.length > MEAL_LIMITS.titleLength) return null;
  if (looksLikeListOfDishes(title)) return null;
  return { title, kcal };
}

function mentionsFood(tokens: readonly string[]): boolean {
  return tokens.some((word) => FOOD_STEMS.some((stem) => word.startsWith(stem)));
}

export function parseFixInput(text: string): FixInput | null {
  const [, digits] = KCAL_ONLY.exec(text.trim()) ?? [];
  if (digits === undefined) return parseManualEntry(text);
  const kcal = Number(digits);
  return isKcal(kcal) ? { kcal } : null;
}

export function parseKcalTarget(text: string): number | null {
  const [, digits] = KCAL_TARGET.exec(text.trim()) ?? [];
  if (digits === undefined) return null;
  const kcal = Number(digits.replaceAll(' ', ''));
  return kcal >= PROFILE_LIMITS.kcalTargetMin && kcal <= PROFILE_LIMITS.kcalTargetMax ? kcal : null;
}

export function classifyText(text: string): TextIntent {
  const entry = parseManualEntry(text);
  if (entry) return { kind: 'manual', entry };
  const length = text.trim().length;
  if (length < MIN_DESCRIPTION_LENGTH || length > DESCRIPTION_MAX_LENGTH) return { kind: 'help' };
  const tokens = words(text).map(token);
  if (leadingFoodWords(tokens) > 0 || mentionsFood(tokens)) return { kind: 'recognize' };
  if (SMALL_TALK.has(tokens[0] ?? '')) return { kind: 'help' };
  return { kind: 'confirm' };
}
