export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const JPEG_QUALITY = 0.85;

export class ImageDecodeError extends Error {
  constructor() {
    super('image cannot be decoded');
    this.name = 'ImageDecodeError';
  }
}

export function needsConversion(file: Blob): boolean {
  return !ACCEPTED_TYPES.has(file.type) || file.size > MAX_UPLOAD_BYTES;
}

export function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new ImageDecodeError());
        else resolve(blob);
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

export async function prepareImage(file: File, maxSide: number): Promise<File> {
  if (!needsConversion(file)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageDecodeError();
  }
  try {
    const size = fitSize(bitmap.width, bitmap.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new ImageDecodeError();
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await canvasToJpeg(canvas);
    const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
