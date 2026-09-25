import type { Queryable } from '../db/pool.ts';

export interface HealthService {
  databaseReachable(): Promise<boolean>;
}

export function createHealthService(db: Queryable): HealthService {
  return {
    async databaseReachable() {
      try {
        await db.query('select 1');
        return true;
      } catch {
        return false;
      }
    },
  };
}
