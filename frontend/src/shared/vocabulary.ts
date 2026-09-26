import type { Schemas } from '../api/client.ts';

export type Tag = Schemas['UserProfile']['dislikedTags'][number];
export type MenuCategory = Schemas['MenuItem']['category'];
export type VenueCategory = Schemas['Venue']['category'];
export type MealSlot = Schemas['Meal']['slot'];

export const TAG_LABELS: Record<Tag, string> = {
  sweet: 'сладкое',
  dessert: 'десерт',
  pastry: 'выпечка',
  chocolate: 'шоколад',
  fruit: 'фрукты',
  berries: 'ягоды',
  dairy: 'молочное',
  cheese: 'сыр',
  eggs: 'яйца',
  meat: 'мясо',
  poultry: 'птица',
  fish: 'рыба',
  seafood: 'морепродукты',
  vegetarian: 'вегетарианское',
  vegetables: 'овощи',
  greens: 'зелень',
  salad: 'салат',
  soup: 'суп',
  grain: 'крупы',
  pasta: 'паста',
  rice: 'рис',
  potato: 'картофель',
  bread: 'хлеб',
  fried: 'жареное',
  grilled: 'гриль',
  spicy: 'острое',
  fast_food: 'фастфуд',
  coffee: 'кофе',
  tea: 'чай',
  drink: 'напиток',
  juice: 'сок',
  high_protein: 'много белка',
  light: 'лёгкое',
  hearty: 'сытное',
  breakfast: 'завтрак',
};

export const MENU_CATEGORY_LABELS: Record<MenuCategory, string> = {
  breakfast: 'Завтраки',
  main: 'Горячее',
  soup: 'Супы',
  salad: 'Салаты',
  side: 'Гарниры',
  bakery: 'Выпечка',
  dessert: 'Десерты',
  snack: 'Закуски',
  drink: 'Напитки',
};

export const VENUE_CATEGORY_LABELS: Record<VenueCategory, string> = {
  coffee: 'Кофейня',
  bakery: 'Пекарня',
  cafe: 'Кафе',
  canteen: 'Столовая',
  restaurant: 'Ресторан',
};

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'завтрак',
  lunch: 'обед',
  snack: 'перекус',
  dinner: 'ужин',
};
