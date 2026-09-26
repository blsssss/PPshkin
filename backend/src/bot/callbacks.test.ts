import { describe, expect, it, vi } from 'vitest';
import { byAction, parseId, parsePayload, payload } from './callbacks.ts';
import type { BotContext } from './context.ts';

describe('callback payloads', () => {
  it('joins parts with colons', () => {
    expect(payload('ml', 'fix', 42)).toBe('ml:fix:42');
    expect(payload('of', 'dl', 7, 'sweet,dessert')).toBe('of:dl:7:sweet,dessert');
  });

  it('refuses payloads MAX would reject or that carry user text', () => {
    expect(() => payload('ml', 'x'.repeat(1024))).toThrow(/1024/);
    expect(() => payload('ml', 'борщ')).toThrow(/ASCII/);
    expect(() => payload('ml', 'two words')).toThrow(/ASCII/);
  });

  it('splits a payload into a prefix and arguments', () => {
    expect(parsePayload('ml:del:42:t')).toEqual({ prefix: 'ml', args: ['del', '42', 't'] });
    expect(parsePayload('cmd')).toEqual({ prefix: 'cmd', args: [] });
  });

  it.each(['', ':ok', 'ml:борщ', 'x'.repeat(1025), 'ml:a b'])('rejects %j', (raw) => {
    expect(parsePayload(raw)).toBeNull();
  });

  it('reads positive ids only', () => {
    expect(parseId('42')).toBe(42);
    expect(parseId('999999999999999')).toBe(999_999_999_999_999);
    for (const value of [undefined, '', '0', '-1', '01', '1.5', '1e3', '9999999999999999']) {
      expect(parseId(value)).toBeNull();
    }
  });
});

describe('byAction', () => {
  function fakeContext() {
    return { answer: vi.fn(() => Promise.resolve()) } as unknown as BotContext & {
      answer: ReturnType<typeof vi.fn>;
    };
  }

  it('dispatches on the first argument and passes the rest', async () => {
    const fix = vi.fn(() => Promise.resolve());
    const ctx = fakeContext();
    await byAction({ fix })(ctx, ['fix', '42', 't']);
    expect(fix).toHaveBeenCalledWith(ctx, ['42', 't']);
  });

  it.each([[[]], [['unknown']], [['toString']]])('answers %j as a stale button', async (args) => {
    const ctx = fakeContext();
    await byAction({ fix: vi.fn() })(ctx, args);
    expect(ctx.answer).toHaveBeenCalledWith({ notification: 'Кнопка устарела' });
  });
});
