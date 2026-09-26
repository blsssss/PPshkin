import { describe, expect, it } from 'vitest';
import { sampleMenuItem } from '../../../test/venues.ts';
import { MESSAGE_LIMIT } from '../texts.ts';
import * as texts from './texts.ts';
import { hoursLabel, importAppliedText, menuText } from './texts.ts';

describe('venue texts', () => {
  it('keep every fixed text within the MAX message limit', () => {
    const fixed = Object.values(texts).filter((value): value is string => typeof value === 'string');
    expect(fixed.length).toBeGreaterThan(30);
    for (const text of fixed) expect(text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
  });

  it('keep button texts within the MAX limit', () => {
    for (const label of Object.values(texts.VENUE_BUTTONS)) expect(label.length).toBeLessThanOrEqual(128);
  });

  it('agree the numbers of added and skipped items', () => {
    expect(importAppliedText(1, [])).toBe('Добавлена 1 позиция.');
    expect(importAppliedText(21, [])).toBe('Добавлена 21 позиция.');
    expect(importAppliedText(3, ['Морс'])).toBe(
      'Добавлено 3 позиции. Без цены пропущена 1: Морс. Их можно добавить в кабинете.',
    );
    expect(importAppliedText(11, ['Эклер', 'Круассан', 'Морс'])).toBe(
      'Добавлено 11 позиций. Без цены пропущено 3: Эклер, Круассан, Морс. Их можно добавить в кабинете.',
    );
  });

  it('lists at most ten skipped names', () => {
    const skipped = Array.from({ length: 12 }, (_, index) => `Позиция ${index + 1}`);
    expect(importAppliedText(0, skipped)).toBe(
      `Добавлено 0 позиций. Без цены пропущено 12: ${skipped.slice(0, 10).join(', ')} и ещё 2. Их можно добавить в кабинете.`,
    );
  });

  it('describes opening hours', () => {
    expect(hoursLabel('08:00', '22:00')).toBe('08:00-22:00');
    expect(hoursLabel('18:00', '02:00')).toBe('18:00-02:00, закрытие после полуночи');
    expect(hoursLabel('00:00', '00:00')).toBe('круглосуточно');
  });

  it('shortens the menu to fit a single message', () => {
    const items = Array.from({ length: 60 }, (_, index) => ({
      ...sampleMenuItem,
      id: index + 1,
      name: `${'Очень длинное название позиции '.repeat(2)}${index}`,
    }));

    const text = menuText(items);

    expect(text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(text).toMatch(/\n\nи ещё \d+, полный список в кабинете$/);
  });
});
