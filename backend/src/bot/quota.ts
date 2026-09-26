export interface Quota {
  take(userId: number, now: Date): boolean;
}

export function createQuota({ limit, windowMs }: { limit: number; windowMs: number }): Quota {
  const usage = new Map<number, number[]>();
  let sweptAt = Number.NEGATIVE_INFINITY;

  const sweep = (now: number) => {
    if (now - sweptAt < windowMs) return;
    sweptAt = now;
    for (const [userId, times] of usage) {
      if (times.every((time) => time <= now - windowMs)) usage.delete(userId);
    }
  };

  return {
    take(userId, now) {
      const time = now.getTime();
      sweep(time);
      const recent = (usage.get(userId) ?? []).filter((used) => used > time - windowMs);
      const allowed = recent.length < limit;
      if (allowed) recent.push(time);
      usage.set(userId, recent);
      return allowed;
    },
  };
}
