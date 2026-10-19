import { readFile } from 'node:fs/promises';
import {
  MENU_CATEGORIES,
  VENUE_CATEGORIES,
  type MenuCategory,
  type VenueCategory,
} from '../domain/vocabulary.ts';
import { processPhoto } from '../photos/process.ts';
import type { PhotoStorage } from '../ports/photo-storage.ts';

const DEMO_PHOTOS_DIR = new URL('../../assets/demo-photos/', import.meta.url);

export interface DemoPhotoKeys {
  venue: Record<VenueCategory, string>;
  item: Record<MenuCategory, string>;
}

export interface DemoPhotos {
  keys(): Promise<DemoPhotoKeys>;
}

async function store(storage: PhotoStorage, name: string): Promise<string> {
  const processed = await processPhoto(await readFile(new URL(`${name}.jpg`, DEMO_PHOTOS_DIR)));
  await storage.put(processed.key, processed.variants);
  return processed.key;
}

async function storeAll<Name extends string>(
  storage: PhotoStorage,
  prefix: string,
  names: readonly Name[],
): Promise<Record<Name, string>> {
  const entries = await Promise.all(
    names.map(async (name) => [name, await store(storage, `${prefix}-${name}`)] as const),
  );
  return Object.fromEntries(entries) as Record<Name, string>;
}

export function createDemoPhotos(storage: PhotoStorage): DemoPhotos {
  let loaded: Promise<DemoPhotoKeys> | null = null;
  return {
    keys() {
      loaded ??= Promise.all([
        storeAll(storage, 'venue', VENUE_CATEGORIES),
        storeAll(storage, 'item', MENU_CATEGORIES),
      ]).then(([venue, item]) => ({ venue, item }));
      loaded.catch(() => {
        loaded = null;
      });
      return loaded;
    },
  };
}
