import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { multipart, TINY_PNG } from '../../../test/multipart.ts';
import { bearer, buildTestApp } from '../../../test/services.ts';
import { sampleDeal, sampleMenuItem, sampleVenue } from '../../../test/venues.ts';
import type { MenuImport } from '../../domain/models.ts';
import type { DealsService, DealView } from '../../services/deals.ts';
import type { MenuImportsService } from '../../services/menu-imports.ts';
import type { MenuService } from '../../services/menu.ts';
import type { VenuesService } from '../../services/venues.ts';
import { conflict, notFound, unprocessable } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const owner = bearer('venue-token');
const OWNER_ID = 202;

const dealView: DealView = { deal: sampleDeal, item: sampleMenuItem, status: 'active' };

const readyImport: MenuImport = {
  id: 31,
  venueId: sampleVenue.id,
  source: 'photo',
  status: 'ready',
  items: [
    {
      name: 'Капучино',
      description: null,
      category: 'drink',
      priceRub: null,
      weightG: null,
      kcal: 120,
      proteinG: 6,
      fatG: 6,
      carbsG: 10,
      tags: ['coffee'],
    },
  ],
  error: null,
  model: 'test-model',
  createdAt: new Date('2026-09-25T09:00:00Z'),
  completedAt: new Date('2026-09-25T09:00:20Z'),
};

const menuItemDto = {
  id: 11,
  name: 'Эклер',
  description: 'Заварное тесто и ванильный крем',
  category: 'dessert',
  priceRub: 200,
  weightG: 80,
  kcal: 330,
  proteinG: 5,
  fatG: 18,
  carbsG: 38.2,
  nutritionSource: 'venue',
  tags: ['dessert', 'sweet'],
  isAvailable: true,
};

const dealDto = {
  id: 21,
  menuItemId: 11,
  itemName: 'Эклер',
  priceRub: 130,
  originalPriceRub: 200,
  discountPercent: 35,
  quantityTotal: 5,
  quantityLeft: 3,
  startsAt: '2026-09-25T09:00:00.000Z',
  endsAt: '2026-09-25T11:00:00.000Z',
  status: 'active',
};

function venuesStub(overrides: Partial<VenuesService> = {}): VenuesService {
  return {
    get: () => Promise.resolve(sampleVenue),
    create: () => Promise.resolve(sampleVenue),
    update: () => Promise.resolve(sampleVenue),
    ...overrides,
  };
}

function menuStub(overrides: Partial<MenuService> = {}): MenuService {
  return {
    list: () => Promise.resolve([sampleMenuItem]),
    create: () => Promise.resolve(sampleMenuItem),
    update: () => Promise.resolve(sampleMenuItem),
    archive: () => Promise.resolve(),
    ...overrides,
  };
}

function importsStub(overrides: Partial<MenuImportsService> = {}): MenuImportsService {
  const processing = { ...readyImport, status: 'processing' as const, items: [], completedAt: null };
  return {
    fromPhoto: () => Promise.resolve(processing),
    fromText: () => Promise.resolve({ ...processing, source: 'text' }),
    get: () => Promise.resolve(readyImport),
    apply: () => Promise.resolve([sampleMenuItem]),
    ...overrides,
  };
}

function dealsStub(overrides: Partial<DealsService> = {}): DealsService {
  return {
    list: () => Promise.resolve([dealView]),
    create: () => Promise.resolve(dealView),
    update: () => Promise.resolve(dealView),
    cancel: () => Promise.resolve(),
    ...overrides,
  };
}

const noVenue = () => Promise.reject(notFound('venue_not_found', 'No venue'));

describe('venue routes', () => {
  it('require authentication', async () => {
    app = await buildTestApp();
    const routes: [string, string, string][] = [
      ['POST', '/api/v1/venue', '/api/v1/venue'],
      ['GET', '/api/v1/venue', '/api/v1/venue'],
      ['PATCH', '/api/v1/venue', '/api/v1/venue'],
      ['GET', '/api/v1/venue/menu', '/api/v1/venue/menu'],
      ['POST', '/api/v1/venue/menu/items', '/api/v1/venue/menu/items'],
      ['PATCH', '/api/v1/venue/menu/items/1', '/api/v1/venue/menu/items/{id}'],
      ['DELETE', '/api/v1/venue/menu/items/1', '/api/v1/venue/menu/items/{id}'],
      ['POST', '/api/v1/venue/menu/imports/photo', '/api/v1/venue/menu/imports/photo'],
      ['POST', '/api/v1/venue/menu/imports/text', '/api/v1/venue/menu/imports/text'],
      ['GET', '/api/v1/venue/menu/imports/1', '/api/v1/venue/menu/imports/{id}'],
      ['POST', '/api/v1/venue/menu/imports/1/apply', '/api/v1/venue/menu/imports/{id}/apply'],
      ['GET', '/api/v1/venue/deals', '/api/v1/venue/deals'],
      ['POST', '/api/v1/venue/deals', '/api/v1/venue/deals'],
      ['PATCH', '/api/v1/venue/deals/1', '/api/v1/venue/deals/{id}'],
      ['DELETE', '/api/v1/venue/deals/1', '/api/v1/venue/deals/{id}'],
    ];
    for (const [method, url, path] of routes) {
      const response = await app.inject({
        method: method as 'GET',
        url,
        payload: method === 'GET' ? undefined : {},
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expectContract(response, method, path);
    }
  });

  it('answers 404 venue_not_found for owners without a venue', async () => {
    app = await buildTestApp({
      services: { venues: venuesStub({ get: noVenue }), menu: menuStub({ list: noVenue }) },
    });
    for (const [url, path] of [
      ['/api/v1/venue', '/api/v1/venue'],
      ['/api/v1/venue/menu', '/api/v1/venue/menu'],
    ] as const) {
      const response = await app.inject({ method: 'GET', url, headers: owner });
      expect(response.statusCode).toBe(404);
      expectContract(response, 'GET', path);
      expect(response.json()).toMatchObject({ code: 'venue_not_found' });
    }
  });
});

describe('venue profile routes', () => {
  it('creates a venue for the caller', async () => {
    const create = vi.fn<VenuesService['create']>(() => Promise.resolve(sampleVenue));
    app = await buildTestApp({ services: { venues: venuesStub({ create }) } });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/venue',
      headers: owner,
      payload: {
        name: '  Кофейня «Зерно» ',
        address: 'ул. Баумана, 36',
        category: 'coffee',
        location: { lat: 55.7887, lon: 49.1221 },
        opensAt: '20:00',
        closesAt: '02:00',
      },
    });
    expect(response.statusCode).toBe(201);
    expectContract(response, 'POST', '/api/v1/venue');
    expect(response.json()).toEqual({
      id: 7,
      name: 'Кофейня «Зерно»',
      address: 'ул. Баумана, 36',
      category: 'coffee',
      location: { lat: 55.7887, lon: 49.1221 },
      opensAt: '08:00',
      closesAt: '22:00',
      timezone: 'Europe/Moscow',
      isDemo: false,
    });
    expect(create).toHaveBeenCalledWith(OWNER_ID, {
      name: 'Кофейня «Зерно»',
      address: 'ул. Баумана, 36',
      category: 'coffee',
      location: { lat: 55.7887, lon: 49.1221 },
      opensAt: '20:00',
      closesAt: '02:00',
    });
  });

  it('validates the venue fields', async () => {
    app = await buildTestApp({ services: { venues: venuesStub() } });
    const valid = {
      name: 'Зерно',
      address: 'ул. Баумана, 36',
      category: 'coffee',
      location: { lat: 55.79, lon: 49.12 },
    };
    for (const payload of [
      { ...valid, name: '   ' },
      { ...valid, category: 'bar' },
      { ...valid, location: { lat: 91, lon: 49.12 } },
      { ...valid, opensAt: '24:00' },
      { ...valid, closesAt: '8:00' },
      { name: 'Зерно' },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/venue', headers: owner, payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expectContract(response, 'POST', '/api/v1/venue');
      expect(response.json()).toMatchObject({ code: 'validation_failed' });
    }
  });

  it('passes venue conflicts and time zone errors through', async () => {
    const payload = {
      name: 'Зерно',
      address: 'ул. Баумана, 36',
      category: 'coffee',
      location: { lat: 55.79, lon: 49.12 },
    };
    app = await buildTestApp({
      services: {
        venues: venuesStub({
          create: () => Promise.reject(conflict('venue_exists', 'exists')),
          update: () => Promise.reject(unprocessable('invalid_timezone', 'bad')),
        }),
      },
    });
    const created = await app.inject({ method: 'POST', url: '/api/v1/venue', headers: owner, payload });
    expect(created.statusCode).toBe(409);
    expectContract(created, 'POST', '/api/v1/venue');
    expect(created.json()).toMatchObject({ code: 'venue_exists' });

    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/venue',
      headers: owner,
      payload: { timezone: 'Mars/Olympus' },
    });
    expect(updated.statusCode).toBe(422);
    expectContract(updated, 'PATCH', '/api/v1/venue');
    expect(updated.json()).toMatchObject({ code: 'invalid_timezone' });
  });

  it('returns and updates the venue of the caller', async () => {
    const update = vi.fn<VenuesService['update']>(() => Promise.resolve(sampleVenue));
    app = await buildTestApp({ services: { venues: venuesStub({ update }) } });
    const read = await app.inject({ method: 'GET', url: '/api/v1/venue', headers: owner });
    expect(read.statusCode).toBe(200);
    expectContract(read, 'GET', '/api/v1/venue');

    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/v1/venue',
      headers: owner,
      payload: { closesAt: '23:00' },
    });
    expect(patched.statusCode).toBe(200);
    expectContract(patched, 'PATCH', '/api/v1/venue');
    expect(update).toHaveBeenCalledWith(OWNER_ID, { closesAt: '23:00' });

    const empty = await app.inject({ method: 'PATCH', url: '/api/v1/venue', headers: owner, payload: {} });
    expect(empty.statusCode).toBe(400);
    expectContract(empty, 'PATCH', '/api/v1/venue');
  });
});

describe('menu routes', () => {
  it('lists the menu', async () => {
    app = await buildTestApp({ services: { menu: menuStub() } });
    const response = await app.inject({ method: 'GET', url: '/api/v1/venue/menu', headers: owner });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/venue/menu');
    expect(response.json()).toEqual({ items: [menuItemDto] });
  });

  it('adds an item and validates it', async () => {
    const create = vi.fn<MenuService['create']>(() => Promise.resolve(sampleMenuItem));
    app = await buildTestApp({ services: { menu: menuStub({ create }) } });
    const payload = { name: 'Эклер', category: 'dessert', priceRub: 200, kcal: 330, tags: ['dessert'] };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/venue/menu/items',
      headers: owner,
      payload,
    });
    expect(response.statusCode).toBe(201);
    expectContract(response, 'POST', '/api/v1/venue/menu/items');
    expect(response.json()).toEqual(menuItemDto);
    expect(create).toHaveBeenCalledWith(OWNER_ID, payload);

    for (const invalid of [
      { ...payload, priceRub: 0 },
      { ...payload, priceRub: 10.5 },
      { ...payload, kcal: 5001 },
      { ...payload, category: 'pizza' },
      { ...payload, tags: ['unknown'] },
      { ...payload, tags: Array.from({ length: 13 }, () => 'sweet') },
      { ...payload, weightG: 0 },
      { ...payload, proteinG: -1 },
      { ...payload, name: 'x'.repeat(121) },
      { ...payload, description: 'x'.repeat(501) },
    ]) {
      const rejected = await app.inject({
        method: 'POST',
        url: '/api/v1/venue/menu/items',
        headers: owner,
        payload: invalid,
      });
      expect(rejected.statusCode, JSON.stringify(invalid)).toBe(400);
      expectContract(rejected, 'POST', '/api/v1/venue/menu/items');
    }
  });

  it('updates an item', async () => {
    const update = vi.fn<MenuService['update']>(() => Promise.resolve(sampleMenuItem));
    app = await buildTestApp({ services: { menu: menuStub({ update }) } });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/venue/menu/items/11',
      headers: owner,
      payload: { description: null, isAvailable: false },
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'PATCH', '/api/v1/venue/menu/items/{id}');
    expect(update).toHaveBeenCalledWith(OWNER_ID, 11, { description: null, isAvailable: false });

    for (const [url, payload] of [
      ['/api/v1/venue/menu/items/11', {}],
      ['/api/v1/venue/menu/items/abc', { priceRub: 100 }],
      ['/api/v1/venue/menu/items/0', { priceRub: 100 }],
    ] as const) {
      const rejected = await app.inject({ method: 'PATCH', url, headers: owner, payload });
      expect(rejected.statusCode, url).toBe(400);
      expectContract(rejected, 'PATCH', '/api/v1/venue/menu/items/{id}');
    }
  });

  it('reports price conflicts with a live deal and missing items', async () => {
    app = await buildTestApp({
      services: {
        menu: menuStub({
          update: () => Promise.reject(unprocessable('deal_price_not_lower', 'too low')),
          archive: () => Promise.reject(notFound('menu_item_not_found', 'missing')),
        }),
      },
    });
    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/v1/venue/menu/items/11',
      headers: owner,
      payload: { priceRub: 100 },
    });
    expect(patched.statusCode).toBe(422);
    expectContract(patched, 'PATCH', '/api/v1/venue/menu/items/{id}');
    expect(patched.json()).toMatchObject({ code: 'deal_price_not_lower' });

    const archived = await app.inject({
      method: 'DELETE',
      url: '/api/v1/venue/menu/items/11',
      headers: owner,
    });
    expect(archived.statusCode).toBe(404);
    expectContract(archived, 'DELETE', '/api/v1/venue/menu/items/{id}');
    expect(archived.json()).toMatchObject({ code: 'menu_item_not_found' });
  });

  it('archives an item without a body', async () => {
    const archive = vi.fn<MenuService['archive']>(() => Promise.resolve());
    app = await buildTestApp({ services: { menu: menuStub({ archive }) } });
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/venue/menu/items/11',
      headers: owner,
    });
    expect(response.statusCode).toBe(204);
    expectContract(response, 'DELETE', '/api/v1/venue/menu/items/{id}');
    expect(archive).toHaveBeenCalledWith(OWNER_ID, 11);
  });
});

describe('menu import routes', () => {
  it('starts a photo import', async () => {
    const fromPhoto = vi.fn<MenuImportsService['fromPhoto']>(() =>
      importsStub().fromPhoto(OWNER_ID, Buffer.alloc(0)),
    );
    app = await buildTestApp({ services: { menuImports: importsStub({ fromPhoto }) } });
    const upload = multipart([
      { field: 'image', filename: 'menu.png', contentType: 'image/png', data: TINY_PNG },
    ]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/venue/menu/imports/photo',
      headers: { ...owner, ...upload.headers },
      payload: upload.payload,
    });
    expect(response.statusCode).toBe(202);
    expectContract(response, 'POST', '/api/v1/venue/menu/imports/photo');
    expect(response.json()).toEqual({
      id: 31,
      source: 'photo',
      status: 'processing',
      items: [],
      error: null,
      createdAt: '2026-09-25T09:00:00.000Z',
      completedAt: null,
    });
    expect(fromPhoto).toHaveBeenCalledWith(OWNER_ID, TINY_PNG);
  });

  it('rejects bad photo uploads', async () => {
    app = await buildTestApp({ services: { menuImports: importsStub() } });
    const url = '/api/v1/venue/menu/imports/photo';
    const notMultipart = await app.inject({ method: 'POST', url, headers: owner, payload: { image: 'x' } });
    expect(notMultipart.statusCode).toBe(415);
    expectContract(notMultipart, 'POST', url);
    expect(notMultipart.json()).toMatchObject({ code: 'multipart_required' });

    const wrongField = multipart([
      { field: 'photo', filename: 'a.png', contentType: 'image/png', data: TINY_PNG },
    ]);
    const missing = await app.inject({
      method: 'POST',
      url,
      headers: { ...owner, ...wrongField.headers },
      payload: wrongField.payload,
    });
    expect(missing.statusCode).toBe(400);
    expectContract(missing, 'POST', url);
    expect(missing.json()).toMatchObject({ code: 'image_required' });

    const heic = multipart([
      { field: 'image', filename: 'a.heic', contentType: 'image/heic', data: Buffer.from('....ftypheic') },
    ]);
    const unsupported = await app.inject({
      method: 'POST',
      url,
      headers: { ...owner, ...heic.headers },
      payload: heic.payload,
    });
    expect(unsupported.statusCode).toBe(415);
    expectContract(unsupported, 'POST', url);
    expect(unsupported.json()).toMatchObject({ code: 'unsupported_image_type' });
  });

  it('limits photo imports to 10 a minute', async () => {
    app = await buildTestApp({ services: { menuImports: importsStub() } });
    const upload = multipart([
      { field: 'image', filename: 'menu.png', contentType: 'image/png', data: TINY_PNG },
    ]);
    const send = () =>
      app!.inject({
        method: 'POST',
        url: '/api/v1/venue/menu/imports/photo',
        headers: { ...owner, ...upload.headers },
        payload: upload.payload,
      });
    for (let index = 0; index < 10; index += 1) {
      expect((await send()).statusCode).toBe(202);
    }
    const limited = await send();
    expect(limited.statusCode).toBe(429);
    expectContract(limited, 'POST', '/api/v1/venue/menu/imports/photo');
  });

  it('starts a text import and reports import limits', async () => {
    const fromText = vi
      .fn<MenuImportsService['fromText']>()
      .mockImplementationOnce(() => importsStub().fromText(OWNER_ID, ''))
      .mockRejectedValueOnce(conflict('import_in_progress', 'busy'))
      .mockRejectedValueOnce(conflict('import_limit_reached', 'limit'));
    app = await buildTestApp({ services: { menuImports: importsStub({ fromText }) } });
    const url = '/api/v1/venue/menu/imports/text';
    const send = (text: string) => app!.inject({ method: 'POST', url, headers: owner, payload: { text } });

    const started = await send('Эклер 150 г 120 руб');
    expect(started.statusCode).toBe(202);
    expectContract(started, 'POST', url);
    expect(started.json()).toMatchObject({ source: 'text', status: 'processing' });
    expect(fromText).toHaveBeenCalledWith(OWNER_ID, 'Эклер 150 г 120 руб');

    for (const code of ['import_in_progress', 'import_limit_reached']) {
      const busy = await send('Эклер 150 г 120 руб');
      expect(busy.statusCode).toBe(409);
      expectContract(busy, 'POST', url);
      expect(busy.json()).toMatchObject({ code });
    }

    for (const text of ['', 'x'.repeat(8001)]) {
      const invalid = await send(text);
      expect(invalid.statusCode).toBe(400);
      expectContract(invalid, 'POST', url);
    }
  });

  it('returns an import with its recognized items', async () => {
    const get = vi.fn<MenuImportsService['get']>(() => Promise.resolve(readyImport));
    app = await buildTestApp({ services: { menuImports: importsStub({ get }) } });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/venue/menu/imports/31',
      headers: owner,
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/venue/menu/imports/{id}');
    expect(response.json()).toMatchObject({
      status: 'ready',
      items: [{ name: 'Капучино', priceRub: null, kcal: 120, tags: ['coffee'] }],
      completedAt: '2026-09-25T09:00:20.000Z',
    });
    expect(response.json()).not.toHaveProperty('model');
    expect(get).toHaveBeenCalledWith(OWNER_ID, 31);

    app = await buildTestApp({
      services: {
        menuImports: importsStub({ get: () => Promise.reject(notFound('import_not_found', 'x')) }),
      },
    });
    const missing = await app.inject({ method: 'GET', url: '/api/v1/venue/menu/imports/99', headers: owner });
    expect(missing.statusCode).toBe(404);
    expectContract(missing, 'GET', '/api/v1/venue/menu/imports/{id}');
  });

  it('applies confirmed items that all have a price', async () => {
    const apply = vi
      .fn<MenuImportsService['apply']>()
      .mockResolvedValueOnce([sampleMenuItem])
      .mockRejectedValueOnce(conflict('import_already_applied', 'done'));
    app = await buildTestApp({ services: { menuImports: importsStub({ apply }) } });
    const url = '/api/v1/venue/menu/imports/31/apply';
    const item = {
      name: 'Капучино',
      category: 'drink',
      priceRub: 190,
      kcal: 120,
      proteinG: 6,
      tags: ['coffee'],
    };

    const applied = await app.inject({ method: 'POST', url, headers: owner, payload: { items: [item] } });
    expect(applied.statusCode).toBe(201);
    expectContract(applied, 'POST', '/api/v1/venue/menu/imports/{id}/apply');
    expect(applied.json()).toEqual({ items: [menuItemDto] });
    expect(apply).toHaveBeenCalledWith(OWNER_ID, 31, [item]);

    const again = await app.inject({ method: 'POST', url, headers: owner, payload: { items: [item] } });
    expect(again.statusCode).toBe(409);
    expectContract(again, 'POST', '/api/v1/venue/menu/imports/{id}/apply');
    expect(again.json()).toMatchObject({ code: 'import_already_applied' });

    const withoutPrice = { name: 'Капучино', category: 'drink', kcal: 120 };
    for (const payload of [
      { items: [] },
      { items: [withoutPrice] },
      { items: [{ ...item, priceRub: null }] },
      { items: Array.from({ length: 81 }, () => item) },
    ]) {
      const rejected = await app.inject({ method: 'POST', url, headers: owner, payload });
      expect(rejected.statusCode).toBe(400);
      expectContract(rejected, 'POST', '/api/v1/venue/menu/imports/{id}/apply');
    }
    expect(apply).toHaveBeenCalledTimes(2);
  });
});

describe('deal routes', () => {
  it('lists active deals by default and finished ones on request', async () => {
    const list = vi.fn<DealsService['list']>(() => Promise.resolve([dealView]));
    app = await buildTestApp({ services: { deals: dealsStub({ list }) } });
    const active = await app.inject({ method: 'GET', url: '/api/v1/venue/deals', headers: owner });
    expect(active.statusCode).toBe(200);
    expectContract(active, 'GET', '/api/v1/venue/deals');
    expect(active.json()).toEqual({ items: [dealDto] });
    expect(list).toHaveBeenLastCalledWith(OWNER_ID, 'active');

    const finished = await app.inject({
      method: 'GET',
      url: '/api/v1/venue/deals?status=finished',
      headers: owner,
    });
    expect(finished.statusCode).toBe(200);
    expect(list).toHaveBeenLastCalledWith(OWNER_ID, 'finished');

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/venue/deals?status=all',
      headers: owner,
    });
    expect(invalid.statusCode).toBe(400);
    expectContract(invalid, 'GET', '/api/v1/venue/deals');
  });

  it('creates a deal', async () => {
    const create = vi.fn<DealsService['create']>(() => Promise.resolve(dealView));
    app = await buildTestApp({ services: { deals: dealsStub({ create }) } });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/venue/deals',
      headers: owner,
      payload: { menuItemId: 11, priceRub: 130, quantity: 5, endsAt: '2026-09-25T14:00:00+03:00' },
    });
    expect(response.statusCode).toBe(201);
    expectContract(response, 'POST', '/api/v1/venue/deals');
    expect(response.json()).toEqual(dealDto);
    expect(create).toHaveBeenCalledWith(OWNER_ID, {
      menuItemId: 11,
      priceRub: 130,
      quantity: 5,
      endsAt: new Date('2026-09-25T11:00:00Z'),
    });
  });

  it('validates new deals', async () => {
    app = await buildTestApp({ services: { deals: dealsStub() } });
    const valid = { menuItemId: 11, priceRub: 130, quantity: 5, endsAt: '2026-09-25T11:00:00Z' };
    for (const payload of [
      { ...valid, priceRub: 0 },
      { ...valid, quantity: 0 },
      { ...valid, quantity: 101 },
      { ...valid, endsAt: 'tomorrow' },
      { ...valid, endsAt: '2026-09-25' },
      { ...valid, menuItemId: -1 },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/venue/deals',
        headers: owner,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expectContract(response, 'POST', '/api/v1/venue/deals');
    }
  });

  it('passes deal rule violations through', async () => {
    const valid = { menuItemId: 11, priceRub: 130, quantity: 5, endsAt: '2026-09-25T11:00:00Z' };
    const failures = [
      notFound('menu_item_not_found', 'x'),
      conflict('deal_exists', 'x'),
      unprocessable('menu_item_unavailable', 'x'),
      unprocessable('deal_price_not_lower', 'x'),
      unprocessable('deal_window_invalid', 'x'),
    ];
    const create = vi.fn<DealsService['create']>();
    for (const failure of failures) create.mockRejectedValueOnce(failure);
    app = await buildTestApp({ services: { deals: dealsStub({ create }) } });
    for (const failure of failures) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/venue/deals',
        headers: owner,
        payload: valid,
      });
      expect(response.statusCode).toBe(failure.status);
      expectContract(response, 'POST', '/api/v1/venue/deals');
      expect(response.json()).toMatchObject({ code: failure.code });
    }
  });

  it('updates a deal', async () => {
    const update = vi
      .fn<DealsService['update']>()
      .mockResolvedValueOnce({ ...dealView, deal: { ...sampleDeal, quantityLeft: 0 }, status: 'sold_out' })
      .mockRejectedValueOnce(conflict('deal_finished', 'over'))
      .mockRejectedValueOnce(unprocessable('deal_quantity_invalid', 'too many'));
    app = await buildTestApp({ services: { deals: dealsStub({ update }) } });
    const url = '/api/v1/venue/deals/21';
    const path = '/api/v1/venue/deals/{id}';

    const soldOut = await app.inject({ method: 'PATCH', url, headers: owner, payload: { quantityLeft: 0 } });
    expect(soldOut.statusCode).toBe(200);
    expectContract(soldOut, 'PATCH', path);
    expect(soldOut.json()).toMatchObject({ quantityLeft: 0, status: 'sold_out' });
    expect(update).toHaveBeenCalledWith(OWNER_ID, 21, { quantityLeft: 0, endsAt: undefined });

    const finished = await app.inject({
      method: 'PATCH',
      url,
      headers: owner,
      payload: { endsAt: '2026-09-25T12:00:00Z' },
    });
    expect(finished.statusCode).toBe(409);
    expectContract(finished, 'PATCH', path);
    expect(update).toHaveBeenLastCalledWith(OWNER_ID, 21, {
      quantityLeft: undefined,
      endsAt: new Date('2026-09-25T12:00:00Z'),
    });

    const tooMany = await app.inject({ method: 'PATCH', url, headers: owner, payload: { quantityLeft: 50 } });
    expect(tooMany.statusCode).toBe(422);
    expectContract(tooMany, 'PATCH', path);

    for (const payload of [{}, { quantityLeft: -1 }, { endsAt: 'soon' }]) {
      const invalid = await app.inject({ method: 'PATCH', url, headers: owner, payload });
      expect(invalid.statusCode, JSON.stringify(payload)).toBe(400);
      expectContract(invalid, 'PATCH', path);
    }
  });

  it('cancels a deal', async () => {
    const cancel = vi
      .fn<DealsService['cancel']>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(notFound('deal_not_found', 'x'));
    app = await buildTestApp({ services: { deals: dealsStub({ cancel }) } });
    const cancelled = await app.inject({ method: 'DELETE', url: '/api/v1/venue/deals/21', headers: owner });
    expect(cancelled.statusCode).toBe(204);
    expectContract(cancelled, 'DELETE', '/api/v1/venue/deals/{id}');
    expect(cancel).toHaveBeenCalledWith(OWNER_ID, 21);

    const missing = await app.inject({ method: 'DELETE', url: '/api/v1/venue/deals/21', headers: owner });
    expect(missing.statusCode).toBe(404);
    expectContract(missing, 'DELETE', '/api/v1/venue/deals/{id}');
    expect(missing.json()).toMatchObject({ code: 'deal_not_found' });
  });
});
