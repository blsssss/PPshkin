import { describe, expect, it, vi } from 'vitest';
import { sleepUnlessAborted } from './sleep.ts';

describe('sleepUnlessAborted', () => {
  it('sleeps the whole time when nothing aborts it', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    await sleepUnlessAborted(sleep, 250);
    await sleepUnlessAborted(sleep, 500, controller.signal);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('wakes up with the abort reason', async () => {
    const controller = new AbortController();
    const pending = sleepUnlessAborted(() => new Promise<void>(() => undefined), 30_000, controller.signal);
    controller.abort(new Error('stopping'));
    await expect(pending).rejects.toThrow('stopping');
  });

  it('does not sleep when already aborted', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    await expect(sleepUnlessAborted(sleep, 1000, AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(sleep).not.toHaveBeenCalled();
  });
});
