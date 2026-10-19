import sharp from 'sharp';

export type TestImageFormat = 'jpeg' | 'png' | 'webp';

export async function testImage(
  format: TestImageFormat = 'jpeg',
  options: { width?: number; height?: number; color?: string } = {},
): Promise<Buffer> {
  const { width = 800, height = 600, color = '#c8793a' } = options;
  const image = sharp({ create: { width, height, channels: 3, background: color } });
  if (format === 'png') return image.png().toBuffer();
  if (format === 'webp') return image.webp().toBuffer();
  return image.jpeg().toBuffer();
}

export async function testImageWithMetadata(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: '#4f8a3c' } })
    .jpeg()
    .withExif({
      IFD0: { Copyright: 'secret-copyright', Make: 'secret-camera' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '55/1 47/1 21/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '49/1 7/1 5/1',
      },
    })
    .toBuffer();
}
