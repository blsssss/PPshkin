import { describe, expect, it, vi } from 'vitest';
import { createBackgroundTasks } from './background.ts';

describe('background tasks', () => {
  it('runs tasks detached and waits for them on idle', async () => {
    const logger = { error: vi.fn() };
    const tasks = createBackgroundTasks(logger);
    const done: string[] = [];
    tasks.run('first', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      done.push('first');
    });
    tasks.run('second', () => {
      done.push('second');
      return Promise.resolve();
    });
    expect(tasks.pending).toBe(2);
    await tasks.idle();
    expect(done.sort()).toEqual(['first', 'second']);
    expect(tasks.pending).toBe(0);
  });

  it('logs failures instead of throwing', async () => {
    const logger = { error: vi.fn() };
    const tasks = createBackgroundTasks(logger);
    tasks.run('broken', () => Promise.reject(new Error('boom')));
    await tasks.idle();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'broken', err: expect.any(Error) as unknown }),
      'background task failed',
    );
  });

  it('refuses new tasks after stop and gives up waiting after the timeout', async () => {
    const logger = { error: vi.fn() };
    const tasks = createBackgroundTasks(logger);
    tasks.run('slow', () => new Promise((resolve) => setTimeout(resolve, 200)));
    tasks.stop();
    expect(tasks.run('late', () => Promise.resolve())).toBe(false);
    expect(await tasks.idle(10)).toBe(false);
    expect(logger.error).toHaveBeenCalledWith({ pending: 1 }, 'background tasks abandoned on shutdown');
    expect(await tasks.idle(1_000)).toBe(true);
  });

  it('survives a logger that throws', async () => {
    const tasks = createBackgroundTasks({
      error: () => {
        throw new Error('logger is broken');
      },
    });
    tasks.run('broken', () => Promise.reject(new Error('boom')));
    await expect(tasks.idle()).resolves.toBe(true);
  });

  it('waits for tasks started by other tasks', async () => {
    const tasks = createBackgroundTasks({ error: vi.fn() });
    const done: string[] = [];
    tasks.run('parent', () => {
      tasks.run('child', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        done.push('child');
      });
      return Promise.resolve();
    });
    await tasks.idle();
    expect(done).toEqual(['child']);
  });
});
