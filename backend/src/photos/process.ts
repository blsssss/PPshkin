import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { MAX_IMAGE_PIXELS } from '../integrations/images/prepare.ts';
import type { PhotoSize, PhotoVariants } from '../ports/photo-storage.ts';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MIN_PHOTO_SIDE_PX = 100;
export const PHOTO_WIDTH_PX: Record<PhotoSize, number> = { card: 640, large: 1280 };

const WEBP_QUALITY = 80;

export class UnreadablePhotoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UnreadablePhotoError';
  }
}

export interface ProcessedPhoto {
  key: string;
  variants: PhotoVariants;
}

async function variant(input: Buffer, size: PhotoSize): Promise<Buffer> {
  return sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS })
    .rotate()
    .resize({ width: PHOTO_WIDTH_PX[size], withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  try {
    const { width, height } = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    if (width < MIN_PHOTO_SIDE_PX || height < MIN_PHOTO_SIDE_PX) {
      throw new UnreadablePhotoError(`Photo is smaller than ${MIN_PHOTO_SIDE_PX} px on a side`);
    }
    const [card, large] = await Promise.all([variant(input, 'card'), variant(input, 'large')]);
    return { key: createHash('sha256').update(large).digest('hex'), variants: { card, large } };
  } catch (error) {
    if (error instanceof UnreadablePhotoError) throw error;
    throw new UnreadablePhotoError('Photo cannot be decoded or is larger than 50 megapixels', {
      cause: error,
    });
  }
}
