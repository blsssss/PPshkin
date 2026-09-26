import { describe, expect, it } from 'vitest';
import { historyLine, nothingFits, offerFacts, profileCollecting, shortDate } from './offer-texts.ts';

describe('offer texts', () => {
  it.each([
    [1, 'запишите ещё 1 приём пищи'],
    [2, 'запишите ещё 2 приёма пищи'],
    [5, 'запишите ещё 5 приёмов пищи'],
    [11, 'запишите ещё 11 приёмов пищи'],
    [21, 'запишите ещё 21 приём пищи'],
  ])('counts %i meals left in the right form', (left, part) => {
    expect(profileCollecting(left)).toBe(`Профиль вкусов ещё собирается: ${part}, и подбор станет точнее`);
  });

  it('shows the price, the estimate and the distance when it is known', () => {
    expect(offerFacts(190, 310, 342)).toBe('190 ₽, около 310 ккал, 350 м от вас');
    expect(offerFacts(190, 310, 1234)).toBe('190 ₽, около 310 ккал, 1,2 км от вас');
    expect(offerFacts(190, 310, null)).toBe('190 ₽, около 310 ккал');
  });

  it('says nearby only when the search had a point', () => {
    expect(nothingFits(420, true)).toMatch(/^Сейчас рядом нет подходящих блюд/);
    expect(nothingFits(420, false)).toMatch(/^Сейчас нет подходящих блюд/);
  });

  it('writes history dates as day and month in the venue time zone', () => {
    const lateEvening = new Date('2026-09-12T21:30:00Z');
    expect(shortDate(lateEvening, 'Europe/Moscow')).toBe('13.09');
    expect(shortDate(lateEvening, 'UTC')).toBe('12.09');
    expect(historyLine('12.09', 'Эклер [мини]', 'Кофейня «Зерно»', 'redeemed')).toBe(
      '12.09 Эклер \\[мини\\], Кофейня «Зерно»: погашена',
    );
  });
});
