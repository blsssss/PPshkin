import type { MenuImportsService } from '../services/menu-imports.ts';
import type { Job } from './scheduler.ts';

export function failStaleImportsJob(menuImports: Pick<MenuImportsService, 'failStale'>): Job {
  return {
    name: 'fail_stale_imports',
    schedule: { everyMs: 5 * 60_000 },
    run: async (now) => {
      await menuImports.failStale(now);
    },
  };
}
