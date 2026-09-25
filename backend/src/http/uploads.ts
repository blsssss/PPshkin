import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, badRequest } from '../shared/errors.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    imageUpload?: boolean;
  }
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_FIELD = 'image';
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export const IMAGE_UPLOAD_BODY = {
  type: 'object',
  required: [IMAGE_FIELD],
  properties: {
    [IMAGE_FIELD]: {
      type: 'string',
      format: 'binary',
      description: `JPEG, PNG, WebP or HEIC photo up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
    },
  },
} as const;

export async function registerUploads(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 10, parts: 11 },
  });
}

function isFileTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE'
  );
}

export async function readImageUpload(request: FastifyRequest): Promise<Buffer> {
  if (!request.isMultipart()) {
    throw new AppError(
      415,
      'multipart_required',
      `Send the photo as multipart/form-data in the "${IMAGE_FIELD}" field`,
    );
  }
  const file = await request.file();
  if (file?.fieldname !== IMAGE_FIELD) {
    throw badRequest('image_required', `Attach the photo in the "${IMAGE_FIELD}" field`);
  }
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
    file.file.resume();
    throw new AppError(415, 'unsupported_image_type', `Unsupported image type ${file.mimetype}`);
  }
  try {
    return await file.toBuffer();
  } catch (error) {
    if (isFileTooLarge(error)) {
      throw new AppError(413, 'image_too_large', `Image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    }
    throw error;
  }
}
