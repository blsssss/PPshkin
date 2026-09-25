export const TAG_LABELS = {
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
} as const;

export type Tag = keyof typeof TAG_LABELS;
export const TAGS = Object.keys(TAG_LABELS) as Tag[];

export const MENU_CATEGORY_LABELS = {
  breakfast: 'Завтраки',
  main: 'Горячее',
  soup: 'Супы',
  salad: 'Салаты',
  side: 'Гарниры',
  bakery: 'Выпечка',
  dessert: 'Десерты',
  snack: 'Закуски',
  drink: 'Напитки',
} as const;

export type MenuCategory = keyof typeof MENU_CATEGORY_LABELS;
export const MENU_CATEGORIES = Object.keys(MENU_CATEGORY_LABELS) as MenuCategory[];

export const VENUE_CATEGORY_LABELS = {
  coffee: 'Кофейня',
  bakery: 'Пекарня',
  cafe: 'Кафе',
  canteen: 'Столовая',
  restaurant: 'Ресторан',
} as const;

export type VenueCategory = keyof typeof VENUE_CATEGORY_LABELS;
export const VENUE_CATEGORIES = Object.keys(VENUE_CATEGORY_LABELS) as VenueCategory[];

export const MEAL_SLOT_LABELS = {
  breakfast: 'завтрак',
  lunch: 'обед',
  snack: 'перекус',
  dinner: 'ужин',
} as const;

export type MealSlot = keyof typeof MEAL_SLOT_LABELS;
export const MEAL_SLOTS = Object.keys(MEAL_SLOT_LABELS) as MealSlot[];

export const GOALS = ['lose', 'maintain', 'gain'] as const;
export type Goal = (typeof GOALS)[number];

export const MEAL_SOURCES = ['photo', 'text', 'manual', 'booking', 'demo'] as const;
export type MealSource = (typeof MEAL_SOURCES)[number];

export const CONSENT_KINDS = ['personal_data', 'personalized_offers'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const CONSENT_CHANNELS = ['bot', 'miniapp'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

export const NUTRITION_SOURCES = ['venue', 'estimate'] as const;
export type NutritionSource = (typeof NUTRITION_SOURCES)[number];

export const MENU_IMPORT_STATUSES = ['processing', 'ready', 'failed', 'applied'] as const;
export type MenuImportStatus = (typeof MENU_IMPORT_STATUSES)[number];

export const OFFER_CHANNELS = ['bot', 'miniapp', 'push'] as const;
export type OfferChannel = (typeof OFFER_CHANNELS)[number];

export const OFFER_STATUSES = ['shown', 'accepted', 'declined'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const BOOKING_STATUSES = ['active', 'redeemed', 'cancelled', 'expired'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export function isTag(value: string): value is Tag {
  return Object.hasOwn(TAG_LABELS, value);
}

export function onlyKnownTags(values: readonly string[]): Tag[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(isTag))];
}
