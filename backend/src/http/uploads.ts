import multipart, { type MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, badRequest } from '../shared/errors.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    imageUpload?: boolean;
  }
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_FIELD = 'image';
export const IMAGE_UPLOAD_ERROR_STATUSES = [400, 413, 415] as const;

export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageUpload {
  data: Buffer;
  mimeType: ImageMimeType;
}

export const IMAGE_UPLOAD_BODY = {
  type: 'object',
  required: [IMAGE_FIELD],
  properties: {
    [IMAGE_FIELD]: {
      type: 'string',
      format: 'binary',
      description: `Фото JPEG, PNG или WebP до ${MAX_IMAGE_BYTES / 1024 / 1024} МБ`,
    },
  },
} as const;

export async function registerUploads(app: FastifyInstance) {
  await app.register(multipart, {
    limits: {
      fileSize: MAX_IMAGE_BYTES,
      files: 1,
      fields: 5,
      fieldSize: 1024,
      parts: 6,
      headerPairs: 50,
    },
  });
}

export function detectImageType(data: Buffer): ImageMimeType | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function statusCode(error: unknown): number | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
    ? error.statusCode
    : undefined;
}

function multipartProblem(error: unknown): Error {
  const code = errorCode(error);
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    return new AppError(413, 'image_too_large', `Image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
  }
  if (code === 'FST_FILES_LIMIT' || code === 'FST_PARTS_LIMIT' || code === 'FST_FIELDS_LIMIT') {
    return new AppError(413, 'upload_too_many_parts', 'Send exactly one photo and nothing else');
  }
  const status = statusCode(error);
  if (error instanceof Error && status !== undefined && status >= 400 && status < 500) return error;
  return badRequest('invalid_multipart', 'The multipart body is malformed');
}

async function discard(file: MultipartFile): Promise<void> {
  await new Promise<void>((resolve) => {
    file.file.once('end', resolve);
    file.file.once('error', () => {
      resolve();
    });
    file.file.resume();
  });
}

export async function readImageUpload(request: FastifyRequest): Promise<ImageUpload> {
  if (!request.isMultipart()) {
    throw new AppError(
      415,
      'multipart_required',
      `Send the photo as multipart/form-data in the "${IMAGE_FIELD}" field`,
    );
  }
  let file: MultipartFile | undefined;
  try {
    file = await request.file();
  } catch (error) {
    throw multipartProblem(error);
  }
  if (!file) {
    throw badRequest('image_required', `Attach the photo in the "${IMAGE_FIELD}" field`);
  }
  if (file.fieldname !== IMAGE_FIELD) {
    await discard(file);
    throw badRequest('image_required', `Attach the photo in the "${IMAGE_FIELD}" field`);
  }
  let data: Buffer;
  try {
    data = await file.toBuffer();
  } catch (error) {
    throw multipartProblem(error);
  }
  if (data.length === 0) {
    throw badRequest('image_empty', 'The photo is empty');
  }
  const mimeType = detectImageType(data);
  if (!mimeType) {
    throw new AppError(415, 'unsupported_image_type', 'Only JPEG, PNG and WebP photos are supported');
  }
  return { data, mimeType };
}
