export interface UserQueue {
  run(userId: number, task: () => Promise<void>): Promise<void>;
}

export function createUserQueue(): UserQueue {
  const tails = new Map<number, Promise<void>>();
  return {
    run(userId, task) {
      const turn = (tails.get(userId) ?? Promise.resolve()).then(() => task());
      const tail: Promise<void> = turn
        .catch(() => undefined)
        .then(() => {
          if (tails.get(userId) === tail) tails.delete(userId);
        });
      tails.set(userId, tail);
      return turn;
    },
  };
}
