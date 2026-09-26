import { describe, expect, it } from 'vitest';
import { buildStartAppLink, parseStartParam, resolveStartParam } from './startParam.ts';

describe('parseStartParam', () => {
  it.each([
    [null, '/diary'],
    ['', '/diary'],
    ['venue_1', '/venues/1'],
    ['venue_900001', '/venues/900001'],
    ['deal_42', '/deals?highlight=42'],
    ['booking_7', '/bookings/7'],
  ])('%s opens %s', (value, path) => {
    expect(parseStartParam(value)).toBe(path);
    expect(resolveStartParam(value).recognized).toBe(true);
  });

  it.each(['unknown', 'venue_', 'venue_abc', 'venue_0', 'deal_1_2', 'booking_-1', 'import_5', 'v_1'])(
    '%s falls back to the diary with a toast',
    (value) => {
      expect(resolveStartParam(value)).toEqual({ path: '/diary', recognized: false });
    },
  );
});

describe('buildStartAppLink', () => {
  it('builds a MAX link', () => {
    expect(buildStartAppLink('venue_1', 'ppshkin_bot')).toBe('https://max.ru/ppshkin_bot?startapp=venue_1');
    expect(buildStartAppLink('A-z_0-9', 'bot')).toBe('https://max.ru/bot?startapp=A-z_0-9');
  });

  it('accepts exactly 512 characters', () => {
    expect(buildStartAppLink('a'.repeat(512), 'bot')).toContain('startapp=');
  });

  it.each(['', 'a'.repeat(513), 'venue 1', 'venue.1', 'кафе_1', 'a&b=c', 'venue/1'])(
    'rejects %j',
    (payload) => {
      expect(() => buildStartAppLink(payload, 'bot')).toThrow();
    },
  );
});
