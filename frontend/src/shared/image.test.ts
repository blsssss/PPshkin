import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitSize, ImageDecodeError, MAX_UPLOAD_BYTES, needsConversion, prepareImage } from './image.ts';

function file(type: string, size: number, name = 'photo.jpg'): File {
  return new File([new Uint8Array(size)], name, { type });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('needsConversion', () => {
  it.each([
    ['image/jpeg', 1000, false],
    ['image/png', MAX_UPLOAD_BYTES, false],
    ['image/webp', 10, false],
    ['image/heic', 1000, true],
    ['image/jpeg', MAX_UPLOAD_BYTES + 1, true],
    ['', 1000, true],
  ])('%s of %i bytes: %s', (type, size, expected) => {
    expect(needsConversion(file(type, size))).toBe(expected);
  });
});

describe('fitSize', () => {
  it('keeps small images and scales the long side', () => {
    expect(fitSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 });
  });
});

describe('prepareImage', () => {
  it('passes supported files through', async () => {
    const original = file('image/png', 100, 'a.png');
    await expect(prepareImage(original, 1600)).resolves.toBe(original);
  });

  it('re-encodes HEIC into a JPEG within the size limit', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 4032, height: 3024, close })),
    );
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback,
      type,
      quality,
    ) {
      expect(type).toBe('image/jpeg');
      expect(quality).toBe(0.85);
      expect([this.width, this.height]).toEqual([1600, 1200]);
      callback(new Blob([new Uint8Array(10)], { type: 'image/jpeg' }));
    });
    const result = await prepareImage(file('image/heic', 5000, 'IMG_1.HEIC'), 1600);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('IMG_1.jpg');
    expect(drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('reports files the browser cannot decode', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('bad'))),
    );
    await expect(prepareImage(file('image/heic', 10), 1600)).rejects.toBeInstanceOf(ImageDecodeError);
  });
});
