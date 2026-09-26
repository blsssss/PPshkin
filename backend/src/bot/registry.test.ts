import { describe, expect, it, vi } from 'vitest';
import type { BotContext, BotModule } from './context.ts';
import { createRegistry } from './registry.ts';

const noop = () => Promise.resolve();
const flowNoop = () => Promise.resolve(false);

describe('bot registry', () => {
  it('collects handlers of several modules', () => {
    const registry = createRegistry();
    const today = vi.fn(noop);
    const meals = vi.fn(noop);
    const text = vi.fn(noop);
    registry.add({ commands: { today }, callbacks: { ml: meals }, flows: { meal_fix: flowNoop } });
    registry.add({ commands: { profile: noop }, callbacks: { pf: noop }, text });

    expect(registry.command('today')).toBe(today);
    expect(registry.callback('ml')).toBe(meals);
    expect(registry.flow('meal_fix')).toBe(flowNoop);
    expect(registry.command('eat')).toBeUndefined();
    expect(registry.callback('of')).toBeUndefined();
    expect(registry.flow('meal_manual')).toBeUndefined();
    expect(registry.messages()).toEqual({ location: undefined, photos: undefined, text });
  });

  it.each<[string, BotModule, BotModule, RegExp]>([
    ['command', { commands: { today: noop } }, { commands: { today: noop } }, /Command "today"/],
    ['callback prefix', { callbacks: { ml: noop } }, { callbacks: { ml: noop } }, /Callback prefix "ml"/],
    ['flow', { flows: { meal_fix: flowNoop } }, { flows: { meal_fix: flowNoop } }, /Flow "meal_fix"/],
    ['start link', { startLinks: { v: noop } }, { startLinks: { v: noop } }, /Start link "v"/],
    ['location handler', { location: noop }, { location: noop }, /Location handler/],
    ['photo handler', { photos: noop }, { photos: noop }, /Photo handler/],
    ['text handler', { text: noop }, { text: noop }, /Text handler/],
  ])('refuses a %s registered by two modules', (_kind, first, second, message) => {
    const registry = createRegistry();
    registry.add(first);
    expect(() => {
      registry.add(second);
    }).toThrow(message);
  });

  it.each<[BotModule, RegExp]>([
    [{ callbacks: { cmd: noop } }, /Callback prefix "cmd" has an invalid name/],
    [{ callbacks: { 'm:l': noop } }, /Callback prefix "m:l"/],
    [{ callbacks: { ML: noop } }, /Callback prefix "ML"/],
    [{ commands: { 'Today!': noop } }, /Command "Today!"/],
  ])('refuses invalid names in %j', (module, message) => {
    expect(() => {
      createRegistry().add(module);
    }).toThrow(message);
  });

  it('opens start links of registered kinds only', async () => {
    const registry = createRegistry();
    const venue = vi.fn(noop);
    registry.add({ startLinks: { v: venue } });
    const ctx = {} as BotContext;

    await expect(registry.openStartLink(ctx, { kind: 'v', value: '12' })).resolves.toBe(true);
    expect(venue).toHaveBeenCalledWith(ctx, '12');
    await expect(registry.openStartLink(ctx, { kind: 'r', value: 'K7M2QX' })).resolves.toBe(false);
  });
});
