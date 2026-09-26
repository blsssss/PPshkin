export interface BackgroundLogger {
  error(object: object, message: string): void;
}

export interface BackgroundTasks {
  run(name: string, task: () => Promise<unknown>): boolean;
  idle(timeoutMs?: number): Promise<boolean>;
  stop(): void;
  readonly pending: number;
}

export function createBackgroundTasks(logger: BackgroundLogger): BackgroundTasks {
  const running = new Set<Promise<void>>();
  let stopped = false;

  const report = (object: object, message: string) => {
    try {
      logger.error(object, message);
    } catch {
      return;
    }
  };

  const settled = async () => {
    while (running.size > 0) {
      await Promise.all(running);
    }
  };

  return {
    run(name, task) {
      if (stopped) {
        report({ task: name }, 'background task rejected during shutdown');
        return false;
      }
      const tracked = Promise.resolve()
        .then(task)
        .then(
          () => undefined,
          (error: unknown) => {
            report({ err: error, task: name }, 'background task failed');
          },
        )
        .finally(() => running.delete(tracked));
      running.add(tracked);
      return true;
    },
    async idle(timeoutMs) {
      if (timeoutMs === undefined) {
        await settled();
        return true;
      }
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<false>((resolve) => {
        timer = setTimeout(() => {
          resolve(false);
        }, timeoutMs);
      });
      const finished = await Promise.race([settled().then(() => true as const), timedOut]);
      clearTimeout(timer);
      if (!finished) {
        report({ pending: running.size }, 'background tasks abandoned on shutdown');
      }
      return finished;
    },
    stop() {
      stopped = true;
    },
    get pending() {
      return running.size;
    },
  };
}
