import { describe, expect, it } from 'vitest';
import { MENU_CATEGORIES } from '../domain/vocabulary.ts';
import { CATEGORY_DEFAULTS, findReferenceDish, REFERENCE_DISHES } from './reference.ts';

describe('findReferenceDish', () => {
  it.each([
    ['съел борщ и кусок хлеба', 'Борщ'],
    ['Круассан с миндалём', 'Круассан с миндалём'],
    ['кусок пиццы маргарита', 'Пицца маргарита (кусок)'],
    ['Салат «Цезарь» с курицей', 'Цезарь с курицей'],
    ['ЛАТТЕ 400 мл', 'Латте'],
    ['выпила чашку чая', 'Чай'],
    ['Цезарь с креветками', 'Цезарь с креветками'],
    ['гречка с курицей', 'Гречка с курицей'],
    ['котлета с пюре', 'Котлета с пюре'],
    ['сёмга', 'Лосось на гриле'],
    ['хлеб и борщ', 'Хлеб (ломтик)'],
    ['выпил кофе', 'Кофе'],
    ['чашка чёрного кофе', 'Кофе'],
    ['кофе с молоком', 'Кофе с молоком'],
  ])('finds %s as %s', (text, name) => {
    expect(findReferenceDish(text)?.name).toBe(name);
  });

  it.each([
    ['кофе латте', 'Латте'],
    ['кофе капучино', 'Капучино'],
    ['кофе раф', 'Раф'],
    ['кофе американо', 'Американо'],
    ['кофе и круассан', 'Круассан'],
  ])('prefers a specific dish over plain coffee in %s', (text, name) => {
    expect(findReferenceDish(text)?.name).toBe(name);
  });

  it.each(['кусок сыра', 'морской коктейль'])('does not mistake %s for a dish sharing a prefix', (text) => {
    expect(['Сырники', 'Морс']).not.toContain(findReferenceDish(text)?.name);
  });

  it.each(['что-то вкусное', '', '   ', '123 456', 'съел кусок'])('finds nothing in %j', (text) => {
    expect(findReferenceDish(text)).toBeNull();
  });

  it('finds every dish by its own name', () => {
    const lost = REFERENCE_DISHES.filter((dish) => findReferenceDish(dish.name) !== dish).map(
      (dish) => dish.name,
    );
    expect(lost).toEqual([]);
  });
});

describe('reference data', () => {
  it('has about sixty dishes with unique capitalised names', () => {
    expect(REFERENCE_DISHES.length).toBeGreaterThanOrEqual(55);
    const names = REFERENCE_DISHES.map((dish) => dish.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name[0]).toBe(name[0]?.toUpperCase());
  });

  it('keeps portions, ranges and macros plausible', () => {
    for (const dish of REFERENCE_DISHES) {
      expect(dish.portionG, dish.name).toBeGreaterThan(0);
      expect(dish.kcalMin, dish.name).toBeGreaterThanOrEqual(0);
      expect(dish.kcalMax, dish.name).toBeGreaterThanOrEqual(dish.kcalMin);
      const energy = 4 * dish.proteinG + 9 * dish.fatG + 4 * dish.carbsG;
      const middle = (dish.kcalMin + dish.kcalMax) / 2;
      expect(Math.abs(energy - middle), dish.name).toBeLessThanOrEqual(Math.max(15, middle * 0.15));
    }
  });

  it('describes every menu category with plausible defaults', () => {
    expect(Object.keys(CATEGORY_DEFAULTS).sort()).toEqual([...MENU_CATEGORIES].sort());
    expect(CATEGORY_DEFAULTS.dessert.tags).toEqual(['sweet', 'dessert']);
    expect(CATEGORY_DEFAULTS.drink.tags).toEqual(['drink']);
    for (const defaults of Object.values(CATEGORY_DEFAULTS)) {
      const energy = 4 * defaults.proteinG + 9 * defaults.fatG + 4 * defaults.carbsG;
      expect(Math.abs(energy - defaults.kcal)).toBeLessThanOrEqual(defaults.kcal * 0.1);
    }
  });
});
