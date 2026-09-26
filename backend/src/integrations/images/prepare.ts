import sharp from 'sharp';

export const MAX_IMAGE_SIDE_PX = 1024;
export const MIN_IMAGE_SIDE_PX = 32;
export const MAX_IMAGE_PIXELS = 50_000_000;

const JPEG_QUALITY = 80;
const TRANSPARENT_BACKGROUND = '#ffffff';
const PHOTO_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff']);

export class UnsupportedImageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UnsupportedImageError';
  }
}

async function readSize(input: Buffer): Promise<{ format: string; width: number; height: number }> {
  try {
    return await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  } catch (error) {
    throw new UnsupportedImageError('Image cannot be decoded or is larger than 50 megapixels', {
      cause: error,
    });
  }
}

export async function prepareImage(input: Buffer): Promise<Buffer> {
  const { format, width, height } = await readSize(input);
  if (!PHOTO_FORMATS.has(format)) {
    throw new UnsupportedImageError(`Image format ${format} is not a photo`);
  }
  if (width < MIN_IMAGE_SIDE_PX || height < MIN_IMAGE_SIDE_PX) {
    throw new UnsupportedImageError(`Image is smaller than ${MIN_IMAGE_SIDE_PX} px on a side`);
  }
  try {
    return await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize({
        width: MAX_IMAGE_SIDE_PX,
        height: MAX_IMAGE_SIDE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: TRANSPARENT_BACKGROUND })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  } catch (error) {
    throw new UnsupportedImageError('Image cannot be decoded', { cause: error });
  }
}
