import type { Deal, MenuItem } from '../models.ts';
import type { Tag } from '../vocabulary.ts';

export const SWEET_TAGS: readonly Tag[] = ['sweet', 'dessert'];

export function isDessert(item: MenuItem): boolean {
  return item.category === 'dessert' || item.tags.some((tag) => SWEET_TAGS.includes(tag));
}

export function dealDiscount(item: MenuItem, deal: Deal): number {
  return item.priceRub > 0 ? Math.max(0, 1 - deal.priceRub / item.priceRub) : 0;
}
