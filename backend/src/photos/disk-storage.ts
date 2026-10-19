import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PHOTO_KEY_PATTERN,
  PHOTO_SIZES,
  type PhotoSize,
  type PhotoStorage,
  type PhotoVariants,
} from '../ports/photo-storage.ts';

function assertKey(key: string): void {
  if (!PHOTO_KEY_PATTERN.test(key)) throw new Error('Invalid photo key');
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export function createDiskPhotoStorage(directory: string): PhotoStorage {
  const path = (key: string, size: PhotoSize) => join(directory, `${key}.${size}.webp`);

  async function write(key: string, size: PhotoSize, data: Buffer): Promise<void> {
    const temporary = join(directory, `.${randomBytes(8).toString('hex')}.partial`);
    try {
      await writeFile(temporary, data, { mode: 0o644 });
      await rename(temporary, path(key, size));
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  return {
    async put(key, variants: PhotoVariants) {
      assertKey(key);
      await mkdir(directory, { recursive: true });
      for (const size of PHOTO_SIZES) await write(key, size, variants[size]);
    },

    async get(key, size) {
      assertKey(key);
      try {
        return await readFile(path(key, size));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async remove(key) {
      assertKey(key);
      for (const size of PHOTO_SIZES) await rm(path(key, size), { force: true });
    },
  };
}
