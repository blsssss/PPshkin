import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as texts from './texts.ts';
import {
  calendarDate,
  capitalize,
  dayProgress,
  distance,
  errorText,
  kcalRange,
  limitedLines,
  localDateLabel,
  macros,
  openingStatus,
  RECORD_FORMS,
  splitText,
  todayTotal,
  truncate,
  venuePlace,
} from './texts.ts';

const LONG_DASHES = [String.fromCodePoint(0x2013), String.fromCodePoint(0x2014)];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('bot texts', () => {
  it('never use long dashes anywhere in the bot', () => {
    const files = sourceFiles(fileURLToPath(new URL('.', import.meta.url)));
    expect(files.length).toBeGreaterThan(10);
    const offending = files.filter((file) =>
      LONG_DASHES.some((dash) => readFileSync(file, 'utf8').includes(dash)),
    );
    expect(offending).toEqual([]);
  });

  it('keep every fixed text within the MAX message limit', () => {
    const fixed = Object.values(texts).filter((value): value is string => typeof value === 'string');
    expect(fixed.length).toBeGreaterThan(20);
    for (const text of fixed) expect(text.length).toBeLessThanOrEqual(texts.MESSAGE_LIMIT);
  });

  it('shows calories as an estimate', () => {
    expect(kcalRange(300, 360)).toBe('300-360 ккал');
    expect(kcalRange(650, 650)).toBe('около 650 ккал');
  });

  it.each([
    [0, '50 м'],
    [24, '50 м'],
    [342, '350 м'],
    [974, '950 м'],
    [975, '1 км'],
    [1000, '1 км'],
    [1234, '1,2 км'],
    [12_760, '12,8 км'],
  ])('rounds %i meters to %s', (meters, text) => {
    expect(distance(meters)).toBe(text);
  });

  it('formats dates in the given time zone', () => {
    const lateEvening = new Date('2026-09-25T21:30:00Z');
    expect(calendarDate(lateEvening, 'Europe/Moscow')).toBe('26 сентября');
    expect(calendarDate(lateEvening, 'UTC')).toBe('25 сентября');
    expect(localDateLabel('2026-01-01')).toBe('1 января');
  });

  it('describes the day progress', () => {
    expect(dayProgress(1250, 2000, 750)).toBe('Сегодня около 1250 из 2000 ккал, осталось около 750 ккал');
    expect(dayProgress(2100, 2000, 0)).toBe('Сегодня около 2100 из 2000 ккал, ориентир на день набран');
    expect(todayTotal(740, 2000, 1260)).toBe('Итого около 740 ккал из 2000, осталось около 1260');
  });

  it('lists known macros only', () => {
    expect(macros({ proteinG: 12.4, fatG: 15.5, carbsG: 25 })).toBe('Б 12 г, Ж 16 г, У 25 г');
    expect(macros({ proteinG: 3, fatG: null, carbsG: null })).toBe('Б 3 г');
    expect(macros({ proteinG: null, fatG: null, carbsG: null })).toBeNull();
  });

  it('shortens long lists and names', () => {
    expect(limitedLines(['a', 'b'], 2, RECORD_FORMS)).toEqual(['a', 'b']);
    expect(limitedLines(['a', 'b', 'c', 'd'], 2, RECORD_FORMS)).toEqual(['a', 'b', 'и ещё 2 записи']);
    expect(limitedLines(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 2, RECORD_FORMS)).toEqual([
      'a',
      'b',
      'и ещё 5 записей',
    ]);
    expect(truncate(' Борщ ', 10)).toBe('Борщ');
    expect(truncate('Очень длинное название блюда', 10)).toBe('Очень дли…');
    expect(truncate('Суп🍲дня', 5)).toBe('Суп🍲…');
    expect(truncate('🍲🍲🍲', 3)).toBe('🍲🍲🍲');
    expect(truncate('Торт 🎂🎂🎂', 7).isWellFormed()).toBe(true);
    expect(capitalize('сырники')).toBe('Сырники');
  });

  it('splits long texts into parts within the limit', () => {
    expect(splitText('Первый.\n\nВторой.', 100)).toEqual(['Первый.\n\nВторой.']);
    expect(splitText('Первый абзац.\n\nВторой абзац.', 20)).toEqual(['Первый абзац.', 'Второй абзац.']);
    const parts = splitText(`${'а'.repeat(25)}\n\nб`, 10);
    expect(parts).toEqual(['а'.repeat(10), 'а'.repeat(10), `${'а'.repeat(5)}\n\nб`]);
    expect(texts.personalDataDocument().every((part) => part.length <= texts.MESSAGE_LIMIT)).toBe(true);
  });

  it('describes opening hours', () => {
    expect(openingStatus(true, '08:00:00', '22:00:00')).toBe('Сейчас открыто до 22:00');
    expect(openingStatus(false, '08:00', '22:00')).toBe('Сейчас закрыто, откроется в 08:00');
    expect(openingStatus(true, '00:00:00', '00:00:00')).toBe('Открыто круглосуточно');
  });

  it('escapes venue names and addresses', () => {
    expect(venuePlace('Кафе [Б]', 'ул. #1', 120)).toBe('Кафе \\[Б\\], ул. \\#1, 100 м от вас');
    expect(venuePlace('Кафе', 'ул. Баумана', null)).toBe('Кафе, ул. Баумана');
  });

  it('turns known error codes into guest texts', () => {
    expect(errorText('meal_not_found')).toBe('Не нашёл: запись уже удалена или устарела.');
    expect(errorText('demo_account_protected')).toBe('Демо-аккаунт удалить нельзя.');
    expect(errorText('validation_failed')).toBe('Проверьте ввод и попробуйте ещё раз.');
    expect(errorText('eaten_at_out_of_range')).toBe('Проверьте ввод и попробуйте ещё раз.');
    expect(errorText('too_many_bookings')).toBe(
      'У вас уже 3 активные брони. Лишнюю можно отменить в /bookings.',
    );
    expect(errorText('deal_sold_out')).toBe('Эту позицию уже разобрали. Посмотрим другое: /eat');
    expect(errorText('deal_not_found')).toBe('Позиция больше недоступна. Посмотрим другое: /eat');
    expect(errorText('booking_expired')).toBe('Бронь уже не активна.');
    expect(errorText('offer_not_found')).toBe('Не нашёл: запись уже удалена или устарела.');
    expect(errorText('offer_already_accepted')).toBe('По этому предложению уже есть бронь, код в /bookings.');
    expect(errorText('toString')).toBeNull();
    expect(errorText('something_else')).toBeNull();
  });
});
