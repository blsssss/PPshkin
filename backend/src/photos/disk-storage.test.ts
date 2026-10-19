import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDiskPhotoStorage } from './disk-storage.ts';

const KEY = 'a'.repeat(64);
const variants = { card: Buffer.from('card'), large: Buffer.from('large') };

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ppshkin-photos-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('disk photo storage', () => {
  it('stores both variants and reads them back', async () => {
    const storage = createDiskPhotoStorage(join(directory, 'nested'));
    await storage.put(KEY, variants);
    expect(await storage.get(KEY, 'card')).toEqual(variants.card);
    expect(await storage.get(KEY, 'large')).toEqual(variants.large);
  });

  it('keeps no partial files and overwrites on a repeated upload', async () => {
    const storage = createDiskPhotoStorage(directory);
    await storage.put(KEY, variants);
    await storage.put(KEY, variants);
    expect((await readdir(directory)).sort()).toEqual([`${KEY}.card.webp`, `${KEY}.large.webp`]);
  });

  it('answers null for a missing photo and removes idempotently', async () => {
    const storage = createDiskPhotoStorage(directory);
    expect(await storage.get(KEY, 'card')).toBeNull();
    await storage.put(KEY, variants);
    await storage.remove(KEY);
    await storage.remove(KEY);
    expect(await storage.get(KEY, 'large')).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it('refuses keys that are not a content hash', async () => {
    const storage = createDiskPhotoStorage(directory);
    for (const key of ['../secret', 'a/b', `${KEY}x`, KEY.toUpperCase(), '']) {
      await expect(storage.get(key, 'card')).rejects.toThrow('Invalid photo key');
      await expect(storage.put(key, variants)).rejects.toThrow('Invalid photo key');
      await expect(storage.remove(key)).rejects.toThrow('Invalid photo key');
    }
  });
});
