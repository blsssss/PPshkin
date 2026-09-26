import { describe, expect, it } from 'vitest';
import { formatLocalTime, localDate } from '../shared/time.ts';
import { loadDemoDataset } from './dataset.ts';
import { planDiary } from './diary.ts';

const { diary } = (await loadDemoDataset()).guest;

describe('planDiary', () => {
  it('puts the 26 meals of the template on the 5 days before today in Moscow', () => {
    const plan = planDiary(diary, '2026-09-26', 'Europe/Moscow');
    expect(plan.fromDate).toBe('2026-09-21');
    expect(plan.toDate).toBe('2026-09-25');
    expect(plan.meals).toHaveLength(26);
    expect(plan.meals[0]).toEqual({
      title: 'Овсянка с ягодами',
      kcalMin: 300,
      kcalMax: 360,
      proteinG: 10.2,
      fatG: 8.6,
      carbsG: 52.4,
      tags: ['grain', 'berries', 'breakfast'],
      eatenAt: new Date('2026-09-21T05:30:00Z'),
    });
    expect(plan.meals.at(-1)).toMatchObject({
      title: 'Гречка с курицей',
      eatenAt: new Date('2026-09-25T16:45:00Z'),
    });
    const times = plan.meals.map((meal) => meal.eatenAt.getTime());
    expect(times).toEqual(times.toSorted((left, right) => left - right));
  });

  it('keeps the local wall clock times in another time zone', () => {
    const plan = planDiary(diary, '2026-09-26', 'Asia/Yekaterinburg');
    expect(plan.meals).toHaveLength(26);
    expect(plan.meals[0]?.eatenAt).toEqual(new Date('2026-09-21T03:30:00Z'));
    const byDay = Map.groupBy(plan.meals, (meal) => localDate(meal.eatenAt, 'Asia/Yekaterinburg'));
    expect([...byDay.keys()]).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
    expect(
      byDay.get('2026-09-25')?.map((meal) => formatLocalTime(meal.eatenAt, 'Asia/Yekaterinburg')),
    ).toEqual(['08:25', '08:30', '13:05', '13:15', '16:20', '19:45']);
  });

  it('moves with the current date and across month boundaries', () => {
    const plan = planDiary(diary, '2026-10-02', 'Europe/Moscow');
    expect([plan.fromDate, plan.toDate]).toEqual(['2026-09-27', '2026-10-01']);
  });

  it('copies tags so the template cannot be changed through a plan', () => {
    const plan = planDiary(diary, '2026-09-26', 'Europe/Moscow');
    plan.meals[0]?.tags.push('fish');
    expect(diary[0]?.tags).toEqual(['grain', 'berries', 'breakfast']);
  });

  it('rejects an empty template', () => {
    expect(() => planDiary([], '2026-09-26', 'Europe/Moscow')).toThrow(RangeError);
  });
});
