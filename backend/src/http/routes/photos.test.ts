import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectContract } from '../../../test/contract.ts';
import { buildTestApp } from '../../../test/services.ts';
import type { PhotosService } from '../../services/photos.ts';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const KEY = 'ab'.repeat(32);
const IMAGE = Buffer.from('RIFF....WEBPfake');

function photosStub(read: PhotosService['read']): { photos: PhotosService } {
  return {
    photos: {
      setVenuePhoto: () => Promise.reject(new Error('not stubbed')),
      removeVenuePhoto: () => Promise.reject(new Error('not stubbed')),
      setMenuItemPhoto: () => Promise.reject(new Error('not stubbed')),
      removeMenuItemPhoto: () => Promise.reject(new Error('not stubbed')),
      read,
    },
  };
}

describe('GET /api/v1/photos/{file}', () => {
  it('serves the photo without authorization and with long cache headers', async () => {
    const read = vi.fn<PhotosService['read']>().mockResolvedValue(IMAGE);
    app = await buildTestApp({ services: photosStub(read) });
    const response = await app.inject({ method: 'GET', url: `/api/v1/photos/${KEY}.webp` });
    expect(response.statusCode).toBe(200);
    expectContract(response, 'GET', '/api/v1/photos/{file}');
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.rawPayload).toEqual(IMAGE);
    expect(read).toHaveBeenCalledWith(KEY, 'card');
  });

  it('serves the large size on request', async () => {
    const read = vi.fn<PhotosService['read']>().mockResolvedValue(IMAGE);
    app = await buildTestApp({ services: photosStub(read) });
    const response = await app.inject({ method: 'GET', url: `/api/v1/photos/${KEY}.webp?size=large` });
    expect(response.statusCode).toBe(200);
    expect(read).toHaveBeenCalledWith(KEY, 'large');
  });

  it('answers 404 for a photo that is gone', async () => {
    app = await buildTestApp({ services: photosStub(() => Promise.resolve(null)) });
    const response = await app.inject({ method: 'GET', url: `/api/v1/photos/${KEY}.webp` });
    expect(response.statusCode).toBe(404);
    expectContract(response, 'GET', '/api/v1/photos/{file}');
    expect(response.json()).toMatchObject({ code: 'photo_not_found' });
    expect(response.headers['cache-control']).toBeUndefined();
  });

  it('rejects names that are not a hash and unknown sizes without reading anything', async () => {
    const read = vi.fn<PhotosService['read']>().mockResolvedValue(IMAGE);
    app = await buildTestApp({ services: photosStub(read) });
    const urls = [
      `/api/v1/photos/${KEY}`,
      `/api/v1/photos/${KEY}.png`,
      `/api/v1/photos/${KEY.toUpperCase()}.webp`,
      `/api/v1/photos/${KEY.slice(1)}.webp`,
      '/api/v1/photos/..%2F..%2Fetc%2Fpasswd.webp',
      `/api/v1/photos/${KEY}.webp?size=huge`,
    ];
    for (const url of urls) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(400);
      expectContract(response, 'GET', '/api/v1/photos/{file}');
    }
    expect(read).not.toHaveBeenCalled();
  });
});
