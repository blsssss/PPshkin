export const STALE_IMPORT_MS = 30 * 60_000;
export const STALE_IMPORT_ERROR = 'Не успели распознать меню, попробуйте фото получше или вставьте текст';

export function menuNameKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase().replaceAll('ё', 'е');
}
