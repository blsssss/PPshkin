import type { Queryable } from '../db/pool.ts';
import type { MaxLogger } from '../integrations/max/poller.ts';
import type { Messenger, UpdateHandler } from '../ports/messenger.ts';
import type { Services } from '../services/index.ts';
import type { Clock } from '../shared/clock.ts';
import type { BotKit } from './context.ts';
import { createMealsModule } from './guest/meals.ts';
import { createOnboardingModule } from './guest/onboarding.ts';
import { createProfileModule } from './guest/profile.ts';
import { createVenuesModule } from './guest/venues.ts';
import { createRegistry } from './registry.ts';
import { createRouter } from './router.ts';
import type { ChatStateStore } from './state.ts';

export interface BotDependencies {
  pool: Queryable;
  services: Services;
  messenger: Messenger;
  states: ChatStateStore;
  clock: Clock;
  logger: MaxLogger;
  bot: { username: string; userId: number };
  miniAppEnabled: boolean;
}

const GUEST_MODULES = [createOnboardingModule, createMealsModule, createProfileModule, createVenuesModule];

export function createBot(deps: BotDependencies): UpdateHandler {
  const registry = createRegistry();
  const kit: BotKit = {
    services: deps.services,
    messenger: deps.messenger,
    states: deps.states,
    logger: deps.logger,
    openStartLink: (ctx, link) => registry.openStartLink(ctx, link),
  };
  for (const createModule of GUEST_MODULES) registry.add(createModule(kit));
  return createRouter({
    db: deps.pool,
    services: deps.services,
    messenger: deps.messenger,
    states: deps.states,
    clock: deps.clock,
    logger: deps.logger,
    registry,
    bot: deps.bot,
    miniAppEnabled: deps.miniAppEnabled,
  });
}
