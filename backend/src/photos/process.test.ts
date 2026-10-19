import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { testImage, testImageWithMetadata } from '../../test/images.ts';
import { MIN_PHOTO_SIDE_PX, processPhoto, UnreadablePhotoError } from './process.ts';

describe('processPhoto', () => {
  it('makes a card and a large WebP of the documented widths', async () => {
    const { variants } = await processPhoto(await testImage('jpeg', { width: 2400, height: 1800 }));
    expect(await sharp(variants.card).metadata()).toMatchObject({ format: 'webp', width: 640, height: 480 });
    expect(await sharp(variants.large).metadata()).toMatchObject({
      format: 'webp',
      width: 1280,
      height: 960,
    });
  });

  it('does not enlarge small photos', async () => {
    const { variants } = await processPhoto(await testImage('png', { width: 400, height: 300 }));
    expect(await sharp(variants.card).metadata()).toMatchObject({ width: 400, height: 300 });
    expect(await sharp(variants.large).metadata()).toMatchObject({ width: 400, height: 300 });
  });

  it('accepts JPEG, PNG and WebP', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const { variants } = await processPhoto(await testImage(format));
      expect((await sharp(variants.card).metadata()).format).toBe('webp');
    }
  });

  it('removes EXIF and GPS from both variants', async () => {
    const source = await testImageWithMetadata();
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const { variants } = await processPhoto(source);
    for (const variant of [variants.card, variants.large]) {
      expect((await sharp(variant).metadata()).exif).toBeUndefined();
      expect(variant.includes('secret-')).toBe(false);
      expect(variant.includes('Exif')).toBe(false);
    }
  });

  it('names the photo by a hash of its content', async () => {
    const first = await processPhoto(await testImage('jpeg', { color: '#c8793a' }));
    const again = await processPhoto(await testImage('jpeg', { color: '#c8793a' }));
    const other = await processPhoto(await testImage('jpeg', { color: '#3a79c8' }));
    expect(first.key).toMatch(/^[0-9a-f]{64}$/);
    expect(again.key).toBe(first.key);
    expect(other.key).not.toBe(first.key);
  });

  it('gives the same name to the same picture with different metadata', async () => {
    const plain = await processPhoto(await testImage('jpeg', { color: '#4f8a3c' }));
    const tagged = await processPhoto(await testImageWithMetadata());
    expect(tagged.key).toBe(plain.key);
  });

  it('rejects data that is not a picture and tiny pictures', async () => {
    await expect(processPhoto(Buffer.from('not an image at all'))).rejects.toBeInstanceOf(
      UnreadablePhotoError,
    );
    const tiny = await testImage('png', { width: MIN_PHOTO_SIDE_PX - 1, height: 400 });
    await expect(processPhoto(tiny)).rejects.toBeInstanceOf(UnreadablePhotoError);
  });
});
