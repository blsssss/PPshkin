import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { BORSCHT_ANSWER, CAT_ANSWER, MENU_ANSWER, TIRAMISU_ANSWER } from '../../test/recognition.ts';
import { MENU_CATEGORIES, TAGS } from '../domain/vocabulary.ts';
import { DISH_ESTIMATE_FORMAT, MENU_ITEMS_FORMAT, readAnswer, type ResponseFormat } from './schemas.ts';

type Node = Record<string, unknown>;

function objectNodes(node: unknown): Node[] {
  if (typeof node !== 'object' || node === null) return [];
  const record = node as Node;
  const nested = Object.values(record).flatMap(objectNodes);
  return record.type === 'object' ? [record, ...nested] : nested;
}

const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });

function agree(format: ResponseFormat<unknown>, sample: unknown) {
  const byJsonSchema = ajv.validate(format.schema, sample);
  const byZod = format.parser.safeParse(sample).success;
  return { byJsonSchema, byZod };
}

const borschtItem = BORSCHT_ANSWER.items[0]!;
const menuItem = MENU_ANSWER.items[0]!;

describe('strict response schemas', () => {
  it.each([DISH_ESTIMATE_FORMAT, MENU_ITEMS_FORMAT])(
    '$schemaName follows the strict mode rules',
    (format) => {
      const objects = objectNodes(format.schema);
      expect(objects.length).toBe(2);
      for (const object of objects) {
        expect(object.additionalProperties).toBe(false);
        expect(object.required).toEqual(Object.keys(object.properties as Node));
      }
      expect(ajv.validateSchema(format.schema)).toBe(true);
    },
  );

  it('builds the enums from the shared vocabulary', () => {
    const dishItem = (DISH_ESTIMATE_FORMAT.schema.properties as Node).items as Node;
    const dishTags = ((dishItem.items as Node).properties as Node).tags as Node;
    expect(dishTags).toEqual({ type: 'array', items: { type: 'string', enum: TAGS } });
    const menuProperties = (((MENU_ITEMS_FORMAT.schema.properties as Node).items as Node).items as Node)
      .properties as Node;
    expect(menuProperties.category).toEqual({ type: 'string', enum: MENU_CATEGORIES });
    expect(menuProperties.price_rub).toEqual({ type: ['number', 'null'] });
  });

  it.each([
    ['borscht', BORSCHT_ANSWER],
    ['tiramisu', TIRAMISU_ANSWER],
    ['cat', CAT_ANSWER],
    ['unknown portion', { ...TIRAMISU_ANSWER, items: [{ ...TIRAMISU_ANSWER.items[0]!, portion_g: null }] }],
  ])('accepts the %s dish answer in both schemas', (_name, sample) => {
    const { byZod } = agree(DISH_ESTIMATE_FORMAT, sample);
    expect(byZod).toBe(true);
    const strictSample = { ...sample, items: sample.items.map((item) => ({ ...item, tags: ['soup'] })) };
    expect(agree(DISH_ESTIMATE_FORMAT, strictSample)).toEqual({ byJsonSchema: true, byZod: true });
  });

  it.each([
    ['a missing field', { is_food: true, items: [] }],
    [
      'a string instead of a number',
      { ...BORSCHT_ANSWER, items: [{ ...borschtItem, kcal_min: '250', tags: [] }] },
    ],
    [
      'a null that is not allowed',
      { ...BORSCHT_ANSWER, items: [{ ...borschtItem, confidence: null, tags: [] }] },
    ],
    ['items that are not a list', { ...BORSCHT_ANSWER, items: {} }],
  ])('rejects a dish answer with %s in both schemas', (_name, sample) => {
    expect(agree(DISH_ESTIMATE_FORMAT, sample)).toEqual({ byJsonSchema: false, byZod: false });
  });

  it('accepts the menu answer and rejects a category outside the vocabulary in both schemas', () => {
    const strictMenu = { ...MENU_ANSWER, items: MENU_ANSWER.items.map((item) => ({ ...item, tags: [] })) };
    expect(agree(MENU_ITEMS_FORMAT, strictMenu)).toEqual({ byJsonSchema: true, byZod: true });
    const noVenue = { ...strictMenu, venue_name: null };
    expect(agree(MENU_ITEMS_FORMAT, noVenue)).toEqual({ byJsonSchema: true, byZod: true });
    const wrongCategory = { venue_name: null, items: [{ ...menuItem, category: 'pizza', tags: [] }] };
    expect(agree(MENU_ITEMS_FORMAT, wrongCategory)).toEqual({ byJsonSchema: false, byZod: false });
    const missingPrice = { venue_name: null, items: [{ ...menuItem, price_rub: undefined, tags: [] }] };
    expect(agree(MENU_ITEMS_FORMAT, missingPrice)).toEqual({ byJsonSchema: false, byZod: false });
  });

  it('lets unknown tags through validation so they can be dropped later', () => {
    expect(DISH_ESTIMATE_FORMAT.parser.safeParse(BORSCHT_ANSWER).success).toBe(true);
    expect(ajv.validate(DISH_ESTIMATE_FORMAT.schema, BORSCHT_ANSWER)).toBe(false);
  });
});

describe('readAnswer', () => {
  const json = JSON.stringify(CAT_ANSWER);

  it.each([
    ['bare JSON', json],
    ['JSON in a json fence', `\`\`\`json\n${json}\n\`\`\``],
    ['JSON in a plain fence', `\`\`\`\n${json}\n\`\`\``],
    ['JSON surrounded by words', `Вот ответ: ${json} Готово.`],
  ])('reads %s', (_name, content) => {
    expect(readAnswer(content, DISH_ESTIMATE_FORMAT)).toEqual(CAT_ANSWER);
  });

  it.each([
    ['plain text', 'Это борщ'],
    ['an empty string', ''],
    ['a closing brace before the opening one', '} {'],
    ['broken JSON', '{"is_food": true, "items": [}'],
    ['JSON of another shape', '{"answer": "борщ"}'],
    ['a JSON array', '[{"is_food": false}]'],
  ])('rejects %s', (_name, content) => {
    expect(readAnswer(content, DISH_ESTIMATE_FORMAT)).toBeNull();
  });
});
