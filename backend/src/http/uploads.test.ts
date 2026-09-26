import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { multipart, TINY_PNG } from '../../test/multipart.ts';
import { buildTestApp } from '../../test/services.ts';
import { detectImageType, MAX_IMAGE_BYTES, readImageUpload } from './uploads.ts';

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  app = await buildTestApp({
    extend: (server) => {
      server.post('/upload', { config: { imageUpload: true } }, async (request) => {
        const image = await readImageUpload(request);
        return { bytes: image.data.length, mimeType: image.mimeType };
      });
    },
  });
  baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await app.close();
});

const file = (data: Buffer, contentType = 'image/png', field = 'image') => [
  { field, filename: 'dish.png', contentType, data },
];

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);

describe('image uploads', () => {
  it('reads an image and detects its type from the bytes', async () => {
    const response = await app.inject({ method: 'POST', url: '/upload', ...multipart(file(TINY_PNG)) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ bytes: TINY_PNG.length, mimeType: 'image/png' });
  });

  it('requires multipart requests', async () => {
    const response = await app.inject({ method: 'POST', url: '/upload', payload: { image: 'x' } });
    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'multipart_required' });
  });

  it('requires the image field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      ...multipart(file(TINY_PNG, 'image/png', 'photo')),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'image_required' });
  });

  it('rejects files that are not images whatever type the client declares', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      ...multipart(file(Buffer.from('not an image'))),
    });
    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'unsupported_image_type' });
  });

  it('rejects empty files', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      ...multipart(file(Buffer.alloc(0))),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'image_empty' });
  });

  it('rejects images above the size limit', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      ...multipart(file(Buffer.alloc(MAX_IMAGE_BYTES + 1))),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ code: 'image_too_large' });
  });

  it('uses the first photo and drops extra parts without stalling the connection', async () => {
    const body = multipart([...file(TINY_PNG), ...file(Buffer.alloc(1024 * 1024, 2), 'image/png', 'second')]);
    const response = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      headers: body.headers,
      body: body.payload,
      signal: AbortSignal.timeout(5_000),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bytes: TINY_PNG.length, mimeType: 'image/png' });
    const next = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
    expect(next.status).toBe(200);
  });

  it('answers malformed multipart bodies with a client error', async () => {
    const valid = multipart(file(TINY_PNG));
    const truncated = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: valid.headers,
      payload: valid.payload.subarray(0, 60),
    });
    expect(truncated.statusCode).toBe(400);
    expect(truncated.json()).toMatchObject({ code: 'invalid_multipart' });

    const noBoundary = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: { 'content-type': 'multipart/form-data' },
      payload: 'garbage',
    });
    expect(noBoundary.statusCode).toBe(400);
  });

  it('keeps the connection usable after rejecting a large file sent under the wrong field', async () => {
    const body = multipart(file(Buffer.alloc(2 * 1024 * 1024, 1), 'image/png', 'photo'));
    const rejected = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      headers: body.headers,
      body: body.payload,
      signal: AbortSignal.timeout(5_000),
    });
    expect(rejected.status).toBe(400);
    await rejected.text();
    const next = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
    expect(next.status).toBe(200);
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

describe('detectImageType', () => {
  it('recognises JPEG, PNG and WebP signatures', () => {
    expect(detectImageType(JPEG)).toBe('image/jpeg');
    expect(detectImageType(TINY_PNG)).toBe('image/png');
    expect(detectImageType(WEBP)).toBe('image/webp');
    expect(detectImageType(Buffer.from('GIF89a'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});
