import type { Queryable } from '../db/pool.ts';
import type { PhotoStorage } from '../ports/photo-storage.ts';
import * as photos from '../repositories/photos.ts';

export async function removeIfUnused(
  db: Queryable,
  storage: PhotoStorage,
  key: string | null,
): Promise<void> {
  if (key === null) return;
  await photos.lockPhotos(db);
  if (!(await photos.isReferenced(db, key))) await storage.remove(key);
}
