import { describe, expect, it } from 'vitest';
import {
  clip,
  collapseSpaces,
  finishMenuItems,
  roundGrams,
  stem,
  words,
  type MenuItemDraft,
} from './normalize.ts';

const draft = (overrides: Partial<MenuItemDraft> = {}): MenuItemDraft => ({
  name: 'Эклер',
  description: null,
  category: 'dessert',
  priceRub: 150,
  weightG: 70,
  kcal: 260,
  proteinG: 4,
  fatG: 15,
  carbsG: 27,
  tags: ['dessert'],
  ...overrides,
});

describe('words and stems', () => {
  it('lowercases, folds ё and splits on everything that is not a letter', () => {
    expect(words('Салат «Цезарь», 250г; ЁЖИК-2')).toEqual(['салат', 'цезарь', 'г', 'ежик']);
  });

  it.each([
    ['пиццы', 'пицца'],
    ['миндалём', 'миндаль'],
    ['курицей', 'курица'],
    ['борща', 'борщ'],
    ['сырниками', 'сырники'],
    ['чая', 'чай'],
    ['цезаря', 'цезарь'],
  ])('gives %s and %s the same stem', (left, right) => {
    expect(stem(words(left)[0]!)).toBe(stem(words(right)[0]!));
  });

  it.each([
    ['сыр', 'сырники'],
    ['морс', 'морской'],
    ['суп', 'супер'],
  ])('keeps %s apart from %s', (left, right) => {
    expect(stem(left)).not.toBe(stem(right));
  });

  it('never shortens a word below two letters', () => {
    expect(stem('щи')).toBe('щи');
    expect(stem('уха')).toBe('ух');
  });
});

describe('text helpers', () => {
  it('collapses repeated whitespace', () => {
    expect(collapseSpaces('  Борщ \n  со   сметаной ')).toBe('Борщ со сметаной');
  });

  it('clips by characters without splitting surrogate pairs', () => {
    expect(clip('Борщ', 10)).toBe('Борщ');
    expect(clip('Борщ со сметаной', 5)).toBe('Борщ');
    const astral = '\u{1d538}';
    expect(clip(astral.repeat(3), 2)).toBe(astral.repeat(2));
  });

  it('rounds grams to one decimal and never below zero', () => {
    expect(roundGrams(12.345)).toBe(12.3);
    expect(roundGrams(-3)).toBe(0);
  });
});

describe('finishMenuItems', () => {
  it('normalises names, descriptions, numbers and tags', () => {
    const [item] = finishMenuItems([
      draft({
        name: '  Эклер   ванильный ',
        description: '  заварное тесто, крем  ',
        priceRub: 149.6,
        weightG: 70.4,
        kcal: 259.5,
        proteinG: 4.26,
        fatG: -1,
        carbsG: 27.04,
        tags: ['Sweet', 'dessert', 'nuts', 'sweet'],
      }),
    ]);
    expect(item).toEqual({
      name: 'Эклер ванильный',
      description: 'заварное тесто, крем',
      category: 'dessert',
      priceRub: 150,
      weightG: 70,
      kcal: 260,
      proteinG: 4.3,
      fatG: 0,
      carbsG: 27,
      tags: ['sweet', 'dessert'],
    });
  });

  it('turns out of range prices and weights into null and clamps calories', () => {
    const items = finishMenuItems([
      draft({ name: 'a', priceRub: -1, weightG: 0, kcal: -20 }),
      draft({ name: 'b', priceRub: 100_001, weightG: 5001, kcal: 7000 }),
      draft({ name: 'c', priceRub: 0, weightG: 1, kcal: 0 }),
      draft({ name: 'd', priceRub: 100_000, weightG: 5000, kcal: 5000 }),
      draft({ name: 'e', priceRub: null, weightG: null }),
    ]);
    expect(items.map(({ priceRub, weightG, kcal }) => [priceRub, weightG, kcal])).toEqual([
      [null, null, 0],
      [null, null, 5000],
      [0, 1, 0],
      [100_000, 5000, 5000],
      [null, null, 260],
    ]);
  });

  it('clips long names and descriptions to the database limits and drops empty ones', () => {
    const [item] = finishMenuItems([
      draft({ name: 'Ш'.repeat(130), description: 'о'.repeat(600) }),
      draft({ name: '   ' }),
    ]);
    expect(item?.name).toHaveLength(120);
    expect(item?.description).toHaveLength(500);
    expect(finishMenuItems([draft({ description: '   ' })])[0]?.description).toBeNull();
    expect(finishMenuItems([draft({ name: ' \n ' })])).toEqual([]);
  });

  it('keeps the first of items with the same name in any case', () => {
    const items = finishMenuItems([
      draft({ priceRub: 150 }),
      draft({ name: 'ЭКЛЕР', priceRub: 170 }),
      draft({ name: 'Круассан' }),
    ]);
    expect(items.map((item) => [item.name, item.priceRub])).toEqual([
      ['Эклер', 150],
      ['Круассан', 150],
    ]);
  });

  it('keeps at most 80 items', () => {
    const items = finishMenuItems(
      Array.from({ length: 95 }, (_, index) => draft({ name: `Блюдо ${index + 1}` })),
    );
    expect(items).toHaveLength(80);
    expect(items.at(-1)?.name).toBe('Блюдо 80');
  });
});
