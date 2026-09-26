import { describe, expect, it } from 'vitest';
import { buildDeal, buildMenuItem } from '../../../test/fixtures/domain.ts';
import type { MenuItem } from '../models.ts';
import { dealDiscount, isDessert, SWEET_TAGS } from './dish.ts';

describe('SWEET_TAGS', () => {
  it('lists the tags of sweet dishes', () => {
    expect(SWEET_TAGS).toEqual(['sweet', 'dessert']);
  });
});

describe('isDessert', () => {
  it.each<[string, Partial<MenuItem>, boolean]>([
    ['a sweet tag', { tags: ['dairy', 'sweet'] }, true],
    ['a dessert tag', { tags: ['dessert'] }, true],
    ['the dessert category', { category: 'dessert', tags: [] }, true],
    ['a savoury dish', { category: 'bakery', tags: ['pastry', 'cheese'] }, false],
  ])('recognises %s', (_label, item, expected) => {
    expect(isDessert(buildMenuItem(item))).toBe(expected);
  });
});

describe('dealDiscount', () => {
  it.each([
    ['a regular discount', 200, 150, 0.25],
    ['a free deal', 200, 0, 1],
    ['a deal above the menu price', 200, 250, 0],
    ['a free menu item', 0, 0, 0],
  ])('computes %s', (_label, itemPrice, dealPrice, expected) => {
    expect(dealDiscount(buildMenuItem({ priceRub: itemPrice }), buildDeal({ priceRub: dealPrice }))).toBe(
      expected,
    );
  });
});
