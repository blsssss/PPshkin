import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { multipart, TINY_PNG } from '../../test/multipart.ts';
import { buildTestApp } from '../../test/services.ts';
import { MAX_IMAGE_BYTES, readImageUpload } from './uploads.ts';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp({
    extend: (server) => {
      server.post('/upload', { config: { imageUpload: true } }, async (request) => {
        const image = await readImageUpload(request);
        return { bytes: image.length };
      });
    },
  });
});

afterAll(async () => {
  await app.close();
});

const png = (data = TINY_PNG) => [{ field: 'image', filename: 'dish.png', contentType: 'image/png', data }];

describe('image uploads', () => {
  it('reads an image from the image field', async () => {
    const response = await app.inject({ method: 'POST', url: '/upload', ...multipart(png()) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ bytes: TINY_PNG.length });
  });

  it('requires multipart requests', async () => {
    const response = await app.inject({ method: 'POST', url: '/upload', payload: { image: 'x' } });
    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'multipart_required' });
  });

  it('requires the image field', async () => {
    const body = multipart([{ field: 'photo', filename: 'a.png', contentType: 'image/png', data: TINY_PNG }]);
    const response = await app.inject({ method: 'POST', url: '/upload', ...body });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'image_required' });
  });

  it('rejects files that are not images', async () => {
    const body = multipart([
      { field: 'image', filename: 'a.txt', contentType: 'text/plain', data: Buffer.from('hi') },
    ]);
    const response = await app.inject({ method: 'POST', url: '/upload', ...body });
    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'unsupported_image_type' });
  });

  it('rejects images above the size limit', async () => {
    const body = multipart(png(Buffer.alloc(MAX_IMAGE_BYTES + 1)));
    const response = await app.inject({ method: 'POST', url: '/upload', ...body });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ code: 'image_too_large' });
  });

  it('documents upload routes as multipart in OpenAPI', async () => {
    const document = (await app.inject({ method: 'GET', url: '/docs/json' })).json<{
      paths: Record<string, { post: { requestBody: { content: Record<string, { schema: unknown }> } } }>;
    }>();
    const content = document.paths['/upload']?.post.requestBody.content;
    expect(Object.keys(content ?? {})).toEqual(['multipart/form-data']);
    expect(content?.['multipart/form-data']?.schema).toMatchObject({
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary' } },
    });
  });
});
