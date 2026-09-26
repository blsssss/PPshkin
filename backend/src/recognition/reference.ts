import type { MenuCategory, Tag } from '../domain/vocabulary.ts';
import { stem, words } from './normalize.ts';

export interface ReferenceDish {
  name: string;
  aliases: readonly string[];
  category: MenuCategory;
  portionG: number;
  kcalMin: number;
  kcalMax: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  tags: readonly Tag[];
}

type ReferenceRow = readonly [
  name: string,
  aliases: readonly string[],
  category: MenuCategory,
  portionG: number,
  kcal: readonly [min: number, max: number],
  macros: readonly [proteinG: number, fatG: number, carbsG: number],
  tags: readonly Tag[],
];

const REFERENCE_ROWS: readonly ReferenceRow[] = [
  ['Борщ', [], 'soup', 300, [180, 280], [8, 11, 22], ['soup', 'vegetables', 'meat']],
  ['Солянка', ['сборная солянка'], 'soup', 300, [220, 320], [14, 17, 10], ['soup', 'meat', 'hearty']],
  [
    'Куриный суп',
    ['суп с курицей', 'куриная лапша', 'суп с лапшой'],
    'soup',
    300,
    [120, 200],
    [10, 5, 16],
    ['soup', 'poultry', 'light'],
  ],
  ['Грибной суп', ['суп с грибами'], 'soup', 300, [150, 250], [5, 11, 18], ['soup', 'vegetarian']],
  ['Уха', ['рыбный суп'], 'soup', 300, [150, 230], [16, 7, 14], ['soup', 'fish']],
  ['Том ям', [], 'soup', 350, [200, 320], [16, 14, 16], ['soup', 'seafood', 'spicy']],
  ['Цезарь с курицей', ['цезарь'], 'salad', 250, [330, 460], [22, 26, 16], ['salad', 'poultry', 'cheese']],
  ['Цезарь с креветками', [], 'salad', 250, [300, 420], [18, 24, 14], ['salad', 'seafood', 'cheese']],
  ['Оливье', [], 'salad', 200, [330, 440], [10, 30, 16], ['salad', 'eggs', 'potato']],
  [
    'Греческий салат',
    ['греческий'],
    'salad',
    200,
    [180, 260],
    [6, 18, 9],
    ['salad', 'vegetables', 'cheese', 'vegetarian', 'light'],
  ],
  ['Винегрет', [], 'salad', 200, [150, 220], [3, 10, 20], ['salad', 'vegetables', 'vegetarian']],
  [
    'Салат из свежих овощей',
    ['овощной салат', 'салат из овощей'],
    'salad',
    200,
    [90, 150],
    [2, 9, 8],
    ['salad', 'vegetables', 'vegetarian', 'light'],
  ],
  ['Плов', [], 'main', 300, [480, 620], [18, 24, 62], ['rice', 'meat', 'hearty']],
  ['Пельмени', [], 'main', 250, [520, 650], [25, 28, 55], ['meat', 'hearty']],
  [
    'Паста карбонара',
    ['карбонара'],
    'main',
    300,
    [550, 720],
    [24, 30, 64],
    ['pasta', 'meat', 'eggs', 'cheese', 'hearty'],
  ],
  ['Паста болоньезе', ['болоньезе'], 'main', 300, [480, 620], [24, 18, 70], ['pasta', 'meat']],
  ['Паста с курицей', [], 'main', 300, [500, 650], [30, 22, 58], ['pasta', 'poultry']],
  [
    'Гречка с курицей',
    ['гречневая каша с курицей'],
    'main',
    300,
    [380, 480],
    [32, 10, 50],
    ['grain', 'poultry', 'high_protein'],
  ],
  [
    'Котлета с пюре',
    ['котлета с картофельным пюре'],
    'main',
    300,
    [450, 580],
    [22, 28, 38],
    ['meat', 'potato', 'hearty'],
  ],
  [
    'Куриная грудка',
    ['курица гриль', 'куриное филе'],
    'main',
    150,
    [200, 260],
    [40, 6, 1],
    ['poultry', 'grilled', 'high_protein', 'light'],
  ],
  ['Стейк из говядины', ['рибай'], 'main', 200, [450, 560], [50, 32, 0], ['meat', 'grilled', 'high_protein']],
  [
    'Лосось на гриле',
    ['лосось', 'стейк из лосося', 'семга'],
    'main',
    180,
    [330, 420],
    [36, 24, 0],
    ['fish', 'grilled', 'high_protein'],
  ],
  ['Шаурма', ['шаверма'], 'main', 350, [600, 800], [32, 36, 58], ['fast_food', 'poultry', 'hearty']],
  [
    'Бургер',
    ['гамбургер', 'чизбургер'],
    'main',
    250,
    [550, 720],
    [30, 34, 48],
    ['fast_food', 'meat', 'bread', 'hearty'],
  ],
  ['Пицца (кусок)', [], 'main', 120, [270, 350], [12, 12, 35], ['bread', 'cheese']],
  ['Пицца маргарита (кусок)', [], 'main', 120, [260, 330], [12, 11, 36], ['bread', 'cheese', 'vegetarian']],
  ['Сэндвич с курицей', ['сэндвич', 'сендвич'], 'snack', 220, [400, 520], [24, 20, 44], ['bread', 'poultry']],
  [
    'Картофель фри',
    ['картошка фри', 'фри'],
    'side',
    150,
    [400, 480],
    [5, 22, 55],
    ['potato', 'fried', 'fast_food'],
  ],
  ['Картофельное пюре', ['пюре'], 'side', 200, [180, 240], [4, 8, 30], ['potato', 'dairy']],
  ['Рис', ['рис отварной'], 'side', 150, [170, 210], [4, 1, 41], ['rice', 'vegetarian']],
  ['Гречка', ['гречневая каша'], 'side', 150, [160, 200], [6, 2, 33], ['grain', 'vegetarian']],
  ['Сырники', [], 'breakfast', 180, [380, 480], [22, 20, 38], ['dairy', 'sweet', 'breakfast']],
  ['Овсянка', ['овсяная каша'], 'breakfast', 250, [220, 300], [8, 7, 40], ['grain', 'dairy', 'breakfast']],
  ['Омлет', [], 'breakfast', 180, [250, 330], [18, 22, 3], ['eggs', 'breakfast', 'high_protein']],
  ['Яичница', ['глазунья'], 'breakfast', 150, [220, 290], [14, 20, 2], ['eggs', 'fried', 'breakfast']],
  ['Блины', ['блинчики'], 'breakfast', 200, [380, 480], [12, 16, 58], ['pastry', 'breakfast']],
  ['Панкейки', [], 'breakfast', 180, [400, 500], [11, 14, 68], ['sweet', 'breakfast']],
  [
    'Гранола с йогуртом',
    ['гранола'],
    'breakfast',
    200,
    [300, 400],
    [10, 12, 48],
    ['dairy', 'grain', 'breakfast'],
  ],
  [
    'Тост с авокадо',
    [],
    'breakfast',
    150,
    [280, 360],
    [8, 18, 30],
    ['bread', 'vegetables', 'vegetarian', 'breakfast'],
  ],
  ['Круассан', [], 'bakery', 70, [260, 310], [5, 16, 30], ['pastry']],
  [
    'Круассан с миндалём',
    ['миндальный круассан'],
    'bakery',
    95,
    [400, 470],
    [9, 25, 43],
    ['pastry', 'sweet'],
  ],
  ['Круассан с ветчиной и сыром', [], 'bakery', 130, [380, 460], [15, 24, 34], ['pastry', 'meat', 'cheese']],
  ['Булочка с корицей', ['синнабон'], 'bakery', 100, [330, 400], [6, 14, 52], ['pastry', 'sweet']],
  [
    'Пирожок с капустой',
    ['пирожки с капустой'],
    'bakery',
    90,
    [200, 260],
    [6, 7, 35],
    ['pastry', 'vegetables'],
  ],
  ['Маффин', ['кекс'], 'bakery', 100, [350, 420], [6, 18, 48], ['pastry', 'sweet']],
  ['Хлеб (ломтик)', [], 'bakery', 30, [70, 85], [2.5, 1, 15], ['bread']],
  ['Эклер', [], 'dessert', 70, [230, 290], [4, 15, 27], ['dessert', 'sweet', 'pastry']],
  ['Чизкейк', [], 'dessert', 120, [380, 460], [7, 30, 28], ['dessert', 'sweet', 'dairy', 'cheese']],
  ['Тирамису', [], 'dessert', 150, [380, 480], [7, 28, 38], ['dessert', 'sweet', 'dairy', 'coffee']],
  ['Медовик', [], 'dessert', 120, [400, 480], [6, 20, 58], ['dessert', 'sweet']],
  ['Наполеон', [], 'dessert', 120, [400, 490], [6, 26, 45], ['dessert', 'sweet', 'pastry']],
  ['Шоколадный торт', [], 'dessert', 120, [420, 520], [6, 26, 52], ['dessert', 'sweet', 'chocolate']],
  [
    'Мороженое',
    ['пломбир', 'джелато'],
    'dessert',
    100,
    [200, 260],
    [4, 13, 24],
    ['dessert', 'sweet', 'dairy'],
  ],
  ['Капучино', [], 'drink', 250, [110, 150], [6, 6, 10], ['coffee', 'drink', 'dairy']],
  ['Латте', [], 'drink', 350, [150, 210], [9, 8, 14], ['coffee', 'drink', 'dairy']],
  ['Раф', [], 'drink', 300, [280, 380], [6, 22, 26], ['coffee', 'drink', 'dairy', 'sweet']],
  ['Флэт уайт', ['флет уайт'], 'drink', 200, [100, 140], [6, 6, 9], ['coffee', 'drink', 'dairy']],
  ['Американо', [], 'drink', 250, [5, 15], [0.5, 0.1, 1.5], ['coffee', 'drink', 'light']],
  ['Кофе', ['черный кофе'], 'drink', 200, [5, 15], [0.5, 0.1, 1.5], ['coffee', 'drink', 'light']],
  ['Кофе с молоком', [], 'drink', 250, [40, 70], [2.5, 2.5, 4], ['coffee', 'drink', 'dairy']],
  [
    'Какао',
    ['горячий шоколад'],
    'drink',
    250,
    [170, 230],
    [7, 7, 26],
    ['drink', 'dairy', 'sweet', 'chocolate'],
  ],
  ['Чай', [], 'drink', 250, [0, 10], [0, 0, 1], ['tea', 'drink', 'light']],
  ['Морс', [], 'drink', 300, [100, 150], [0.2, 0, 30], ['drink', 'berries']],
  ['Лимонад', [], 'drink', 400, [140, 200], [0, 0, 42], ['drink', 'sweet']],
  ['Смузи', [], 'drink', 300, [150, 220], [3, 1, 40], ['drink', 'fruit', 'light']],
  [
    'Апельсиновый сок',
    ['сок', 'свежевыжатый сок'],
    'drink',
    250,
    [100, 130],
    [1.5, 0.3, 26],
    ['drink', 'juice', 'fruit'],
  ],
];

export const REFERENCE_DISHES: readonly ReferenceDish[] = REFERENCE_ROWS.map(
  ([name, aliases, category, portionG, [kcalMin, kcalMax], [proteinG, fatG, carbsG], tags]) => ({
    name,
    aliases,
    category,
    portionG,
    kcalMin,
    kcalMax,
    proteinG,
    fatG,
    carbsG,
    tags,
  }),
);

export const CATEGORY_DEFAULTS: Record<
  MenuCategory,
  { kcal: number; proteinG: number; fatG: number; carbsG: number; tags: readonly Tag[] }
> = {
  breakfast: { kcal: 350, proteinG: 14, fatG: 14, carbsG: 42, tags: ['breakfast'] },
  main: { kcal: 500, proteinG: 28, fatG: 22, carbsG: 45, tags: ['hearty'] },
  soup: { kcal: 220, proteinG: 9, fatG: 10, carbsG: 22, tags: ['soup'] },
  salad: { kcal: 250, proteinG: 8, fatG: 18, carbsG: 12, tags: ['salad'] },
  side: { kcal: 200, proteinG: 5, fatG: 6, carbsG: 32, tags: [] },
  bakery: { kcal: 330, proteinG: 7, fatG: 16, carbsG: 40, tags: ['pastry'] },
  dessert: { kcal: 380, proteinG: 5, fatG: 20, carbsG: 45, tags: ['sweet', 'dessert'] },
  snack: { kcal: 280, proteinG: 8, fatG: 14, carbsG: 30, tags: [] },
  drink: { kcal: 120, proteinG: 3, fatG: 3, carbsG: 18, tags: ['drink'] },
};

const MIN_SIGNIFICANT_LENGTH = 3;
const GENERIC_STEMS: ReadonlySet<string> = new Set(['кофе'].map(stem));
const FILLER_STEMS: ReadonlySet<string> = new Set(
  [
    'съел',
    'выпил',
    'кусок',
    'куска',
    'кусочек',
    'кусочка',
    'порция',
    'тарелка',
    'стакан',
    'чашка',
    'ломтик',
  ].map(stem),
);

function significantStems(text: string): string[] {
  return words(text)
    .filter((word) => word.length >= MIN_SIGNIFICANT_LENGTH)
    .map(stem)
    .filter((wordStem) => !FILLER_STEMS.has(wordStem));
}

interface DishMatcher {
  dish: ReferenceDish;
  variants: string[][];
}

const MATCHERS: readonly DishMatcher[] = REFERENCE_DISHES.map((dish) => ({
  dish,
  variants: [dish.name, ...dish.aliases]
    .map((variant) => [...new Set(significantStems(variant))])
    .filter((variant) => variant.length > 0),
}));

interface Candidate {
  dish: ReferenceDish;
  specificStems: number;
  position: number;
}

function isBetter(candidate: Candidate, best: Candidate | null): boolean {
  if (best === null) return true;
  if (candidate.specificStems !== best.specificStems) return candidate.specificStems > best.specificStems;
  return candidate.position < best.position;
}

export function findReferenceDish(text: string): ReferenceDish | null {
  const textStems = significantStems(text);
  let best: Candidate | null = null;
  for (const { dish, variants } of MATCHERS) {
    for (const variant of variants) {
      if (!variant.every((variantStem) => textStems.includes(variantStem))) continue;
      const candidate = {
        dish,
        specificStems: variant.filter((variantStem) => !GENERIC_STEMS.has(variantStem)).length,
        position: Math.min(...variant.map((variantStem) => textStems.indexOf(variantStem))),
      };
      if (isBetter(candidate, best)) best = candidate;
    }
  }
  return best?.dish ?? null;
}
