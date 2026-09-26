import { describe, expect, it } from 'vitest';
import { DECLINE_REASONS, isTag, MENU_CATEGORIES, onlyKnownTags, TAG_LABELS, TAGS } from './vocabulary.ts';

describe('vocabulary', () => {
  it('lists every tag with a Russian label', () => {
    expect(TAGS.length).toBe(Object.keys(TAG_LABELS).length);
    for (const tag of TAGS) {
      expect(TAG_LABELS[tag]).toMatch(/^[а-яё ]+$/);
    }
  });

  it('recognizes only vocabulary tags', () => {
    expect(isTag('dessert')).toBe(true);
    expect(isTag('nuts')).toBe(false);
    expect(isTag('toString')).toBe(false);
  });

  it('normalizes, filters and deduplicates tags', () => {
    expect(onlyKnownTags([' Sweet', 'dessert', 'nuts', 'sweet'])).toEqual(['sweet', 'dessert']);
  });

  it('keeps menu categories aligned with the database constraint', () => {
    expect(MENU_CATEGORIES).toEqual([
      'breakfast',
      'main',
      'soup',
      'salad',
      'side',
      'bakery',
      'dessert',
      'snack',
      'drink',
    ]);
  });

  it('keeps decline reasons aligned with the database constraint', () => {
    expect(DECLINE_REASONS).toEqual(['not_today', 'dislike']);
  });
});
