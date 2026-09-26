import type { Schemas } from '../../api/client.ts';
import type { paths } from '../../api/schema.d.ts';
import type { GeoPoint } from '../../shared/geo/useGeolocation.ts';
import type { MenuCategory, Tag, VenueCategory } from '../../shared/vocabulary.ts';

export type Venue = Schemas['Venue'];
export type MenuItem = Schemas['MenuItem'];
export type MenuImport = Schemas['MenuImport'];
type ParsedMenuItem = Schemas['ParsedMenuItem'];
export type VenueInput = paths['/api/v1/venue']['post']['requestBody']['content']['application/json'];
export type MenuItemInput =
  paths['/api/v1/venue/menu/items']['post']['requestBody']['content']['application/json'];
export type ParsedMenuItemInput =
  paths['/api/v1/venue/menu/imports/{id}/apply']['post']['requestBody']['content']['application/json']['items'][number];

const DEFAULT_OPENS_AT = '08:00';
const DEFAULT_CLOSES_AT = '22:00';
const DEFAULT_TIME_ZONE = 'Europe/Moscow';
export const MAX_ITEM_TAGS = 12;
export const MENU_CATEGORY_ORDER: readonly MenuCategory[] = [
  'breakfast',
  'main',
  'soup',
  'salad',
  'side',
  'bakery',
  'dessert',
  'snack',
  'drink',
];

export interface VenueForm {
  name: string;
  address: string;
  category: VenueCategory | null;
  coordinates: string;
  opensAt: string;
  closesAt: string;
  timezone: string;
}

export type VenueField = keyof VenueForm;

export function emptyVenueForm(): VenueForm {
  return {
    name: '',
    address: '',
    category: null,
    coordinates: '',
    opensAt: DEFAULT_OPENS_AT,
    closesAt: DEFAULT_CLOSES_AT,
    timezone: DEFAULT_TIME_ZONE,
  };
}

export function formatCoordinates(point: GeoPoint): string {
  return `${String(point.lat)}, ${String(point.lon)}`;
}

export function venueFormFrom(venue: Venue): VenueForm {
  return {
    name: venue.name,
    address: venue.address,
    category: venue.category,
    coordinates: formatCoordinates(venue.location),
    opensAt: venue.opensAt,
    closesAt: venue.closesAt,
    timezone: venue.timezone,
  };
}

const NUMBER = /^-?\d{1,3}(\.\d+)?$/;

export function parseCoordinates(text: string): GeoPoint | null {
  const parts = text.trim().split(/\s*[,;]\s*|\s+/);
  if (parts.length !== 2) return null;
  const [latText = '', lonText = ''] = parts;
  if (!NUMBER.test(latText) || !NUMBER.test(lonText)) return null;
  const lat = Number(latText);
  const lon = Number(lonText);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateVenue(form: VenueForm): {
  errors: Partial<Record<VenueField, string>>;
  input: VenueInput | null;
} {
  const errors: Partial<Record<VenueField, string>> = {};
  const name = form.name.trim();
  const address = form.address.trim();
  if (name.length === 0) errors.name = 'Введите название';
  else if (name.length > 120) errors.name = 'Не длиннее 120 символов';
  if (address.length === 0) errors.address = 'Введите адрес';
  else if (address.length > 200) errors.address = 'Не длиннее 200 символов';
  if (form.category === null) errors.category = 'Выберите категорию';
  const location = parseCoordinates(form.coordinates);
  if (form.coordinates.trim().length === 0) errors.coordinates = 'Укажите координаты';
  else if (location === null) errors.coordinates = 'Формат: 55.7963, 49.1088';
  if (!TIME.test(form.opensAt)) errors.opensAt = 'Укажите время в формате ЧЧ:ММ';
  if (!TIME.test(form.closesAt)) errors.closesAt = 'Укажите время в формате ЧЧ:ММ';
  if (Object.keys(errors).length > 0 || form.category === null || location === null) {
    return { errors, input: null };
  }
  return {
    errors,
    input: {
      name,
      address,
      category: form.category,
      location,
      opensAt: form.opensAt,
      closesAt: form.closesAt,
      timezone: form.timezone,
    },
  };
}

export function venuePatch(input: VenueInput, venue: Venue): Partial<VenueInput> {
  const patch: Partial<VenueInput> = {};
  if (input.name !== venue.name) patch.name = input.name;
  if (input.address !== venue.address) patch.address = input.address;
  if (input.category !== venue.category) patch.category = input.category;
  if (input.location.lat !== venue.location.lat || input.location.lon !== venue.location.lon) {
    patch.location = input.location;
  }
  if (input.opensAt !== venue.opensAt) patch.opensAt = input.opensAt;
  if (input.closesAt !== venue.closesAt) patch.closesAt = input.closesAt;
  if (input.timezone !== venue.timezone) patch.timezone = input.timezone;
  return patch;
}

export function venueFieldFromPath(path: string): VenueField | null {
  if (path === 'location' || path.startsWith('location.')) return 'coordinates';
  const fields: readonly VenueField[] = ['name', 'address', 'category', 'opensAt', 'closesAt', 'timezone'];
  return fields.find((field) => field === path) ?? null;
}

export interface ItemForm {
  name: string;
  description: string;
  category: MenuCategory | null;
  priceRub: string;
  weightG: string;
  kcal: string;
  proteinG: string;
  fatG: string;
  carbsG: string;
  tags: Tag[];
  isAvailable: boolean;
}

export type ItemField = keyof ItemForm;
export type ItemErrors = Partial<Record<ItemField, string>>;

function numberText(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',');
}

export function emptyItemForm(): ItemForm {
  return {
    name: '',
    description: '',
    category: null,
    priceRub: '',
    weightG: '',
    kcal: '',
    proteinG: '',
    fatG: '',
    carbsG: '',
    tags: [],
    isAvailable: true,
  };
}

export function itemFormFrom(item: MenuItem | ParsedMenuItem): ItemForm {
  return {
    name: item.name,
    description: item.description ?? '',
    category: item.category,
    priceRub: numberText(item.priceRub),
    weightG: numberText(item.weightG),
    kcal: numberText(item.kcal),
    proteinG: numberText(item.proteinG),
    fatG: numberText(item.fatG),
    carbsG: numberText(item.carbsG),
    tags: [...item.tags],
    isAvailable: 'isAvailable' in item ? item.isAvailable : true,
  };
}

type Parsed = { value: number | null } | { error: string };

function integer(text: string, min: number, max: number, required: boolean, missing: string): Parsed {
  const trimmed = text.trim();
  if (trimmed.length === 0) return required ? { error: missing } : { value: null };
  if (!/^\d+$/.test(trimmed)) return { error: 'Введите целое число' };
  const value = Number(trimmed);
  if (value < min || value > max) return { error: `От ${String(min)} до ${String(max)}` };
  return { value };
}

function decimal(text: string): Parsed {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed.length === 0) return { value: null };
  if (!/^\d+(\.\d)?$/.test(trimmed)) return { error: 'Число, не больше одного знака после запятой' };
  const value = Number(trimmed);
  if (value > 1000) return { error: 'Не больше 1000 г' };
  return { value };
}

export function validateItem(form: ItemForm): { errors: ItemErrors; input: MenuItemInput | null } {
  const errors: ItemErrors = {};
  const name = form.name.trim();
  const description = form.description.trim();
  if (name.length === 0) errors.name = 'Введите название';
  else if (name.length > 120) errors.name = 'Не длиннее 120 символов';
  if (description.length > 500) errors.description = 'Не длиннее 500 символов';
  if (form.category === null) errors.category = 'Выберите категорию';
  if (form.tags.length > MAX_ITEM_TAGS) errors.tags = `Не больше ${String(MAX_ITEM_TAGS)} признаков`;
  const values = {
    priceRub: integer(form.priceRub, 1, 100_000, true, 'Укажите цену'),
    weightG: integer(form.weightG, 1, 5000, false, ''),
    kcal: integer(form.kcal, 0, 5000, true, 'Укажите калорийность'),
    proteinG: decimal(form.proteinG),
    fatG: decimal(form.fatG),
    carbsG: decimal(form.carbsG),
  };
  const numbers: Partial<Record<keyof typeof values, number | null>> = {};
  for (const [field, parsed] of Object.entries(values) as [keyof typeof values, Parsed][]) {
    if ('error' in parsed) errors[field] = parsed.error;
    else numbers[field] = parsed.value;
  }
  const price = numbers.priceRub;
  const kcal = numbers.kcal;
  if (
    Object.keys(errors).length > 0 ||
    form.category === null ||
    price === undefined ||
    price === null ||
    kcal === undefined ||
    kcal === null
  ) {
    return { errors, input: null };
  }
  return {
    errors,
    input: {
      name,
      description: description.length > 0 ? description : null,
      category: form.category,
      priceRub: price,
      weightG: numbers.weightG ?? null,
      kcal,
      proteinG: numbers.proteinG ?? null,
      fatG: numbers.fatG ?? null,
      carbsG: numbers.carbsG ?? null,
      tags: form.tags,
      isAvailable: form.isAvailable,
    },
  };
}

export function itemPatch(input: MenuItemInput, item: MenuItem): Partial<MenuItemInput> {
  const patch: Record<string, unknown> = {};
  const current: Record<string, unknown> = { ...item };
  for (const [key, value] of Object.entries(input)) {
    const before = current[key];
    const same = Array.isArray(value)
      ? Array.isArray(before) &&
        value.length === before.length &&
        value.every((entry, index) => entry === before[index])
      : (value ?? null) === (before ?? null);
    if (!same) patch[key] = value;
  }
  return patch;
}

export function itemFieldFromPath(path: string): ItemField | null {
  const field = path.split('.')[0] ?? '';
  const fields: readonly ItemField[] = [
    'name',
    'description',
    'category',
    'priceRub',
    'weightG',
    'kcal',
    'proteinG',
    'fatG',
    'carbsG',
    'tags',
    'isAvailable',
  ];
  return fields.find((entry) => entry === field) ?? null;
}

export function groupMenu(items: readonly MenuItem[]): { category: MenuCategory; items: MenuItem[] }[] {
  return MENU_CATEGORY_ORDER.map((category) => ({
    category,
    items: items.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replaceAll('ё', 'е');
}
