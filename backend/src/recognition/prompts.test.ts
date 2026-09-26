import { describe, expect, it } from 'vitest';
import { MENU_CATEGORIES, TAGS } from '../domain/vocabulary.ts';
import { DISH_PHOTO_REQUEST, DISH_SYSTEM_PROMPT, MENU_PHOTO_REQUEST, MENU_SYSTEM_PROMPT } from './prompts.ts';

const ALL_TEXTS = [DISH_SYSTEM_PROMPT, MENU_SYSTEM_PROMPT, DISH_PHOTO_REQUEST, MENU_PHOTO_REQUEST];

describe('prompts', () => {
  it('lists every tag and menu category the schemas allow', () => {
    for (const tag of TAGS) {
      expect(DISH_SYSTEM_PROMPT).toContain(`${tag} (`);
      expect(MENU_SYSTEM_PROMPT).toContain(`${tag} (`);
    }
    for (const category of MENU_CATEGORIES) expect(MENU_SYSTEM_PROMPT).toContain(`${category} (`);
  });

  it('asks for calories of the whole visible portion and a not food answer', () => {
    expect(DISH_SYSTEM_PROMPT).toContain('на всю порцию, а не на 100 г');
    expect(DISH_SYSTEM_PROMPT).toContain('не больше 5 позиций');
    expect(DISH_SYSTEM_PROMPT).toContain('is_food = false');
  });

  it('forbids invented prices and sums composite weights', () => {
    expect(MENU_SYSTEM_PROMPT).toContain('null: цену не выдумывай');
    expect(MENU_SYSTEM_PROMPT).toContain('«180/150 г» сложи в 330');
  });

  it('is written in Russian without long dashes', () => {
    for (const text of ALL_TEXTS) {
      expect(text).toMatch(/[а-я]/);
      expect(text).not.toMatch(/[\u{2013}\u{2014}]/u);
    }
  });
});
