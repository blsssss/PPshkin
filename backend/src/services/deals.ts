import { withTransaction, type Pool, type Queryable } from '../db/pool.ts';
import type { Deal, MenuItem } from '../domain/models.ts';
import * as deals from '../repositories/deals.ts';
import * as menuItems from '../repositories/menu-items.ts';
import type { Clock } from '../shared/clock.ts';
import { conflict, notFound, unprocessable } from '../shared/errors.ts';
import { lockMenuItem } from './menu.ts';
import { requireOwnedVenue } from './venues.ts';

export const DEAL_STATUSES = ['scheduled', 'active', 'sold_out', 'ended', 'cancelled'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const DEAL_LIST_FILTERS = ['active', 'finished'] as const;
export type DealListFilter = (typeof DEAL_LIST_FILTERS)[number];

export interface DealView {
  deal: Deal;
  item: MenuItem;
  status: DealStatus;
}

export interface DealInput {
  menuItemId: number;
  priceRub: number;
  quantity: number;
  endsAt: Date;
}

export interface DealPatch {
  quantityLeft?: number;
  endsAt?: Date;
}

export interface DealsService {
  list(ownerId: number, status: DealListFilter): Promise<DealView[]>;
  create(ownerId: number, input: DealInput): Promise<DealView>;
  update(ownerId: number, dealId: number, patch: DealPatch): Promise<DealView>;
  cancel(ownerId: number, dealId: number): Promise<void>;
}

interface DealsDependencies {
  pool: Pool;
  clock: Clock;
}

const HOUR_MS = 3_600_000;
const MAX_DEAL_WINDOW_MS = 24 * HOUR_MS;
const FINISHED_HISTORY_MS = 7 * 24 * HOUR_MS;

export function dealStatus(deal: Deal, now: Date): DealStatus {
  if (deal.cancelledAt) return 'cancelled';
  if (deal.quantityLeft === 0) return 'sold_out';
  if (deal.endsAt <= now) return 'ended';
  if (deal.startsAt > now) return 'scheduled';
  return 'active';
}

export async function dealViews(db: Queryable, list: readonly Deal[], now: Date): Promise<DealView[]> {
  const itemIds = [...new Set(list.map((deal) => deal.menuItemId))];
  const items = new Map((await menuItems.findByIds(db, itemIds)).map((item) => [item.id, item]));
  return list.map((deal) => {
    const item = items.get(deal.menuItemId);
    if (!item) throw new Error(`Deal ${deal.id} refers to a missing menu item`);
    return { deal, item, status: dealStatus(deal, now) };
  });
}

function dealNotFound() {
  return notFound('deal_not_found', 'Deal not found');
}

function assertWindow(endsAt: Date, now: Date, startsAt: Date = now): void {
  const end = endsAt.getTime();
  if (end <= Math.max(now.getTime(), startsAt.getTime()) || end > now.getTime() + MAX_DEAL_WINDOW_MS) {
    throw unprocessable('deal_window_invalid', 'The deal must end in the future and within 24 hours');
  }
}

function assertSellable(item: MenuItem, priceRub: number): void {
  if (!item.isAvailable) {
    throw unprocessable('menu_item_unavailable', 'The item is hidden from guests, make it available first');
  }
  if (priceRub >= item.priceRub) {
    throw unprocessable(
      'deal_price_not_lower',
      `The deal price must be lower than the menu price of ${item.priceRub} RUB`,
    );
  }
}

function dealExists() {
  return conflict('deal_exists', 'This item already has a live hot deal, change or cancel it instead');
}

export function createDealsService({ pool, clock }: DealsDependencies): DealsService {
  return {
    async list(ownerId, status) {
      const venue = await requireOwnedVenue(pool, ownerId);
      const now = clock.now();
      const found =
        status === 'active'
          ? await deals.listLive(pool, venue.id, now)
          : await deals.listFinished(pool, venue.id, now, new Date(now.getTime() - FINISHED_HISTORY_MS));
      return dealViews(pool, found, now);
    },

    async create(ownerId, input) {
      const venue = await requireOwnedVenue(pool, ownerId);
      return withTransaction(pool, async (client) => {
        const item = await lockMenuItem(client, venue.id, input.menuItemId);
        assertSellable(item, input.priceRub);
        const now = clock.now();
        assertWindow(input.endsAt, now);
        if (await deals.findLiveForItem(client, item.id, now)) throw dealExists();
        const deal = await deals.insert(
          client,
          {
            venueId: venue.id,
            menuItemId: item.id,
            priceRub: input.priceRub,
            quantity: input.quantity,
            endsAt: input.endsAt,
          },
          now,
        );
        return { deal, item, status: dealStatus(deal, now) };
      });
    },

    async update(ownerId, dealId, patch) {
      const venue = await requireOwnedVenue(pool, ownerId);
      return withTransaction(pool, async (client) => {
        const found = await deals.findInVenue(client, venue.id, dealId);
        if (!found) throw dealNotFound();
        const item = await menuItems.lockById(client, found.menuItemId);
        const deal = await deals.lockInVenue(client, venue.id, dealId);
        if (!deal) throw dealNotFound();
        const now = clock.now();
        if (deal.cancelledAt || deal.endsAt <= now || item.archivedAt) {
          throw conflict('deal_finished', 'The deal is cancelled or over, create a new one');
        }
        const quantityLeft = patch.quantityLeft ?? deal.quantityLeft;
        if (quantityLeft > deal.quantityTotal) {
          throw unprocessable(
            'deal_quantity_invalid',
            `Quantity left cannot exceed the ${deal.quantityTotal} portions of the deal`,
          );
        }
        if (patch.endsAt) assertWindow(patch.endsAt, now, deal.startsAt);
        if (quantityLeft > 0) {
          if (deal.quantityLeft === 0) assertSellable(item, deal.priceRub);
          const live = await deals.findLiveForItem(client, item.id, now);
          if (live && live.id !== deal.id) throw dealExists();
        }
        const updated = await deals.update(client, deal.id, {
          quantityLeft,
          endsAt: patch.endsAt ?? deal.endsAt,
        });
        return { deal: updated, item, status: dealStatus(updated, now) };
      });
    },

    async cancel(ownerId, dealId) {
      const venue = await requireOwnedVenue(pool, ownerId);
      if (!(await deals.findInVenue(pool, venue.id, dealId))) throw dealNotFound();
      await deals.cancelLiveInVenue(pool, venue.id, dealId, clock.now());
    },
  };
}
