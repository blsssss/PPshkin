import { afterAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedUser, seedVenue } from '../../test/venues.ts';
import type { ParsedMenuItem } from '../domain/models.ts';
import type { MenuParser, MenuParseResult, UnavailableReason } from '../ports/recognition.ts';
import * as menuImports from '../repositories/menu-imports.ts';
import { createBackgroundTasks, type BackgroundLogger, type BackgroundTasks } from '../shared/background.ts';
import { createMenuImportsService, type ParsedMenuItemInput } from './menu-imports.ts';
import { createMenuService } from './menu.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const menu = createMenuService({ pool, clock });

const OWNER = 202;
const OTHER_OWNER = 303;
const MINUTE = 60_000;
const MENU_TEXT = 'Капучино 250 мл - 190 р.\nЭклер 150 г';
const PHOTO = Buffer.from('menu-photo');

const PARSED_ITEMS: ParsedMenuItem[] = [
  {
    name: 'Капучино',
    description: null,
    category: 'drink',
    priceRub: 190,
    weightG: null,
    kcal: 120,
    proteinG: 6,
    fatG: 6,
    carbsG: 10,
    tags: ['coffee', 'drink'],
  },
  {
    name: 'Эклер',
    description: 'Заварной',
    category: 'dessert',
    priceRub: null,
    weightG: 150,
    kcal: 420,
    proteinG: 7,
    fatG: 24,
    carbsG: 45,
    tags: ['dessert', 'sweet'],
  },
];

const CONFIRMED: ParsedMenuItemInput[] = [
  { ...PARSED_ITEMS[0]!, priceRub: 190 },
  { ...PARSED_ITEMS[1]!, priceRub: 150, kcal: 400, tags: ['dessert', 'dessert'] },
];

const parsed: MenuParseResult = {
  status: 'parsed',
  venueName: 'Зерно',
  items: PARSED_ITEMS,
  model: 'test-model',
};

let menus: { fromPhoto: Mock<MenuParser['fromPhoto']>; fromText: Mock<MenuParser['fromText']> };
let logger: { error: Mock<BackgroundLogger['error']> };
let background: BackgroundTasks;

function service() {
  return createMenuImportsService({ pool, clock, menus, background });
}

function pendingParse() {
  const { promise, resolve } = Promise.withResolvers<MenuParseResult>();
  return { result: promise, finish: resolve };
}

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-25T09:00:00Z');
  menus = { fromPhoto: vi.fn<MenuParser['fromPhoto']>(), fromText: vi.fn<MenuParser['fromText']>() };
  menus.fromText.mockResolvedValue(parsed);
  menus.fromPhoto.mockResolvedValue(parsed);
  logger = { error: vi.fn<BackgroundLogger['error']>() };
  background = createBackgroundTasks(logger);
  await seedVenue(pool, OWNER);
});

afterAll(async () => {
  await closeTestPool();
});

describe('menu import lifecycle', () => {
  it('recognizes pasted text in the background', async () => {
    const imports = service();
    const started = await imports.fromText(OWNER, MENU_TEXT);
    expect(started).toMatchObject({
      source: 'text',
      status: 'processing',
      items: [],
      error: null,
      createdAt: clock.now(),
      completedAt: null,
    });
    clock.advance(3_000);
    await background.idle();
    expect(menus.fromText).toHaveBeenCalledWith(MENU_TEXT);
    expect(await imports.get(OWNER, started.id)).toMatchObject({
      status: 'ready',
      items: PARSED_ITEMS,
      error: null,
      model: 'test-model',
      completedAt: clock.now(),
    });
  });

  it('sends only the photo to the parser', async () => {
    const imports = service();
    const started = await imports.fromPhoto(OWNER, PHOTO);
    await background.idle();
    expect(menus.fromPhoto).toHaveBeenCalledWith(PHOTO);
    expect(await imports.get(OWNER, started.id)).toMatchObject({ source: 'photo', status: 'ready' });
  });

  it('fails when nothing was found on the menu', async () => {
    menus.fromText.mockResolvedValue({ ...parsed, items: [] });
    const imports = service();
    const started = await imports.fromText(OWNER, MENU_TEXT);
    await background.idle();
    expect(await imports.get(OWNER, started.id)).toMatchObject({
      status: 'failed',
      items: [],
      model: 'test-model',
      error: 'Не нашли позиций в меню, попробуйте фото получше или вставьте текст',
    });
  });

  it.each<[UnavailableReason, string]>([
    ['disabled', 'Распознавание меню временно недоступно, добавьте позиции вручную'],
    ['timeout', 'Не успели распознать меню, попробуйте фото получше или вставьте текст'],
    ['quota_exceeded', 'Сервис распознавания не ответил, попробуйте позже'],
    ['provider_error', 'Сервис распознавания не ответил, попробуйте позже'],
    ['invalid_response', 'Сервис распознавания не ответил, попробуйте позже'],
    ['unsupported_image', 'Не удалось прочитать изображение, пришлите JPEG или PNG'],
  ])('explains an unavailable parser (%s)', async (reason, error) => {
    menus.fromPhoto.mockResolvedValue({ status: 'unavailable', reason });
    const imports = service();
    const started = await imports.fromPhoto(OWNER, PHOTO);
    await background.idle();
    expect(await imports.get(OWNER, started.id)).toMatchObject({
      status: 'failed',
      items: [],
      model: null,
      error,
      completedAt: clock.now(),
    });
  });

  it('fails and logs when the parser throws', async () => {
    const crash = new Error('socket hang up');
    menus.fromText.mockRejectedValue(crash);
    const imports = service();
    const started = await imports.fromText(OWNER, MENU_TEXT);
    await background.idle();
    expect(await imports.get(OWNER, started.id)).toMatchObject({
      status: 'failed',
      error: 'Сервис распознавания не ответил, попробуйте позже',
    });
    expect(logger.error).toHaveBeenCalledWith(
      { err: crash, task: `menu-import-${started.id}` },
      'background task failed',
    );
  });

  it('fails right away when background work is shutting down', async () => {
    background.stop();
    const started = await service().fromText(OWNER, MENU_TEXT);
    expect(started).toMatchObject({
      status: 'failed',
      error: 'Сервис распознавания не ответил, попробуйте позже',
      completedAt: clock.now(),
    });
    expect(menus.fromText).not.toHaveBeenCalled();
  });
});

describe('applying a menu import', () => {
  it('adds the confirmed items as estimates once', async () => {
    const imports = service();
    const started = await imports.fromText(OWNER, MENU_TEXT);
    await background.idle();
    clock.advance(MINUTE);
    const created = await imports.apply(OWNER, started.id, CONFIRMED);
    expect(created).toHaveLength(2);
    expect(created[1]).toMatchObject({
      name: 'Эклер',
      description: 'Заварной',
      priceRub: 150,
      kcal: 400,
      tags: ['dessert'],
      nutritionSource: 'estimate',
      isAvailable: true,
      createdAt: clock.now(),
    });
    expect((await menu.list(OWNER)).map((item) => item.name)).toEqual(['Эклер', 'Капучино']);
    expect(await imports.get(OWNER, started.id)).toMatchObject({ status: 'applied' });
    await expect(imports.apply(OWNER, started.id, CONFIRMED)).rejects.toMatchObject({
      status: 409,
      code: 'import_already_applied',
    });
    expect(await menu.list(OWNER)).toHaveLength(2);
  });

  it('applies a double submit only once', async () => {
    const imports = service();
    const started = await imports.fromText(OWNER, MENU_TEXT);
    await background.idle();
    const results = await Promise.allSettled([
      imports.apply(OWNER, started.id, CONFIRMED),
      imports.apply(OWNER, started.id, CONFIRMED),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'import_already_applied' },
    });
    expect(await menu.list(OWNER)).toHaveLength(2);
  });

  it('applies only recognized imports', async () => {
    const parse = pendingParse();
    menus.fromText.mockReturnValue(parse.result);
    const imports = service();
    const processing = await imports.fromText(OWNER, MENU_TEXT);
    await expect(imports.apply(OWNER, processing.id, CONFIRMED)).rejects.toMatchObject({
      status: 409,
      code: 'import_not_ready',
    });
    parse.finish({ status: 'unavailable', reason: 'timeout' });
    await background.idle();
    await expect(imports.apply(OWNER, processing.id, CONFIRMED)).rejects.toMatchObject({
      status: 409,
      code: 'import_not_ready',
    });
    expect(await menu.list(OWNER)).toEqual([]);
  });
});

describe('stale menu imports', () => {
  it('reports an import processing for more than 30 minutes as timed out', async () => {
    const parse = pendingParse();
    menus.fromText.mockReturnValueOnce(parse.result);
    const imports = service();
    const stuck = await imports.fromText(OWNER, MENU_TEXT);
    clock.advance(30 * MINUTE);
    expect(await imports.get(OWNER, stuck.id)).toMatchObject({ status: 'processing' });
    await expect(imports.fromText(OWNER, MENU_TEXT)).rejects.toMatchObject({ code: 'import_in_progress' });

    clock.advance(1);
    expect(await imports.get(OWNER, stuck.id)).toMatchObject({
      status: 'failed',
      error: 'Не успели распознать меню, попробуйте фото получше или вставьте текст',
      completedAt: new Date(stuck.createdAt.getTime() + 30 * MINUTE),
    });
    await expect(imports.apply(OWNER, stuck.id, CONFIRMED)).rejects.toMatchObject({
      code: 'import_not_ready',
    });
    const next = await imports.fromText(OWNER, MENU_TEXT);
    parse.finish(parsed);
    await background.idle();
    expect(await imports.get(OWNER, next.id)).toMatchObject({ status: 'ready' });
    expect(await imports.get(OWNER, stuck.id)).toMatchObject({ status: 'failed' });
  });

  it('ignores a result that arrives after the import went stale', async () => {
    const parse = pendingParse();
    menus.fromText.mockReturnValue(parse.result);
    const imports = service();
    const slow = await imports.fromText(OWNER, MENU_TEXT);
    clock.advance(31 * MINUTE);
    parse.finish(parsed);
    await background.idle();
    expect(await imports.get(OWNER, slow.id)).toMatchObject({ status: 'failed', items: [] });
  });
});

describe('menu import limits', () => {
  it('runs one import per venue at a time', async () => {
    const parse = pendingParse();
    menus.fromText.mockReturnValueOnce(parse.result);
    const imports = service();
    await imports.fromText(OWNER, MENU_TEXT);
    await expect(imports.fromPhoto(OWNER, PHOTO)).rejects.toMatchObject({
      status: 409,
      code: 'import_in_progress',
    });
    parse.finish(parsed);
    await background.idle();
    expect((await imports.fromPhoto(OWNER, PHOTO)).status).toBe('processing');
  });

  it('starts only one of two simultaneous imports', async () => {
    const parse = pendingParse();
    menus.fromText.mockReturnValue(parse.result);
    const imports = service();
    const results = await Promise.allSettled([
      imports.fromText(OWNER, MENU_TEXT),
      imports.fromText(OWNER, MENU_TEXT),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'import_in_progress' },
    });
    parse.finish(parsed);
    await background.idle();
  });

  it('allows 20 imports per local day of the venue', async () => {
    clock.set('2026-09-24T21:00:00Z');
    const imports = service();
    for (let index = 0; index < 20; index += 1) {
      await imports.fromText(OWNER, MENU_TEXT);
      await background.idle();
      clock.advance(MINUTE);
    }
    await expect(imports.fromText(OWNER, MENU_TEXT)).rejects.toMatchObject({
      status: 409,
      code: 'import_limit_reached',
    });
    clock.set('2026-09-25T20:59:59Z');
    await expect(imports.fromText(OWNER, MENU_TEXT)).rejects.toMatchObject({ code: 'import_limit_reached' });
    clock.set('2026-09-25T21:00:00Z');
    expect((await imports.fromText(OWNER, MENU_TEXT)).status).toBe('processing');
  });
});

describe('menu import ownership', () => {
  it('hides imports of other venues', async () => {
    const imports = service();
    const started = await imports.fromText(OWNER, MENU_TEXT);
    await background.idle();
    await seedVenue(pool, OTHER_OWNER, { name: 'Пекарня' });
    await expect(imports.get(OTHER_OWNER, started.id)).rejects.toMatchObject({
      status: 404,
      code: 'import_not_found',
    });
    await expect(imports.apply(OTHER_OWNER, started.id, CONFIRMED)).rejects.toMatchObject({
      status: 404,
      code: 'import_not_found',
    });
    await expect(imports.get(OWNER, 999_999)).rejects.toMatchObject({ code: 'import_not_found' });
    expect(await imports.get(OWNER, started.id)).toMatchObject({ status: 'ready' });
  });

  it('requires a venue for every call', async () => {
    const guest = 101;
    await seedUser(pool, guest);
    const imports = service();
    await expect(imports.fromText(guest, MENU_TEXT)).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
    await expect(imports.fromPhoto(guest, PHOTO)).rejects.toMatchObject({ code: 'venue_not_found' });
    await expect(imports.get(guest, 1)).rejects.toMatchObject({ code: 'venue_not_found' });
    await expect(imports.apply(guest, 1, CONFIRMED)).rejects.toMatchObject({ code: 'venue_not_found' });
    expect(menus.fromText).not.toHaveBeenCalled();
  });

  it('keeps only known tags from stored results', async () => {
    const imports = service();
    const started = await imports.fromText(OWNER, MENU_TEXT);
    await background.idle();
    await pool.query(
      `update menu_imports set items = jsonb_set(items, '{0,tags}', '["coffee", "unknown"]') where id = $1`,
      [started.id],
    );
    const stored = await menuImports.findInVenue(pool, started.venueId, started.id);
    expect(stored?.items[0]?.tags).toEqual(['coffee']);
  });
});
