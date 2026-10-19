import { PHOTO_SIZES, type PhotoSize, type PhotoStorage } from '../src/ports/photo-storage.ts';

export interface MemoryPhotoStorage extends PhotoStorage {
  keys(): string[];
}

export function memoryPhotoStorage(): MemoryPhotoStorage {
  const files = new Map<string, Buffer>();
  const id = (key: string, size: PhotoSize) => `${key}.${size}`;
  return {
    put(key, variants) {
      for (const size of PHOTO_SIZES) files.set(id(key, size), variants[size]);
      return Promise.resolve();
    },
    get: (key, size) => Promise.resolve(files.get(id(key, size)) ?? null),
    remove(key) {
      for (const size of PHOTO_SIZES) files.delete(id(key, size));
      return Promise.resolve();
    },
    keys: () => [...new Set([...files.keys()].map((name) => name.split('.')[0] ?? ''))].sort(),
  };
}
