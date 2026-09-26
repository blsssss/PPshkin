import { localParts } from '../../shared/time.ts';
import type { MealSlot } from '../vocabulary.ts';

export const SLOT_START_HOURS: Record<MealSlot, number> = {
  breakfast: 5,
  lunch: 11,
  snack: 16,
  dinner: 18,
};

export const SLOT_BUDGET_SHARES: Record<MealSlot, number> = {
  breakfast: 0.25,
  lunch: 0.35,
  snack: 0.1,
  dinner: 0.3,
};

export function slotForHour(hour: number): MealSlot {
  if (hour >= SLOT_START_HOURS.breakfast && hour < SLOT_START_HOURS.lunch) return 'breakfast';
  if (hour >= SLOT_START_HOURS.lunch && hour < SLOT_START_HOURS.snack) return 'lunch';
  if (hour >= SLOT_START_HOURS.dinner && hour < 23) return 'dinner';
  return 'snack';
}

export function mealSlotAt(instant: Date, timeZone: string): MealSlot {
  return slotForHour(localParts(instant, timeZone).hour);
}
