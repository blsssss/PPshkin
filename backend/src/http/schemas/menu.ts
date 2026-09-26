import { z } from 'zod';
import type { MenuImport, MenuItem } from '../../domain/models.ts';
import { MENU_CATEGORIES, MENU_IMPORT_STATUSES, NUTRITION_SOURCES, TAGS } from '../../domain/vocabulary.ts';
import { IsoDateTime, iso, isoOrNull } from './common.ts';

const Tags = z.array(z.enum(TAGS));
const Grams = z.number().describe('Граммы на порцию');
const NullableGrams = Grams.nullable();

export const MenuItemSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    category: z.enum(MENU_CATEGORIES),
    priceRub: z.number().int().describe('Цена в рублях'),
    weightG: z.number().int().nullable().describe('Выход порции в граммах'),
    kcal: z.number().int().describe('Калорийность порции'),
    proteinG: NullableGrams,
    fatG: NullableGrams,
    carbsG: NullableGrams,
    nutritionSource: z
      .enum(NUTRITION_SOURCES)
      .describe('venue - калорийность указало заведение, estimate - оценка при распознавании меню'),
    tags: Tags,
    isAvailable: z.boolean().describe('false - позиция скрыта от гостей, но остаётся в меню заведения'),
  })
  .meta({ id: 'MenuItem', description: 'Позиция меню заведения' });

export const ParsedMenuItemSchema = z
  .object({
    name: z.string(),
    description: z.string().nullable(),
    category: z.enum(MENU_CATEGORIES),
    priceRub: z
      .number()
      .int()
      .nullable()
      .describe('Цена из меню; null, если её нет в меню: владелец указывает цену перед применением'),
    weightG: z.number().int().nullable(),
    kcal: z.number().int().describe('Оценка калорийности порции'),
    proteinG: Grams,
    fatG: Grams,
    carbsG: Grams,
    tags: Tags,
  })
  .meta({
    id: 'ParsedMenuItem',
    description: 'Позиция, распознанная в меню. Калорийность и БЖУ оценочные, владелец может их исправить',
  });

export const MenuImportSchema = z
  .object({
    id: z.number().int(),
    source: z.enum(['photo', 'text']),
    status: z
      .enum(MENU_IMPORT_STATUSES)
      .describe(
        'processing - распознаётся, опрашивайте раз в 2 секунды; ready - проверьте позиции и примените; failed - покажите error; applied - позиции уже в меню',
      ),
    items: z.array(ParsedMenuItemSchema),
    error: z.string().nullable().describe('Причина неудачи для показа владельцу как есть'),
    createdAt: IsoDateTime,
    completedAt: IsoDateTime.nullable(),
  })
  .meta({ id: 'MenuImport', description: 'Импорт меню по фото или тексту' });

export const MenuItemListSchema = z.object({ items: z.array(MenuItemSchema) });

const Macro = z.number().min(0).max(1000).nullable().describe('Граммы на порцию, округляются до 0,1');

export const MenuItemBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  category: z.enum(MENU_CATEGORIES),
  priceRub: z.number().int().min(1).max(100_000).describe('Цена в рублях'),
  weightG: z.number().int().min(1).max(5000).nullable().optional().describe('Выход порции в граммах'),
  kcal: z.number().int().min(0).max(5000).describe('Калорийность порции'),
  proteinG: Macro.optional(),
  fatG: Macro.optional(),
  carbsG: Macro.optional(),
  tags: Tags.max(12).optional().describe('Не больше 12, повторы убираются'),
  isAvailable: z.boolean().optional().describe('По умолчанию true'),
});

export const MenuItemPatchBody = MenuItemBody.partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Provide at least one field to change')
  .meta({ minProperties: 1 });

export const MenuImportTextBody = z.object({
  text: z.string().min(1).max(8000).describe('Текст меню: каждая позиция с новой строки, с ценой'),
});

export const ApplyMenuImportBody = z.object({
  items: z
    .array(MenuItemBody.omit({ isAvailable: true }))
    .min(1)
    .max(80)
    .describe('Проверенные владельцем позиции импорта; цена обязательна'),
});

export function toMenuItem(item: MenuItem): z.infer<typeof MenuItemSchema> {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    priceRub: item.priceRub,
    weightG: item.weightG,
    kcal: item.kcal,
    proteinG: item.proteinG,
    fatG: item.fatG,
    carbsG: item.carbsG,
    nutritionSource: item.nutritionSource,
    tags: item.tags,
    isAvailable: item.isAvailable,
  };
}

export function toMenuImport(menuImport: MenuImport): z.infer<typeof MenuImportSchema> {
  return {
    id: menuImport.id,
    source: menuImport.source,
    status: menuImport.status,
    items: menuImport.items.map((item) => ({
      name: item.name,
      description: item.description,
      category: item.category,
      priceRub: item.priceRub,
      weightG: item.weightG,
      kcal: item.kcal,
      proteinG: item.proteinG,
      fatG: item.fatG,
      carbsG: item.carbsG,
      tags: item.tags,
    })),
    error: menuImport.error,
    createdAt: iso(menuImport.createdAt),
    completedAt: isoOrNull(menuImport.completedAt),
  };
}
