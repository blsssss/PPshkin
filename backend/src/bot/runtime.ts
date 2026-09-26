import type { Config } from '../config.ts';
import type { Queryable } from '../db/pool.ts';
import type { MaxApi } from '../integrations/max/api.ts';
import { createDedupingHandler } from '../integrations/max/dedupe.ts';
import { createMaxMessenger } from '../integrations/max/messenger.ts';
import type { MaxLogger } from '../integrations/max/poller.ts';
import { realSleep, sleepUnlessAborted, type Sleep } from '../integrations/max/sleep.ts';
import { createMaxTransport, type MaxTransport } from '../integrations/max/transport.ts';
import type { Messenger, UpdateHandler } from '../ports/messenger.ts';
import type { Services } from '../services/index.ts';
import type { Clock } from '../shared/clock.ts';
import { BOT_COMMANDS } from './commands.ts';
import { withFallbackReply } from './failures.ts';
import { createBot } from './index.ts';
import { createChatStateStore, type ChatStateStore } from './state.ts';

const RETRY_DELAY_MS = 30_000;
const WEBHOOK_PATH = '/max/webhook';

export interface MaxBotSettings {
  mode: 'polling' | 'webhook';
  token: string;
  webhook: { url: string; secret: string } | null;
}

export function maxBotSettings(config: Config): MaxBotSettings | null {
  const token = config.MAX_BOT_TOKEN;
  if (token === undefined || config.BOT_MODE === 'off') return null;
  if (config.BOT_MODE === 'polling') return { mode: 'polling', token, webhook: null };
  const base = config.PUBLIC_BASE_URL;
  const secret = config.MAX_WEBHOOK_SECRET;
  if (base === undefined || secret === undefined) {
    throw new Error('BOT_MODE=webhook needs PUBLIC_BASE_URL and MAX_WEBHOOK_SECRET');
  }
  return { mode: 'webhook', token, webhook: { url: `${base.replace(/\/+$/, '')}${WEBHOOK_PATH}`, secret } };
}

export interface BotRuntimeOptions {
  settings: MaxBotSettings;
  api: MaxApi;
  pool: Queryable;
  services: Services;
  clock: Clock;
  logger: MaxLogger;
  miniAppEnabled: boolean;
  states?: ChatStateStore;
  sleep?: Sleep;
}

export interface BotRuntime {
  handle: UpdateHandler;
  messenger(): Messenger | null;
  start(): void;
  stop(): Promise<void>;
}

export function createBotRuntime(options: BotRuntimeOptions): BotRuntime {
  const { settings, api, pool, logger } = options;
  const states = options.states ?? createChatStateStore(pool);
  const sleep = options.sleep ?? realSleep;
  const lifetime = new AbortController();
  const stopped = () => lifetime.signal.aborted;
  const ready = Promise.withResolvers<UpdateHandler>();
  ready.promise.catch(() => undefined);
  let transport: MaxTransport | undefined;
  let liveMessenger: Messenger | null = null;
  let running: Promise<void> | undefined;

  async function launch(): Promise<UpdateHandler | null> {
    const me = await api.getMe();
    if (stopped()) return null;
    const messenger = createMaxMessenger(api, { botUsername: me.username, botUserId: me.user_id });
    const bot = createBot({
      pool,
      services: options.services,
      messenger,
      states,
      clock: options.clock,
      logger,
      bot: { username: me.username, userId: me.user_id },
      miniAppEnabled: options.miniAppEnabled,
    });
    const handler = withFallbackReply(createDedupingHandler(pool, bot), { messenger, logger });
    const started = createMaxTransport({
      mode: settings.mode,
      api,
      handler,
      logger,
      webhookUrl: settings.webhook?.url,
      webhookSecret: settings.webhook?.secret,
    });
    await started.start();
    if (stopped()) {
      await started.stop();
      return null;
    }
    transport = started;
    liveMessenger = messenger;
    return handler;
  }

  async function registerCommands(): Promise<void> {
    try {
      await api.setCommands([...BOT_COMMANDS]);
    } catch (error) {
      logger.warn({ err: error }, 'max bot commands were not registered');
    }
  }

  async function run(): Promise<void> {
    while (!stopped()) {
      try {
        const handler = await launch();
        if (handler === null) return;
        ready.resolve(handler);
        logger.info({ mode: settings.mode }, 'max bot started');
        await registerCommands();
        return;
      } catch (error) {
        if (stopped()) return;
        logger.error({ err: error, retryInMs: RETRY_DELAY_MS }, 'max bot failed to start, retrying');
        await sleepUnlessAborted(sleep, RETRY_DELAY_MS, lifetime.signal).catch(() => undefined);
      }
    }
  }

  return {
    messenger: () => liveMessenger,
    handle: async (event) => {
      const handler = await ready.promise;
      await handler(event);
    },
    start() {
      running ??= run();
    },
    async stop() {
      lifetime.abort();
      ready.reject(new Error('The bot stopped before it started'));
      await transport?.stop();
    },
  };
}
