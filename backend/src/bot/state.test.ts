import { describe, expect, it } from 'vitest';
import { eclairCard } from '../../test/offers.ts';
import { EMPTY_CHAT_STATE, FLOW_TTL_MS, isExpired, parseChatState, startFlow } from './state.ts';

const NOW = new Date('2026-09-26T09:00:00Z');
const LATER = '2026-09-26T09:30:00.000Z';

describe('chat state', () => {
  it('starts a flow that lives for 30 minutes', () => {
    const flow = startFlow({ name: 'meal_fix', mealId: 5 }, NOW);
    expect(flow).toEqual({ name: 'meal_fix', mealId: 5, expiresAt: LATER });
    expect(isExpired(flow, new Date(NOW.getTime() + FLOW_TTL_MS - 1))).toBe(false);
    expect(isExpired(flow, new Date(NOW.getTime() + FLOW_TTL_MS))).toBe(true);
  });

  it('reads every kind of flow', () => {
    const flows = [
      { name: 'kcal_input', from: 'pf' },
      { name: 'onboarding_location' },
      { name: 'eat_location' },
      { name: 'meal_fix', mealId: 1 },
      { name: 'meal_manual' },
      { name: 'meal_text_confirm', text: 'борщ', messageId: 'mid.1' },
      {
        name: 'meal_candidates',
        messageId: 'mid.2',
        candidates: [
          {
            title: 'Плов',
            portionG: null,
            kcalMin: 400,
            kcalMax: 550,
            proteinG: 12,
            fatG: 18,
            carbsG: 60,
            tags: ['rice'],
            confidence: 0.3,
          },
        ],
      },
    ];
    for (const flow of flows) {
      const stored = { ...EMPTY_CHAT_STATE, flow: { ...flow, expiresAt: LATER }, pendingStart: 'v_7' };
      expect(parseChatState(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    }
  });

  it('keeps the offer queue and the date of the last meal hint', () => {
    const stored = {
      ...EMPTY_CHAT_STATE,
      offerQueue: {
        messageId: 'mid.7',
        cards: [eclairCard, { ...eclairCard, offerId: 502 }],
        expiresAt: LATER,
      },
      contextualOfferOn: '2026-09-26',
    };
    expect(parseChatState(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it('drops unknown tags of stored offer cards', () => {
    const state = parseChatState({
      offerQueue: {
        messageId: 'mid.7',
        cards: [{ ...eclairCard, tags: ['sweet', 'retired_tag'] }],
        expiresAt: LATER,
      },
    });
    expect(state.offerQueue?.cards[0]?.tags).toEqual(['sweet']);
  });

  it('drops unknown tags of stored candidates', () => {
    const state = parseChatState({
      flow: {
        name: 'meal_candidates',
        messageId: 'mid.2',
        expiresAt: LATER,
        candidates: [
          {
            title: 'Плов',
            portionG: 300,
            kcalMin: 400,
            kcalMax: 550,
            proteinG: 12,
            fatG: 18,
            carbsG: 60,
            tags: ['rice', 'retired_tag'],
            confidence: 0.3,
          },
        ],
      },
    });
    expect(state.flow).toMatchObject({ candidates: [{ tags: ['rice'] }] });
  });

  it('fills fields that older records do not have', () => {
    expect(parseChatState({})).toEqual(EMPTY_CHAT_STATE);
    expect(parseChatState({ flow: null, pendingStart: null })).toEqual({
      flow: null,
      offerQueue: null,
      pendingStart: null,
      contextualOfferOn: null,
    });
  });

  it.each([
    null,
    'garbage',
    42,
    [],
    { flow: { name: 'meal_fix', mealId: 'seven', expiresAt: LATER } },
    { flow: { name: 'meal_fix', mealId: 1 } },
    { flow: { name: 'meal_fix', mealId: 1, expiresAt: 'tomorrow' } },
    { flow: { name: 'time_travel', expiresAt: LATER } },
    { flow: { name: 'meal_candidates', candidates: [], messageId: 'mid.1', expiresAt: LATER } },
    { flow: null, pendingStart: 12 },
    { flow: null, pendingStart: 'v'.repeat(129) },
    { offerQueue: { messageId: 'mid.7', cards: [], expiresAt: LATER } },
    { offerQueue: { messageId: 'mid.7', cards: [{ ...eclairCard, offerId: 0 }], expiresAt: LATER } },
    { offerQueue: { cards: [eclairCard], expiresAt: LATER } },
    { contextualOfferOn: '26.09.2026' },
  ])('turns the broken record %j into an empty state', (raw) => {
    expect(parseChatState(raw)).toEqual(EMPTY_CHAT_STATE);
  });
});
