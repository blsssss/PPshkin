import { withTransaction, type Pool, type Queryable } from '../db/pool.ts';
import type { MenuItem } from '../domain/models.ts';
import { MENU_CATEGORIES, type MenuCategory, type NutritionSource, type Tag } from '../domain/vocabulary.ts';
import * as deals from '../repositories/deals.ts';
import * as menuItems from '../repositories/menu-items.ts';
import type { Clock } from '../shared/clock.ts';
import { notFound, unprocessable } from '../shared/errors.ts';
import { requireOwnedVenue } from './venues.ts';
import { changedFields, type AuditChannel } from '../domain/audit.ts';
import * as audit from '../repositories/audit.ts';

export interface MenuItemInput {
  name: string;
  description?: string | null;
  category: MenuCategory;
  priceRub: number;
  weightG?: number | null;
  kcal: number;
  proteinG?: number | null;
  fatG?: number | null;
  carbsG?: number | null;
  tags?: Tag[];
  isAvailable?: boolean;
}

export type MenuItemPatch = Partial<MenuItemInput>;

export interface MenuService {
  list(ownerId: number): Promise<MenuItem[]>;
  create(ownerId: number, input: MenuItemInput, channel: AuditChannel): Promise<MenuItem>;
  update(ownerId: number, itemId: number, patch: MenuItemPatch, channel: AuditChannel): Promise<MenuItem>;
  archive(ownerId: number, itemId: number, channel: AuditChannel): Promise<void>;
}

interface MenuDependencies {
  pool: Pool;
  clock: Clock;
}

const collator = new Intl.Collator('ru');

export function byMenuOrder(left: MenuItem, right: MenuItem): number {
  return (
    MENU_CATEGORIES.indexOf(left.category) - MENU_CATEGORIES.indexOf(right.category) ||
    collator.compare(left.name, right.name) ||
    left.id - right.id
  );
}

function roundMacro(grams: number | null | undefined): number | null {
  return grams === null || grams === undefined ? null : Math.round(grams * 10) / 10;
}

function cleanDescription(description: string | null | undefined): string | null {
  const text = description?.trim() ?? '';
  return text === '' ? null : text;
}

export function menuItemFields(
  input: MenuItemInput,
  nutritionSource: NutritionSource,
): menuItems.MenuItemFields {
  return {
    name: input.name.trim(),
    description: cleanDescription(input.description),
    category: input.category,
    priceRub: input.priceRub,
    weightG: input.weightG ?? null,
    kcal: input.kcal,
    proteinG: roundMacro(input.proteinG),
    fatG: roundMacro(input.fatG),
    carbsG: roundMacro(input.carbsG),
    nutritionSource,
    tags: [...new Set(input.tags ?? [])],
    isAvailable: input.isAvailable ?? true,
  };
}

function patchedFields(item: MenuItem, patch: MenuItemPatch): menuItems.MenuItemFields {
  const nutritionChanged = [patch.kcal, patch.proteinG, patch.fatG, patch.carbsG].some(
    (value) => value !== undefined,
  );
  return {
    name: patch.name?.trim() ?? item.name,
    description: patch.description === undefined ? item.description : cleanDescription(patch.description),
    category: patch.category ?? item.category,
    priceRub: patch.priceRub ?? item.priceRub,
    weightG: patch.weightG === undefined ? item.weightG : patch.weightG,
    kcal: patch.kcal ?? item.kcal,
    proteinG: patch.proteinG === undefined ? item.proteinG : roundMacro(patch.proteinG),
    fatG: patch.fatG === undefined ? item.fatG : roundMacro(patch.fatG),
    carbsG: patch.carbsG === undefined ? item.carbsG : roundMacro(patch.carbsG),
    nutritionSource: nutritionChanged ? 'venue' : item.nutritionSource,
    tags: patch.tags ? [...new Set(patch.tags)] : item.tags,
    isAvailable: patch.isAvailable ?? item.isAvailable,
  };
}

export async function lockMenuItem(db: Queryable, venueId: number, itemId: number): Promise<MenuItem> {
  const item = await menuItems.lockOnMenu(db, venueId, itemId);
  if (!item) throw notFound('menu_item_not_found', 'Menu item not found');
  return item;
}

export function createMenuService({ pool, clock }: MenuDependencies): MenuService {
  return {
    async list(ownerId) {
      const venue = await requireOwnedVenue(pool, ownerId);
      return (await menuItems.listOnMenu(pool, venue.id)).sort(byMenuOrder);
    },

    async create(ownerId, input, channel) {
      const venue = await requireOwnedVenue(pool, ownerId);
      return withTransaction(pool, async (client) => {
        const now = clock.now();
        const item = await menuItems.insert(client, venue.id, menuItemFields(input, 'venue'), now);
        await audit.record(
          client,
          {
            venueId: venue.id,
            actorUserId: ownerId,
            action: 'menu_item.create',
            target: { type: 'menu_item', id: item.id },
            channel,
            details: { name: item.name, priceRub: item.priceRub },
          },
          now,
        );
        return item;
      });
    },

    async update(ownerId, itemId, patch, channel) {
      const venue = await requireOwnedVenue(pool, ownerId);
      return withTransaction(pool, async (client) => {
        const item = await lockMenuItem(client, venue.id, itemId);
        const now = clock.now();
        if (patch.priceRub !== undefined) {
          const deal = await deals.findLiveForItem(client, item.id, now);
          if (deal && deal.priceRub >= patch.priceRub) {
            throw unprocessable(
              'deal_price_not_lower',
              `The hot deal on this item sells it for ${deal.priceRub} RUB, keep the price above that or cancel the deal`,
            );
          }
        }
        const updated = await menuItems.update(client, item.id, patchedFields(item, patch), now);
        await audit.record(
          client,
          {
            venueId: venue.id,
            actorUserId: ownerId,
            action: 'menu_item.update',
            target: { type: 'menu_item', id: item.id },
            channel,
            details: {
              fields: changedFields(patch),
              ...(patch.priceRub === undefined ? {} : { priceRub: updated.priceRub }),
            },
          },
          now,
        );
        return updated;
      });
    },

    async archive(ownerId, itemId, channel) {
      const venue = await requireOwnedVenue(pool, ownerId);
      await withTransaction(pool, async (client) => {
        const item = await lockMenuItem(client, venue.id, itemId);
        const now = clock.now();
        await menuItems.archive(client, item.id, now);
        await deals.cancelLiveForItem(client, item.id, now);
        await audit.record(
          client,
          {
            venueId: venue.id,
            actorUserId: ownerId,
            action: 'menu_item.archive',
            target: { type: 'menu_item', id: item.id },
            channel,
            details: { name: item.name },
          },
          now,
        );
      });
    },
  };
}
