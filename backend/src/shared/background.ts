export interface BackgroundLogger {
  error(object: object, message: string): void;
}

export interface BackgroundTasks {
  run(name: string, task: () => Promise<unknown>): void;
  idle(): Promise<void>;
  readonly pending: number;
}

export function createBackgroundTasks(logger: BackgroundLogger): BackgroundTasks {
  const running = new Set<Promise<void>>();
  return {
    run(name, task) {
      const tracked = Promise.resolve()
        .then(task)
        .then(
          () => undefined,
          (error: unknown) => {
            logger.error({ err: error, task: name }, 'background task failed');
          },
        )
        .finally(() => running.delete(tracked));
      running.add(tracked);
    },
    async idle() {
      while (running.size > 0) {
        await Promise.all(running);
      }
    },
    get pending() {
      return running.size;
    },
  };
}
