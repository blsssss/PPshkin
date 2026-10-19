import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { expectContract } from '../../test/contract.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { testImage, testImageWithMetadata } from '../../test/images.ts';
import { multipart } from '../../test/multipart.ts';
import { testConfig } from '../../test/services.ts';
import { DEMO_ACCOUNTS } from '../auth/demo.ts';
import { createServices } from '../container.ts';
import { createRecognition } from '../recognition/index.ts';
import * as users from '../repositories/users.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { buildApp } from './app.ts';

const GUEST_TOKEN = 'demo-guest-token-photos-0123456789ab';
const VENUE_TOKEN = 'demo-venue-token-photos-0123456789ab';
const guest = { authorization: `Bearer ${GUEST_TOKEN}` };
const owner = { authorization: `Bearer ${VENUE_TOKEN}` };
const clock = fixedClock('2026-09-26T13:00:00Z');
const pool = testPool();
const POINT = 'lat=55.7887&lon=49.1221';

let app: FastifyInstance;
let directory: string;

interface Photoed {
  photoUrl: string | null;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ppshkin-photos-flow-'));
  const config = testConfig({
    DEMO_MODE: 'true',
    DEMO_GUEST_TOKEN: GUEST_TOKEN,
    DEMO_VENUE_TOKEN: VENUE_TOKEN,
    PHOTOS_DIR: directory,
  });
  const services = createServices({
    config,
    pool,
    clock,
    recognition: createRecognition({
      apiKey: undefined,
      baseUrl: config.CHADGPT_BASE_URL,
      visionModel: config.CHADGPT_MODEL,
      fallbackModel: config.CHADGPT_FALLBACK_MODEL,
      timeoutMs: config.CHADGPT_TIMEOUT_MS,
      menuTimeoutMs: config.CHADGPT_MENU_TIMEOUT_MS,
    }),
    background: createBackgroundTasks({ error: () => undefined }),
  });
  app = await buildApp({ config, services });
  await app.ready();
});

beforeEach(async () => {
  await resetDatabase(pool);
  for (const account of Object.values(DEMO_ACCOUNTS)) {
    await users.upsert(pool, { id: account.userId, firstName: account.firstName, username: null });
  }
  for (const name of await readdir(directory)) await rm(join(directory, name), { force: true });
});

afterAll(async () => {
  await app.close();
  await rm(directory, { recursive: true, force: true });
  await closeTestPool();
});

async function upload(method: 'PUT', url: string, path: string, data: Buffer, type = 'image/jpeg') {
  const body = multipart([{ field: 'image', filename: 'dish.jpg', contentType: type, data }]);
  const response = await app.inject({
    method,
    url,
    headers: { ...owner, ...body.headers },
    payload: body.payload,
  });
  expectContract(response, method, path);
  return response;
}

async function get(url: string, path: string, headers: Record<string, string> = guest) {
  const response = await app.inject({ method: 'GET', url, headers });
  expectContract(response, 'GET', path);
  return response;
}

async function createVenueWithDeal() {
  const venue = await app.inject({
    method: 'POST',
    url: '/api/v1/venue',
    headers: owner,
    payload: {
      name: 'Кофейня «Зерно»',
      address: 'ул. Баумана, 36',
      category: 'coffee',
      location: { lat: 55.7887, lon: 49.1221 },
      opensAt: '08:00',
      closesAt: '22:00',
    },
  });
  const item = await app.inject({
    method: 'POST',
    url: '/api/v1/venue/menu/items',
    headers: owner,
    payload: { name: 'Чизкейк', category: 'dessert', priceRub: 250, kcal: 320, tags: ['dessert', 'sweet'] },
  });
  const itemId = item.json<{ id: number }>().id;
  await app.inject({
    method: 'POST',
    url: '/api/v1/venue/deals',
    headers: owner,
    payload: { menuItemId: itemId, priceRub: 160, quantity: 2, endsAt: '2026-09-26T16:00:00Z' },
  });
  return { venueId: venue.json<{ id: number }>().id, itemId };
}

describe('photos flow against the database', () => {
  it('shows uploaded photos to the guest in the venue list, the card and the deal feed', async () => {
    const { venueId, itemId } = await createVenueWithDeal();
    const venuePut = await upload(
      'PUT',
      '/api/v1/venue/photo',
      '/api/v1/venue/photo',
      await testImageWithMetadata(),
    );
    expect(venuePut.statusCode).toBe(200);
    const itemPut = await upload(
      'PUT',
      `/api/v1/venue/menu/items/${itemId}/photo`,
      '/api/v1/venue/menu/items/{id}/photo',
      await testImage('png', { width: 1600, height: 1200 }),
      'image/png',
    );
    expect(itemPut.statusCode).toBe(200);
    const venueUrl = venuePut.json<Photoed>().photoUrl ?? '';
    const itemUrl = itemPut.json<Photoed>().photoUrl ?? '';
    expect(venueUrl).toMatch(/^\/api\/v1\/photos\/[0-9a-f]{64}\.webp$/);
    expect(itemUrl).toMatch(/^\/api\/v1\/photos\/[0-9a-f]{64}\.webp$/);

    const list = await get(`/api/v1/venues?${POINT}`, '/api/v1/venues');
    expect(list.json<{ items: { venue: Photoed }[] }>().items[0]?.venue.photoUrl).toBe(venueUrl);
    const card = await get(`/api/v1/venues/${venueId}`, '/api/v1/venues/{id}');
    const details = card.json<{ venue: Photoed; menu: Photoed[]; deals: unknown[] }>();
    expect(details.venue.photoUrl).toBe(venueUrl);
    expect(details.menu[0]?.photoUrl).toBe(itemUrl);
    const deals = await get(`/api/v1/deals?${POINT}`, '/api/v1/deals');
    expect(deals.json<{ items: { item: Photoed; venue: Photoed }[] }>().items[0]).toMatchObject({
      item: { photoUrl: itemUrl },
      venue: { photoUrl: venueUrl },
    });

    const cardImage = await get(venueUrl, '/api/v1/photos/{file}', {});
    expect(cardImage.statusCode).toBe(200);
    expect(cardImage.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const meta = await sharp(cardImage.rawPayload).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 640 });
    expect(meta.exif).toBeUndefined();
    const large = await get(`${itemUrl}?size=large`, '/api/v1/photos/{file}', {});
    expect(await sharp(large.rawPayload).metadata()).toMatchObject({ format: 'webp', width: 1280 });
    expect((await readdir(directory)).sort()).toHaveLength(4);
  });

  it('removes files from the volume when the photo is removed or the item archived', async () => {
    const { itemId } = await createVenueWithDeal();
    const put = await upload(
      'PUT',
      `/api/v1/venue/menu/items/${itemId}/photo`,
      '/api/v1/venue/menu/items/{id}/photo',
      await testImage('jpeg'),
    );
    const url = put.json<Photoed>().photoUrl ?? '';
    expect((await get(url, '/api/v1/photos/{file}', {})).statusCode).toBe(200);
    const archived = await app.inject({
      method: 'DELETE',
      url: `/api/v1/venue/menu/items/${itemId}`,
      headers: owner,
    });
    expect(archived.statusCode).toBe(204);
    expect((await get(url, '/api/v1/photos/{file}', {})).statusCode).toBe(404);
    expect(await readdir(directory)).toEqual([]);
  });

  it('refuses a file with a faked extension and keeps the volume empty', async () => {
    await createVenueWithDeal();
    const response = await upload(
      'PUT',
      '/api/v1/venue/photo',
      '/api/v1/venue/photo',
      Buffer.from('<html></html>'),
      'image/jpeg',
    );
    expect(response.statusCode).toBe(415);
    expect(await readdir(directory)).toEqual([]);
  });

  it('turns away a venue without photo permission and a stranger', async () => {
    const stranger = await app.inject({
      method: 'DELETE',
      url: '/api/v1/venue/photo',
      headers: owner,
    });
    expect(stranger.statusCode).toBe(404);
    expectContract(stranger, 'DELETE', '/api/v1/venue/photo');
  });
});
