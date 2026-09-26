import { describe, expect, it } from 'vitest';
import { CONSENT_DOCUMENTS } from './consents.ts';
import { CONSENT_KINDS } from './vocabulary.ts';

const longDashes = [String.fromCodePoint(0x2013), String.fromCodePoint(0x2014)];

describe('consent documents', () => {
  it('has a document for every consent kind with the current version', () => {
    expect(Object.keys(CONSENT_DOCUMENTS)).toEqual([...CONSENT_KINDS]);
    for (const kind of CONSENT_KINDS) {
      expect(CONSENT_DOCUMENTS[kind].version).toBe('2026-09-25');
    }
  });

  it('requires only the personal data consent', () => {
    expect(CONSENT_DOCUMENTS.personal_data.required).toBe(true);
    expect(CONSENT_DOCUMENTS.personalized_offers.required).toBe(false);
  });

  it('names every item that the personal data law requires in a consent', () => {
    const { title, text } = CONSENT_DOCUMENTS.personal_data;
    expect(title).toBe('Согласие на обработку персональных данных');
    for (const item of [
      'оператор',
      'Цели: ведение дневника питания, расчёт ориентира калорийности, подбор блюд в заведениях.',
      'идентификатор и имя в MAX',
      'записи о приёмах пищи, оценки калорийности и БЖУ',
      'настройки и цели',
      'с точностью около 1 км',
      'Действия: сбор, запись, систематизация, хранение, уточнение, использование, удаление.',
      'без моих идентификаторов и не сохраняются',
      'Срок: до отзыва согласия или удаления аккаунта.',
      'команда /delete в боте или удаление аккаунта в мини-приложении',
      'не являются медицинской рекомендацией',
      'диагнозы, не собираются',
    ]) {
      expect(text).toContain(item);
    }
  });

  it('limits personalized offers and explains how to switch them off', () => {
    const { title, text } = CONSENT_DOCUMENTS.personalized_offers;
    expect(title).toBe('Согласие на персональные предложения');
    expect(text).toContain('Не чаще 2 раз в день');
    expect(text).toContain('отключить в любой момент одной кнопкой');
  });

  it('avoids long dash characters in titles and texts', () => {
    for (const document of Object.values(CONSENT_DOCUMENTS)) {
      expect(
        longDashes.filter((dash) => document.title.includes(dash) || document.text.includes(dash)),
      ).toEqual([]);
    }
  });
});
