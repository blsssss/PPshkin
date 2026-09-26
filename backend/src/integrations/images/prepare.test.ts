import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIDE_PX,
  MIN_IMAGE_SIDE_PX,
  prepareImage,
  UnsupportedImageError,
} from './prepare.ts';

const canvas = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#6a994e' } });

describe('prepareImage', () => {
  it('shrinks a large photo to 1024 px on the long side and encodes it as JPEG', async () => {
    const output = await prepareImage(await canvas(3000, 2000).png().toBuffer());
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: MAX_IMAGE_SIDE_PX, height: 683 });
  });

  it('keeps a small photo at its size', async () => {
    const output = await prepareImage(await canvas(120, 90).webp().toBuffer());
    expect(await sharp(output).metadata()).toMatchObject({ format: 'jpeg', width: 120, height: 90 });
  });

  it('applies the EXIF orientation and strips all metadata including GPS', async () => {
    const input = await canvas(200, 100)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD0: { Copyright: 'PPshkin test' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '55/1 47/1 0/1' },
      })
      .toBuffer();
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif?.toString('latin1')).toContain('PPshkin test');

    const metadata = await sharp(await prepareImage(input)).metadata();
    expect(metadata).toMatchObject({ width: 100, height: 200 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it.each(['png', 'webp'] as const)(
    'puts a transparent %s on a white background instead of black',
    async (format) => {
      const transparent = await sharp({
        create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .toFormat(format)
        .toBuffer();
      const { channels } = await sharp(await prepareImage(transparent)).stats();
      for (const channel of channels) expect(channel.mean).toBeGreaterThan(200);
    },
  );

  it('keeps dark content drawn on a transparent background readable', async () => {
    const text = await sharp({
      create: { width: 100, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const menu = await sharp({
      create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: text, left: 150, top: 80 }])
      .png()
      .toBuffer();
    const output = sharp(await prepareImage(menu));
    const pixel = async (left: number, top: number) => [
      ...(await output.clone().extract({ left, top, width: 1, height: 1 }).raw().toBuffer()),
    ];
    expect(Math.min(...(await pixel(10, 10)))).toBeGreaterThan(240);
    expect(Math.max(...(await pixel(200, 100)))).toBeLessThan(20);
  });

  it('rejects bytes that are not an image', async () => {
    await expect(prepareImage(Buffer.from('definitely not a photo'))).rejects.toBeInstanceOf(
      UnsupportedImageError,
    );
  });

  it('rejects an image smaller than the minimum side', async () => {
    expect(MIN_IMAGE_SIDE_PX).toBe(32);
    await expect(prepareImage(await canvas(16, 16).png().toBuffer())).rejects.toThrow(UnsupportedImageError);
    await expect(prepareImage(await canvas(400, 20).png().toBuffer())).rejects.toThrow(/smaller than 32 px/);
  });

  it('rejects an image above 50 megapixels without decoding it', async () => {
    expect(MAX_IMAGE_PIXELS).toBe(50_000_000);
    const huge = await canvas(8000, 6400).png({ compressionLevel: 1 }).toBuffer();
    await expect(prepareImage(huge)).rejects.toBeInstanceOf(UnsupportedImageError);
  });

  it('rejects vector images that are not photos', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200"/></svg>',
    );
    await expect(prepareImage(svg)).rejects.toThrow(/not a photo/);
  });

  it('rejects a photo whose pixel data is cut off', async () => {
    const complete = await canvas(400, 300).jpeg().toBuffer();
    await expect(prepareImage(complete.subarray(0, complete.length / 2))).rejects.toBeInstanceOf(
      UnsupportedImageError,
    );
  });
});
