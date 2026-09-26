import { describe, expect, it } from 'vitest';
import { kcalProblems, kcalRange } from './meals.ts';

describe('kcalProblems', () => {
  it('accepts a single value or a complete range', () => {
    expect(kcalProblems({ kcal: 350 }, true)).toEqual([]);
    expect(kcalProblems({ kcalMin: 300, kcalMax: 400 }, true)).toEqual([]);
    expect(kcalProblems({ kcalMin: 300, kcalMax: 300 }, true)).toEqual([]);
  });

  it('requires calories only when asked to', () => {
    expect(kcalProblems({}, true)).toEqual([{ path: 'kcal', message: expect.any(String) as string }]);
    expect(kcalProblems({}, false)).toEqual([]);
  });

  it('rejects mixing a single value with a range', () => {
    expect(kcalProblems({ kcal: 350, kcalMin: 300 }, true)).toMatchObject([{ path: 'kcal' }]);
    expect(kcalProblems({ kcal: 350, kcalMax: 400 }, false)).toMatchObject([{ path: 'kcal' }]);
  });

  it('requires both ends of a range', () => {
    expect(kcalProblems({ kcalMin: 300 }, false)).toMatchObject([{ path: 'kcalMax' }]);
    expect(kcalProblems({ kcalMax: 300 }, true)).toMatchObject([{ path: 'kcalMin' }]);
  });

  it('rejects a range that ends below its start', () => {
    expect(kcalProblems({ kcalMin: 400, kcalMax: 300 }, true)).toMatchObject([{ path: 'kcalMax' }]);
  });
});

describe('kcalRange', () => {
  it('turns a single value into an exact range', () => {
    expect(kcalRange({ kcal: 350 })).toEqual({ kcalMin: 350, kcalMax: 350 });
  });

  it('keeps a complete range', () => {
    expect(kcalRange({ kcalMin: 300, kcalMax: 420 })).toEqual({ kcalMin: 300, kcalMax: 420 });
  });

  it('returns null without calories or with half a range', () => {
    expect(kcalRange({})).toBeNull();
    expect(kcalRange({ kcalMin: 300 })).toBeNull();
  });
});
