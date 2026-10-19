export const PHOTO_SIZES = ['card', 'large'] as const;

export type PhotoSize = (typeof PHOTO_SIZES)[number];

export const PHOTO_KEY_PATTERN = /^[0-9a-f]{64}$/;

export type PhotoVariants = Record<PhotoSize, Buffer>;

export interface PhotoStorage {
  put(key: string, variants: PhotoVariants): Promise<void>;
  get(key: string, size: PhotoSize): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}
