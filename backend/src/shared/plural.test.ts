import { describe, expect, it } from 'vitest';
import { plural } from './plural.ts';

const MEALS = ['приём', 'приёма', 'приёмов'] as const;

describe('plural', () => {
  it.each([
    [0, 'приёмов'],
    [1, 'приём'],
    [2, 'приёма'],
    [4, 'приёма'],
    [5, 'приёмов'],
    [11, 'приёмов'],
    [12, 'приёмов'],
    [14, 'приёмов'],
    [21, 'приём'],
    [22, 'приёма'],
    [25, 'приёмов'],
    [111, 'приёмов'],
  ])('uses the Russian form for %i', (count, expected) => {
    expect(plural(count, MEALS)).toBe(expected);
  });
});
