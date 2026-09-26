import type { UpdateHandler } from '../../ports/messenger.ts';
import type { MaxApi } from './api.ts';
import { createPoller, type MaxLogger, type Poller } from './poller.ts';
import { MAX_UPDATE_TYPES } from './updates.ts';

export interface MaxTransportOptions {
  mode: 'polling' | 'webhook';
  api: MaxApi;
  handler: UpdateHandler;
  logger: MaxLogger;
  webhookUrl?: string;
  webhookSecret?: string;
}

export interface MaxTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
}

function createPollingTransport(api: MaxApi, handler: UpdateHandler, logger: MaxLogger): MaxTransport {
  let poller: Poller | undefined;
  return {
    async start() {
      if (poller) return;
      const subscriptions = await api.listSubscriptions();
      for (const subscription of subscriptions) {
        await api.unsubscribe(subscription.url);
      }
      if (subscriptions.length > 0) {
        logger.warn({ removed: subscriptions.length }, 'max webhook subscriptions removed to allow polling');
      }
      poller = createPoller({ api, handler, logger, types: MAX_UPDATE_TYPES });
      poller.start().catch((error: unknown) => {
        logger.error({ err: error }, 'max polling stopped unexpectedly');
      });
      logger.info({ mode: 'polling' }, 'max transport started');
    },
    async stop() {
      await poller?.stop();
    },
  };
}

function createWebhookTransport(api: MaxApi, logger: MaxLogger, url: string, secret: string): MaxTransport {
  return {
    async start() {
      await api.subscribe(url, secret, MAX_UPDATE_TYPES);
      const stale = (await api.listSubscriptions()).filter((subscription) => subscription.url !== url);
      for (const subscription of stale) {
        await api.unsubscribe(subscription.url);
      }
      logger.info({ mode: 'webhook', removed: stale.length }, 'max transport started');
    },
    stop: () => Promise.resolve(),
  };
}

export function createMaxTransport(options: MaxTransportOptions): MaxTransport {
  const { mode, api, handler, logger, webhookUrl, webhookSecret } = options;
  if (mode === 'polling') return createPollingTransport(api, handler, logger);
  if (!webhookUrl || !webhookSecret) {
    throw new Error('MAX webhook mode needs webhookUrl and webhookSecret');
  }
  return createWebhookTransport(api, logger, webhookUrl, webhookSecret);
}
