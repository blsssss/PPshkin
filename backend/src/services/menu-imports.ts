import { withTransaction, type Pool } from '../db/pool.ts';
import { STALE_IMPORT_ERROR, STALE_IMPORT_MS } from '../domain/menu-imports.ts';
import type { MenuImport, MenuItem } from '../domain/models.ts';
import type { MenuParser, MenuParseResult, UnavailableReason } from '../ports/recognition.ts';
import * as menuImports from '../repositories/menu-imports.ts';
import * as menuItems from '../repositories/menu-items.ts';
import * as venues from '../repositories/venues.ts';
import type { BackgroundTasks } from '../shared/background.ts';
import type { Clock } from '../shared/clock.ts';
import { conflict, notFound } from '../shared/errors.ts';
import { dayRange, localDate } from '../shared/time.ts';
import { menuItemFields, type MenuItemInput } from './menu.ts';
import { requireOwnedVenue, venueNotFound } from './venues.ts';

export type ParsedMenuItemInput = Omit<MenuItemInput, 'isAvailable'>;

export interface MenuImportsService {
  fromPhoto(ownerId: number, image: Buffer): Promise<MenuImport>;
  fromText(ownerId: number, text: string): Promise<MenuImport>;
  get(ownerId: number, importId: number): Promise<MenuImport>;
  apply(ownerId: number, importId: number, items: ParsedMenuItemInput[]): Promise<MenuItem[]>;
}

interface MenuImportsDependencies {
  pool: Pool;
  clock: Clock;
  menus: MenuParser;
  background: BackgroundTasks;
}

const DAILY_IMPORT_LIMIT = 20;

const NO_ANSWER = 'Сервис распознавания не ответил, попробуйте позже';
const NOTHING_FOUND = 'Не нашли позиций в меню, попробуйте фото получше или вставьте текст';

const UNAVAILABLE_MESSAGES: Record<UnavailableReason, string> = {
  disabled: 'Распознавание меню временно недоступно, добавьте позиции вручную',
  timeout: STALE_IMPORT_ERROR,
  quota_exceeded: NO_ANSWER,
  provider_error: NO_ANSWER,
  invalid_response: NO_ANSWER,
  unsupported_image: 'Не удалось прочитать изображение, пришлите JPEG или PNG',
};

function failure(error: string, model: string | null = null): menuImports.ImportOutcome {
  return { status: 'failed', items: [], error, model };
}

function outcomeOf(result: MenuParseResult): menuImports.ImportOutcome {
  if (result.status === 'unavailable') return failure(UNAVAILABLE_MESSAGES[result.reason]);
  if (result.items.length === 0) return failure(NOTHING_FOUND, result.model);
  return { status: 'ready', items: result.items, error: null, model: result.model };
}

function processingSince(now: Date): Date {
  return new Date(now.getTime() - STALE_IMPORT_MS);
}

function asOf(menuImport: MenuImport, now: Date): MenuImport {
  const deadline = menuImport.createdAt.getTime() + STALE_IMPORT_MS;
  if (menuImport.status !== 'processing' || now.getTime() <= deadline) return menuImport;
  return { ...menuImport, status: 'failed', error: STALE_IMPORT_ERROR, completedAt: new Date(deadline) };
}

function importNotFound() {
  return notFound('import_not_found', 'Menu import not found');
}

export function createMenuImportsService({
  pool,
  clock,
  menus,
  background,
}: MenuImportsDependencies): MenuImportsService {
  function finish(importId: number, outcome: menuImports.ImportOutcome): Promise<MenuImport | null> {
    const now = clock.now();
    return menuImports.complete(pool, importId, outcome, now, processingSince(now));
  }

  async function recognize(importId: number, parse: () => Promise<MenuParseResult>): Promise<void> {
    let outcome: menuImports.ImportOutcome;
    try {
      outcome = outcomeOf(await parse());
    } catch (error) {
      await finish(importId, failure(NO_ANSWER));
      throw error;
    }
    await finish(importId, outcome);
  }

  async function start(
    ownerId: number,
    source: MenuImport['source'],
    parse: () => Promise<MenuParseResult>,
  ): Promise<MenuImport> {
    const created = await withTransaction(pool, async (client) => {
      const venue = await venues.lockByOwner(client, ownerId);
      if (!venue) throw venueNotFound();
      const now = clock.now();
      const today = dayRange(localDate(now, venue.timezone), venue.timezone);
      const counts = await menuImports.countRecent(client, venue.id, {
        processingSince: processingSince(now),
        startedFrom: today.from,
        startedTo: today.to,
      });
      if (counts.processing > 0) {
        throw conflict(
          'import_in_progress',
          'Another menu import is still processing, wait for it to finish',
        );
      }
      if (counts.started >= DAILY_IMPORT_LIMIT) {
        throw conflict(
          'import_limit_reached',
          `A venue can import its menu at most ${DAILY_IMPORT_LIMIT} times a day, try again tomorrow`,
        );
      }
      return menuImports.insert(client, venue.id, source, now);
    });
    if (background.run(`menu-import-${created.id}`, () => recognize(created.id, parse))) return created;
    return (await finish(created.id, failure(NO_ANSWER))) ?? created;
  }

  return {
    fromPhoto: (ownerId, image) => start(ownerId, 'photo', () => menus.fromPhoto(image)),

    fromText: (ownerId, text) => start(ownerId, 'text', () => menus.fromText(text)),

    async get(ownerId, importId) {
      const venue = await requireOwnedVenue(pool, ownerId);
      const found = await menuImports.findInVenue(pool, venue.id, importId);
      if (!found) throw importNotFound();
      return asOf(found, clock.now());
    },

    async apply(ownerId, importId, items) {
      const venue = await requireOwnedVenue(pool, ownerId);
      return withTransaction(pool, async (client) => {
        const locked = await menuImports.lockInVenue(client, venue.id, importId);
        if (!locked) throw importNotFound();
        const now = clock.now();
        const { status } = asOf(locked, now);
        if (status === 'applied') {
          throw conflict('import_already_applied', 'These items are already on the menu');
        }
        if (status !== 'ready') {
          throw conflict('import_not_ready', 'Only a recognized import can be applied, wait for it or retry');
        }
        const created: MenuItem[] = [];
        for (const item of items) {
          created.push(await menuItems.insert(client, venue.id, menuItemFields(item, 'estimate'), now));
        }
        await menuImports.markApplied(client, locked.id);
        return created;
      });
    },
  };
}
