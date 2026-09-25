import { describe, expect, it } from 'vitest';
import { MEAL_SLOTS } from '../vocabulary.ts';
import { mealSlotAt, SLOT_BUDGET_SHARES, slotForHour } from './slots.ts';

describe('meal slots', () => {
  it('maps local hours to meal slots', () => {
    expect([4, 5, 10, 11, 15, 16, 17, 18, 22, 23].map(slotForHour)).toEqual([
      'snack',
      'breakfast',
      'breakfast',
      'lunch',
      'lunch',
      'snack',
      'snack',
      'dinner',
      'dinner',
      'snack',
    ]);
  });

  it('uses the local time of the user', () => {
    expect(mealSlotAt(new Date('2026-09-25T13:30:00Z'), 'Europe/Moscow')).toBe('snack');
    expect(mealSlotAt(new Date('2026-09-25T13:30:00Z'), 'UTC')).toBe('lunch');
  });

  it('splits the daily budget completely across slots', () => {
    const total = MEAL_SLOTS.reduce((sum, slot) => sum + SLOT_BUDGET_SHARES[slot], 0);
    expect(total).toBeCloseTo(1);
  });
});
