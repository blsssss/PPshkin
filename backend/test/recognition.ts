import sharp from 'sharp';
import {
  ChadGptError,
  type ChadGptClient,
  type ChadGptErrorKind,
  type CompletionRequest,
} from '../src/integrations/chadgpt/client.ts';
import type { DishAnswer, MenuAnswer } from '../src/recognition/schemas.ts';

export type ScriptedStep = string | ChadGptError | DishAnswer | MenuAnswer;

export interface ScriptedClient extends ChadGptClient {
  requests: CompletionRequest[];
}

export function scriptedClient(steps: readonly ScriptedStep[]): ScriptedClient {
  const requests: CompletionRequest[] = [];
  return {
    requests,
    complete(request) {
      requests.push(request);
      const step = steps[requests.length - 1];
      if (step === undefined) return Promise.reject(new Error('unexpected ChadGPT call'));
      if (step instanceof ChadGptError) return Promise.reject(step);
      const content = typeof step === 'string' ? step : JSON.stringify(step);
      return Promise.resolve({ content, model: request.model, requestId: `req-${requests.length}` });
    },
  };
}

export const failure = (kind: ChadGptErrorKind) => new ChadGptError(kind, `simulated ${kind}`);

export async function photo(width = 64, height = 48): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#b0413e' } })
    .jpeg()
    .toBuffer();
}

export const BORSCHT_ANSWER: DishAnswer = {
  is_food: true,
  basis: 'Оценка по виду свекольного супа с овощами, сметаной и укропом в глубокой тарелке.',
  items: [
    {
      name_ru: 'Борщ со сметаной',
      portion_g: 430,
      kcal_min: 250,
      kcal_max: 360,
      protein_g: 10,
      fat_g: 14,
      carbs_g: 28,
      tags: ['soup', 'vegetables', 'dairy', 'russian'],
      confidence: 0.78,
    },
  ],
};

export const TIRAMISU_ANSWER: DishAnswer = {
  is_food: true,
  basis: 'На тарелке порционный кусок тирамису, посыпанный какао.',
  items: [
    {
      name_ru: 'Тирамису',
      portion_g: 150,
      kcal_min: 420,
      kcal_max: 480,
      protein_g: 7,
      fat_g: 28,
      carbs_g: 35,
      tags: ['dessert', 'sweet', 'dairy', 'coffee'],
      confidence: 0.95,
    },
  ],
};

export const CAT_ANSWER: DishAnswer = {
  is_food: false,
  basis: 'На фото серая кошка, еды и напитков не видно.',
  items: [],
};

type MenuAnswerItem = MenuAnswer['items'][number];

const menuItem = (
  name: string,
  category: MenuAnswerItem['category'],
  priceRub: number | null,
  weightG: number | null,
  kcal: number,
  tags: string[],
  description: string | null = null,
): MenuAnswerItem => ({
  name,
  description,
  category,
  price_rub: priceRub,
  weight_g: weightG,
  kcal,
  protein_g: 10,
  fat_g: 12.34,
  carbs_g: 30,
  tags,
});

export const MENU_ANSWER: MenuAnswer = {
  venue_name: 'Кафе «Пушкин и Ко»',
  items: [
    menuItem(
      'Цезарь с курицей',
      'salad',
      490,
      220,
      350,
      ['salad', 'poultry'],
      'романо, куриное филе, пармезан',
    ),
    menuItem('Греческий', 'salad', 390, 200, 250, ['salad', 'vegetables'], 'томаты, огурцы, фета, маслины'),
    menuItem('Борщ с говядиной и сметаной', 'soup', 420, 350, 250, ['soup', 'meat']),
    menuItem('Паста карбонара', 'main', 560, 280, 590, ['pasta', 'meat'], 'бекон, желток, пармезан'),
    menuItem('Котлета из индейки с гречкой', 'main', 520, 330, 510, ['poultry', 'grain']),
    menuItem('Тирамису', 'dessert', 380, 120, 370, ['dessert', 'sweet']),
    menuItem('Сырники со сметаной', 'breakfast', 340, null, 430, ['dairy', 'sweet']),
    menuItem('Чизкейк Нью-Йорк', 'dessert', 410, 130, 400, ['dessert', 'sweet']),
    menuItem('Капучино', 'drink', 220, null, 160, ['drink', 'coffee']),
    menuItem('Морс клюквенный', 'drink', null, null, 160, ['drink', 'berries', 'nuts']),
  ],
};
