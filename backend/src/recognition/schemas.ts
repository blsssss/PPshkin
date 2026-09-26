import { z } from 'zod';
import { MENU_CATEGORIES, TAGS } from '../domain/vocabulary.ts';
import type { JsonSchema } from '../integrations/chadgpt/client.ts';

export interface ResponseFormat<T> {
  schemaName: string;
  schema: JsonSchema;
  parser: z.ZodType<T>;
}

type Property = Readonly<Record<string, unknown>>;

const nullable = (type: 'string' | 'number'): Property => ({ type: [type, 'null'] });

function strictObject(properties: Readonly<Record<string, Property>>): Property {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}

const tagList: Property = { type: 'array', items: { type: 'string', enum: TAGS } };

const DishAnswerSchema = z.object({
  is_food: z.boolean(),
  basis: z.string(),
  items: z.array(
    z.object({
      name_ru: z.string(),
      portion_g: z.number().nullable(),
      kcal_min: z.number(),
      kcal_max: z.number(),
      protein_g: z.number(),
      fat_g: z.number(),
      carbs_g: z.number(),
      tags: z.array(z.string()),
      confidence: z.number(),
    }),
  ),
});

export type DishAnswer = z.infer<typeof DishAnswerSchema>;

export const DISH_ESTIMATE_FORMAT: ResponseFormat<DishAnswer> = {
  schemaName: 'dish_estimate',
  schema: strictObject({
    is_food: { type: 'boolean' },
    basis: { type: 'string' },
    items: {
      type: 'array',
      items: strictObject({
        name_ru: { type: 'string' },
        portion_g: nullable('number'),
        kcal_min: { type: 'number' },
        kcal_max: { type: 'number' },
        protein_g: { type: 'number' },
        fat_g: { type: 'number' },
        carbs_g: { type: 'number' },
        tags: tagList,
        confidence: { type: 'number' },
      }),
    },
  }),
  parser: DishAnswerSchema,
};

const MenuAnswerSchema = z.object({
  venue_name: z.string().nullable(),
  items: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      category: z.enum(MENU_CATEGORIES),
      price_rub: z.number().nullable(),
      weight_g: z.number().nullable(),
      kcal: z.number(),
      protein_g: z.number(),
      fat_g: z.number(),
      carbs_g: z.number(),
      tags: z.array(z.string()),
    }),
  ),
});

export type MenuAnswer = z.infer<typeof MenuAnswerSchema>;

export const MENU_ITEMS_FORMAT: ResponseFormat<MenuAnswer> = {
  schemaName: 'menu_items',
  schema: strictObject({
    venue_name: nullable('string'),
    items: {
      type: 'array',
      items: strictObject({
        name: { type: 'string' },
        description: nullable('string'),
        category: { type: 'string', enum: MENU_CATEGORIES },
        price_rub: nullable('number'),
        weight_g: nullable('number'),
        kcal: { type: 'number' },
        protein_g: { type: 'number' },
        fat_g: { type: 'number' },
        carbs_g: { type: 'number' },
        tags: tagList,
      }),
    },
  }),
  parser: MenuAnswerSchema,
};

function jsonObjectText(content: string): string | null {
  const unfenced = content.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : null;
}

export function readAnswer<T>(content: string, format: ResponseFormat<T>): T | null {
  const text = jsonObjectText(content);
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = format.parser.safeParse(json);
  return parsed.success ? parsed.data : null;
}
