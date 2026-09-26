import { describe, expect, it, vi } from 'vitest';
import { createUserQueue } from './user-queue.ts';

function gate() {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  return {
    promise,
    open: () => {
      resolve(undefined);
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('user queue', () => {
  it('runs tasks of one user one after another and tasks of different users at once', async () => {
    const queue = createUserQueue();
    const gates = { a1: gate(), b1: gate(), a2: gate() };
    const started: string[] = [];
    const task = (name: keyof typeof gates) => async () => {
      started.push(name);
      await gates[name].promise;
    };

    const runs = [queue.run(1, task('a1')), queue.run(2, task('b1')), queue.run(1, task('a2'))];
    await vi.waitFor(() => {
      expect(started).toEqual(['a1', 'b1']);
    });

    gates.b1.open();
    await settle();
    expect(started).toEqual(['a1', 'b1']);

    gates.a1.open();
    await vi.waitFor(() => {
      expect(started).toEqual(['a1', 'b1', 'a2']);
    });
    gates.a2.open();
    await expect(Promise.all(runs)).resolves.toEqual([undefined, undefined, undefined]);
  });

  it('passes a failure to its caller and still runs the next task of that user', async () => {
    const queue = createUserQueue();
    const failure = new Error('handler crashed');
    const next = vi.fn(() => Promise.resolve());

    const failed = queue.run(1, () => Promise.reject(failure));
    const following = queue.run(1, next);

    await expect(failed).rejects.toBe(failure);
    await expect(following).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('turns a task that throws before returning a promise into a rejection', async () => {
    const queue = createUserQueue();
    const failure = new Error('thrown synchronously');
    const run = queue.run(1, () => {
      throw failure;
    });
    await expect(run).rejects.toBe(failure);
    await expect(queue.run(1, () => Promise.resolve())).resolves.toBeUndefined();
  });
});
