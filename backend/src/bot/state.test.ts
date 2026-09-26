import { describe, expect, it } from 'vitest';
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
      const stored = { flow: { ...flow, expiresAt: LATER }, pendingStart: 'v_7' };
      expect(parseChatState(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    }
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
    expect(parseChatState({ flow: null })).toEqual({ flow: null, pendingStart: null });
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
  ])('turns the broken record %j into an empty state', (raw) => {
    expect(parseChatState(raw)).toEqual(EMPTY_CHAT_STATE);
  });
});
