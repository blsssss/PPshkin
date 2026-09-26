import { describe, expect, it } from 'vitest';
import { sampleDeal, sampleMenuItem } from '../../../test/venues.ts';
import { toDeal } from './deals.ts';

const dealFor = (priceRub: number, menuPriceRub: number) =>
  toDeal({
    deal: { ...sampleDeal, priceRub },
    item: { ...sampleMenuItem, priceRub: menuPriceRub },
    status: 'active',
  });

describe('toDeal', () => {
  it('takes the item name and the current menu price from the item', () => {
    expect(dealFor(130, 200)).toEqual({
      id: sampleDeal.id,
      menuItemId: sampleMenuItem.id,
      itemName: 'Эклер',
      priceRub: 130,
      originalPriceRub: 200,
      discountPercent: 35,
      quantityTotal: 5,
      quantityLeft: 3,
      startsAt: '2026-09-25T09:00:00.000Z',
      endsAt: '2026-09-25T11:00:00.000Z',
      status: 'active',
    });
  });

  it('rounds the discount to whole percents', () => {
    expect(dealFor(199, 300).discountPercent).toBe(34);
    expect(dealFor(1, 3).discountPercent).toBe(67);
    expect(dealFor(0, 0).discountPercent).toBe(0);
  });
});
