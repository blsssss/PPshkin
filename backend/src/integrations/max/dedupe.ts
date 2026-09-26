import type { Queryable } from '../../db/pool.ts';
import type { UpdateHandler } from '../../ports/messenger.ts';
import { markProcessed } from '../../repositories/processed-updates.ts';

export function createDedupingHandler(db: Queryable, handler: UpdateHandler): UpdateHandler {
  return async (event) => {
    if (await markProcessed(db, event.key)) await handler(event);
  };
}
