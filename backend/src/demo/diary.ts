import type { Tag } from '../domain/vocabulary.ts';
import { addDays, atLocalTime, minutesOfDay } from '../shared/time.ts';
import type { DiaryTemplateEntry } from './dataset.ts';

export interface PlannedMeal {
  title: string;
  kcalMin: number;
  kcalMax: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  tags: Tag[];
  eatenAt: Date;
}

export interface DiaryPlan {
  meals: PlannedMeal[];
  fromDate: string;
  toDate: string;
}

export function planDiary(
  template: readonly DiaryTemplateEntry[],
  today: string,
  timeZone: string,
): DiaryPlan {
  if (template.length === 0) throw new RangeError('The diary template is empty');
  const meals = template
    .map(({ daysAgo, time, ...meal }) => {
      const minutes = minutesOfDay(time);
      if (minutes === null) throw new RangeError(`Invalid time of day ${time}`);
      return {
        ...meal,
        tags: [...meal.tags],
        eatenAt: atLocalTime(addDays(today, -daysAgo), minutes, timeZone),
      };
    })
    .sort((left, right) => left.eatenAt.getTime() - right.eatenAt.getTime());
  const daysAgo = template.map((entry) => entry.daysAgo);
  return {
    meals,
    fromDate: addDays(today, -Math.max(...daysAgo)),
    toDate: addDays(today, -Math.min(...daysAgo)),
  };
}
