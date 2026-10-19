import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { multipart, TINY_PNG } from '../../../test/multipart.ts';
import { bearer, buildTestApp } from '../../../test/services.ts';
import { sampleMenuItem, sampleVenue } from '../../../test/venues.ts';
import type { PhotosService } from '../../services/photos.ts';
import { AppError, forbidden, notFound } from '../../shared/errors.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const owner = bearer('venue-token');
const ACTOR = { userId: 202 };
const KEY = 'cd'.repeat(32);

const venueWithPhoto = { ...sampleVenue, photoKey: KEY };
const itemWithPhoto = { ...sampleMenuItem, photoKey: KEY };

function stub(overrides: Partial<PhotosService>): { photos: PhotosService } {
  const rejected = () => Promise.reject(new Error('not stubbed'));
  return {
    photos: {
      setVenuePhoto: rejected,
      removeVenuePhoto: rejected,
      setMenuItemPhoto: rejected,
      removeMenuItemPhoto: rejected,
      read: rejected,
      ...overrides,
    },
  };
}

const image = () =>
  multipart([{ field: 'image', filename: 'dish.png', contentType: 'image/png', data: TINY_PNG }]);

describe('photo upload routes', () => {
  it('requires a token on every method', async () => {
    app = await buildTestApp({ services: stub({}) });
    const routes = [
      ['PUT', '/api/v1/venue/photo', '/api/v1/venue/photo'],
      ['DELETE', '/api/v1/venue/photo', '/api/v1/venue/photo'],
      ['PUT', '/api/v1/venue/menu/items/1/photo', '/api/v1/venue/menu/items/{id}/photo'],
      ['DELETE', '/api/v1/venue/menu/items/1/photo', '/api/v1/venue/menu/items/{id}/photo'],
    ] as const;
    for (const [method, url, path] of routes) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expectContract(response, method, path);
    }
  });

  it('uploads the venue photo and returns the venue with photoUrl', async () => {
    const setVenuePhoto = vi.fn<PhotosService['setVenuePhoto']>().mockResolvedValue(venueWithPhoto);
    app = await buildTestApp({ services: stub({ setVenuePhoto }) });
    const upload = image();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/venue/photo',
      headers: { ...owner, ...upload.headers },
      payload: upload.payload,
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'PUT', '/api/v1/venue/photo');
    expect(response.json()).toMatchObject({ id: sampleVenue.id, photoUrl: `/api/v1/photos/${KEY}.webp` });
    expect(setVenuePhoto).toHaveBeenCalledWith(ACTOR, TINY_PNG, 'miniapp');
  });

  it('passes venueId to pick the workplace', async () => {
    const removeVenuePhoto = vi.fn<PhotosService['removeVenuePhoto']>().mockResolvedValue(sampleVenue);
    app = await buildTestApp({ services: stub({ removeVenuePhoto }) });
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/venue/photo?venueId=7',
      headers: owner,
    });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'DELETE', '/api/v1/venue/photo');
    expect(response.json()).toMatchObject({ photoUrl: null });
    expect(removeVenuePhoto).toHaveBeenCalledWith({ userId: 202, venueId: 7 }, 'miniapp');
  });

  it('uploads and removes the photo of a menu item', async () => {
    const setMenuItemPhoto = vi.fn<PhotosService['setMenuItemPhoto']>().mockResolvedValue(itemWithPhoto);
    const removeMenuItemPhoto = vi
      .fn<PhotosService['removeMenuItemPhoto']>()
      .mockResolvedValue(sampleMenuItem);
    app = await buildTestApp({ services: stub({ setMenuItemPhoto, removeMenuItemPhoto }) });
    const upload = image();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/venue/menu/items/11/photo',
      headers: { ...owner, ...upload.headers },
      payload: upload.payload,
    });
    expect(put.statusCode).toBe(200);
    expectContract(put, 'PUT', '/api/v1/venue/menu/items/{id}/photo');
    expect(put.json()).toMatchObject({ id: 11, photoUrl: `/api/v1/photos/${KEY}.webp` });
    expect(setMenuItemPhoto).toHaveBeenCalledWith(ACTOR, 11, TINY_PNG, 'miniapp');

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/v1/venue/menu/items/11/photo',
      headers: owner,
    });
    expect(del.statusCode).toBe(200);
    expectContract(del, 'DELETE', '/api/v1/venue/menu/items/{id}/photo');
    expect(del.json()).toMatchObject({ photoUrl: null });
    expect(removeMenuItemPhoto).toHaveBeenCalledWith(ACTOR, 11, 'miniapp');
  });

  it('maps role and ownership failures from the service', async () => {
    app = await buildTestApp({
      services: stub({
        setVenuePhoto: () =>
          Promise.reject(forbidden('venue_forbidden', 'Your role does not allow this action')),
        setMenuItemPhoto: () => Promise.reject(notFound('menu_item_not_found', 'Menu item not found')),
      }),
    });
    const venue = image();
    const forbiddenResponse = await app.inject({
      method: 'PUT',
      url: '/api/v1/venue/photo',
      headers: { ...owner, ...venue.headers },
      payload: venue.payload,
    });
    expect(forbiddenResponse.statusCode).toBe(403);
    expectContract(forbiddenResponse, 'PUT', '/api/v1/venue/photo');
    const item = image();
    const missing = await app.inject({
      method: 'PUT',
      url: '/api/v1/venue/menu/items/5/photo',
      headers: { ...owner, ...item.headers },
      payload: item.payload,
    });
    expect(missing.statusCode).toBe(404);
    expectContract(missing, 'PUT', '/api/v1/venue/menu/items/{id}/photo');
    expect(missing.json()).toMatchObject({ code: 'menu_item_not_found' });
  });

  it('documents the 413 and 422 answers of the service', async () => {
    app = await buildTestApp({
      services: stub({
        setVenuePhoto: () =>
          Promise.reject(new AppError(413, 'image_too_large', 'Photo is larger than 5 MB')),
        setMenuItemPhoto: () =>
          Promise.reject(new AppError(422, 'image_unreadable', 'Photo cannot be decoded')),
      }),
    });
    const venue = image();
    const tooLarge = await app.inject({
      method: 'PUT',
      url: '/api/v1/venue/photo',
      headers: { ...owner, ...venue.headers },
      payload: venue.payload,
    });
    expect(tooLarge.statusCode).toBe(413);
    expectContract(tooLarge, 'PUT', '/api/v1/venue/photo');
    const item = image();
    const unreadable = await app.inject({
      method: 'PUT',
      url: '/api/v1/venue/menu/items/5/photo',
      headers: { ...owner, ...item.headers },
      payload: item.payload,
    });
    expect(unreadable.statusCode).toBe(422);
    expectContract(unreadable, 'PUT', '/api/v1/venue/menu/items/{id}/photo');
  });

  it('rejects bad uploads before the service is called', async () => {
    const setVenuePhoto = vi.fn<PhotosService['setVenuePhoto']>();
    app = await buildTestApp({ services: stub({ setVenuePhoto }) });
    const url = '/api/v1/venue/photo';
    const notMultipart = await app.inject({ method: 'PUT', url, headers: owner, payload: { image: 'x' } });
    expect(notMultipart.statusCode).toBe(415);
    expectContract(notMultipart, 'PUT', url);
    const spoofed = multipart([
      {
        field: 'image',
        filename: 'dish.png',
        contentType: 'image/png',
        data: Buffer.from('<html>not a picture</html>'),
      },
    ]);
    const unsupported = await app.inject({
      method: 'PUT',
      url,
      headers: { ...owner, ...spoofed.headers },
      payload: spoofed.payload,
    });
    expect(unsupported.statusCode).toBe(415);
    expectContract(unsupported, 'PUT', url);
    expect(unsupported.json()).toMatchObject({ code: 'unsupported_image_type' });
    const wrongField = multipart([
      { field: 'photo', filename: 'dish.png', contentType: 'image/png', data: TINY_PNG },
    ]);
    const missing = await app.inject({
      method: 'PUT',
      url,
      headers: { ...owner, ...wrongField.headers },
      payload: wrongField.payload,
    });
    expect(missing.statusCode).toBe(400);
    expectContract(missing, 'PUT', url);
    expect(setVenuePhoto).not.toHaveBeenCalled();
  });
});
