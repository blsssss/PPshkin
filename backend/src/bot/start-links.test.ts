import { describe, expect, it } from 'vitest';
import { formatStartLink, parseStartLink } from './start-links.ts';

describe('start links', () => {
  it.each([
    ['v_12', { kind: 'v', value: '12' }],
    ['d_7', { kind: 'd', value: '7' }],
    ['r_K7M2QX', { kind: 'r', value: 'K7M2QX' }],
    [' v_12 ', { kind: 'v', value: '12' }],
    [`d_${'9'.repeat(32)}`, { kind: 'd', value: '9'.repeat(32) }],
  ])('parses %j', (payload, link) => {
    expect(parseStartLink(payload)).toEqual(link);
  });

  it.each([null, '', 'v_', 'x_12', 'V_12', 'v-12', 'v_1_2', 'v_12!', `d_${'9'.repeat(33)}`, 'promo'])(
    'ignores %j',
    (payload) => {
      expect(parseStartLink(payload)).toBeNull();
    },
  );

  it('formats a link back into a payload', () => {
    expect(formatStartLink({ kind: 'v', value: '12' })).toBe('v_12');
  });
});
