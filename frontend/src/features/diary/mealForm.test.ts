import { describe, expect, it } from 'vitest';
import {
  defaultEatenAt,
  emptyForm,
  formFromCandidate,
  formFromMeal,
  mapFieldErrors,
  toCreateInput,
  toPatchInput,
  validateMeal,
  type MealFormState,
} from './mealForm.ts';
import { toZonedInput } from '../../shared/zonedTime.ts';
import type { Meal } from './queries.ts';

const TZ = 'Europe/Moscow';

const NOW = new Date('2026-09-26T12:00:00+03:00');

const MEAL: Meal = {
  id: 7,
  title: 'Сырники',
  kcalMin: 380,
  kcalMax: 450,
  kcal: 415,
  proteinG: 20.5,
  fatG: null,
  carbsG: 40,
  tags: ['dairy', 'breakfast'],
  source: 'photo',
  confidence: 0.8,
  eatenAt: '2026-09-26T05:30:00.000Z',
  slot: 'breakfast',
};

function form(patch: Partial<MealFormState>): MealFormState {
  return { ...emptyForm(null, NOW, TZ), title: 'Борщ', kcal: '250', ...patch };
}

describe('validateMeal', () => {
  it('accepts a single value and builds the create input', () => {
    const { meal, errors } = validateMeal(form({ proteinG: '12,5' }), NOW, TZ);
    expect(errors).toEqual({});
    expect(meal).not.toBeNull();
    expect(toCreateInput(meal!)).toEqual({
      title: 'Борщ',
      kcal: 250,
      proteinG: 12.5,
      eatenAt: new Date('2026-09-26T12:00:00+03:00').toISOString(),
    });
  });

  it('accepts a range', () => {
    const { meal } = validateMeal(form({ range: true, kcalMin: '200', kcalMax: '300' }), NOW, TZ);
    expect(toCreateInput(meal!)).toMatchObject({ kcalMin: 200, kcalMax: 300 });
  });

  it('rejects a reversed range', () => {
    expect(validateMeal(form({ range: true, kcalMin: '300', kcalMax: '200' }), NOW, TZ).errors).toEqual({
      kcalMax: 'Верхняя граница не может быть меньше нижней',
    });
  });

  it('requires a title and whole kcal', () => {
    const { errors } = validateMeal(form({ title: '  ', kcal: '12.5' }), NOW, TZ);
    expect(Object.keys(errors).sort()).toEqual(['kcal', 'title']);
  });

  it('checks macros', () => {
    expect(validateMeal(form({ fatG: '-1' }), NOW, TZ).errors.fatG).toBeDefined();
    expect(validateMeal(form({ fatG: '1.25' }), NOW, TZ).errors.fatG).toBeDefined();
    expect(validateMeal(form({ fatG: '0' }), NOW, TZ).errors.fatG).toBeUndefined();
  });

  it.each([
    ['2026-09-19T12:01', true],
    ['2026-09-19T11:59', false],
    ['2026-09-26T12:04', true],
    ['2026-09-26T12:06', false],
  ])('eatenAt %s is valid: %s', (eatenAt, valid) => {
    expect(validateMeal(form({ eatenAt }), NOW, TZ).errors.eatenAt === undefined).toBe(valid);
  });
});

describe('edit', () => {
  it('fills the form from a meal and sends only changed fields', () => {
    const state = formFromMeal(MEAL, TZ);
    expect(state).toMatchObject({ range: true, kcalMin: '380', kcalMax: '450', proteinG: '20,5', fatG: '' });
    const unchanged = validateMeal(state, new Date('2026-09-26T12:00:00Z'), TZ).meal!;
    expect(toPatchInput(unchanged, MEAL)).toEqual({});
    const edited = validateMeal(
      { ...state, range: false, kcal: '400', fatG: '9' },
      new Date('2026-09-26T12:00:00Z'),
      TZ,
    ).meal!;
    expect(toPatchInput(edited, MEAL)).toEqual({ kcal: 400, fatG: 9 });
  });

  it('prefills from a recognition candidate', () => {
    const state = formFromCandidate(
      {
        title: 'Капучино',
        portionG: 250,
        kcalMin: 110,
        kcalMax: 140,
        proteinG: 6,
        fatG: 5.5,
        carbsG: 9,
        tags: ['coffee'],
        confidence: 0.4,
      },
      null,
      NOW,
      TZ,
    );
    expect(state).toMatchObject({
      title: 'Капучино',
      range: true,
      kcalMin: '110',
      kcalMax: '140',
      fatG: '5,5',
      tags: ['coffee'],
    });
  });

  it('maps server field errors onto the form', () => {
    expect(mapFieldErrors({ kcal: 'bad', title: 'long', 'items.0': 'x' }, false)).toEqual({
      kcal: 'bad',
      title: 'long',
    });
    expect(mapFieldErrors({ kcalMax: 'low' }, true)).toEqual({ kcalMax: 'low' });
  });
});

describe('defaultEatenAt', () => {
  it('uses now for today and the same time on a past day', () => {
    expect(defaultEatenAt(null, NOW, TZ)).toBe(toZonedInput(NOW, TZ));
    expect(defaultEatenAt('2026-09-24', NOW, TZ)).toBe('2026-09-24T12:00');
  });

  it('keeps the value inside the allowed window', () => {
    expect(defaultEatenAt('2026-09-19', NOW, TZ)).toBe('2026-09-19T12:01');
  });
});

describe('time zones and old meals', () => {
  it('uses the profile time zone, not the device one', () => {
    const now = new Date('2026-09-26T17:30:00Z');
    expect(defaultEatenAt(null, now, 'Europe/Moscow')).toBe('2026-09-26T20:30');
    expect(defaultEatenAt(null, now, 'Asia/Vladivostok')).toBe('2026-09-27T03:30');
    const { meal } = validateMeal(form({ eatenAt: '2026-09-26T20:30' }), now, 'Europe/Moscow');
    expect(meal?.eatenAt).toBe('2026-09-26T17:30:00.000Z');
  });

  it('lets the user edit an old meal without touching its time', () => {
    const old: Meal = { ...MEAL, eatenAt: '2026-09-10T06:00:00.000Z' };
    const now = new Date('2026-09-26T12:00:00Z');
    const edited = validateMeal(
      { ...formFromMeal(old, TZ), title: 'Сырники со сметаной' },
      now,
      TZ,
      old.eatenAt,
    );
    expect(edited.errors).toEqual({});
    expect(toPatchInput(edited.meal!, old)).toEqual({ title: 'Сырники со сметаной' });
    const moved = validateMeal(
      { ...formFromMeal(old, TZ), eatenAt: '2026-09-11T09:00' },
      now,
      TZ,
      old.eatenAt,
    );
    expect(moved.errors.eatenAt).toBe('Можно указать время за последние 7 дней');
  });
});
