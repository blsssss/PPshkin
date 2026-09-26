import { z } from 'zod';
import { DEAL_LIST_FILTERS, DEAL_STATUSES, type DealView } from '../../services/deals.ts';
import { IsoDateTime, iso } from './common.ts';

export const DealSchema = z
  .object({
    id: z.number().int(),
    menuItemId: z.number().int(),
    itemName: z.string(),
    priceRub: z.number().int().describe('Цена по акции в рублях'),
    originalPriceRub: z.number().int().describe('Текущая цена позиции в меню'),
    discountPercent: z.number().int().describe('Скидка в процентах от цены в меню'),
    quantityTotal: z.number().int(),
    quantityLeft: z.number().int(),
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    status: z
      .enum(DEAL_STATUSES)
      .describe(
        'active - продаётся; scheduled - ещё не началась; sold_out - порции закончились; ended - время вышло; cancelled - снята заведением',
      ),
  })
  .meta({
    id: 'Deal',
    description: 'Горящее предложение: позиция меню со скидкой, ограниченным количеством и сроком',
  });

export const DealListSchema = z.object({ items: z.array(DealSchema) });

const DealEnd = z.iso
  .datetime({ offset: true })
  .describe('Окончание акции, ISO 8601: позже текущего момента и не позже чем через 24 часа');

export const DealBody = z.object({
  menuItemId: z.number().int().positive(),
  priceRub: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .describe('Цена по акции в рублях, строго ниже цены позиции в меню'),
  quantity: z.number().int().min(1).max(100).describe('Сколько порций продаётся по акции'),
  endsAt: DealEnd,
});

export const DealPatchBody = z
  .object({
    quantityLeft: z.number().int().min(0).describe('Сколько порций осталось, от 0 до quantityTotal'),
    endsAt: DealEnd,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Provide at least one field to change')
  .meta({ minProperties: 1 });

export const DealListQuery = z.object({
  status: z
    .enum(DEAL_LIST_FILTERS)
    .default('active')
    .describe('active - идущие и запланированные; finished - закончившиеся за последние 7 дней'),
});

function discountPercent(priceRub: number, originalPriceRub: number): number {
  return originalPriceRub > 0 ? Math.round((1 - priceRub / originalPriceRub) * 100) : 0;
}

export function toDeal({ deal, item, status }: DealView): z.infer<typeof DealSchema> {
  return {
    id: deal.id,
    menuItemId: deal.menuItemId,
    itemName: item.name,
    priceRub: deal.priceRub,
    originalPriceRub: item.priceRub,
    discountPercent: discountPercent(deal.priceRub, item.priceRub),
    quantityTotal: deal.quantityTotal,
    quantityLeft: deal.quantityLeft,
    startsAt: iso(deal.startsAt),
    endsAt: iso(deal.endsAt),
    status,
  };
}
