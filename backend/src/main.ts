import { createBotRuntime, maxBotSettings } from './bot/runtime.ts';
import { loadConfig } from './config.ts';
import { createServices } from './container.ts';
import { loadMigrations, migrate } from './db/migrate.ts';
import { createPool } from './db/pool.ts';
import { loadDemoDataset } from './demo/dataset.ts';
import { buildApp } from './http/app.ts';
import { createMaxApi } from './integrations/max/api.ts';
import type { MaxLogger } from './integrations/max/poller.ts';
import { createRecognition } from './recognition/index.ts';
import { createBackgroundTasks } from './shared/background.ts';
import { systemClock } from './shared/clock.ts';

const config = loadConfig(process.env);
const pool = createPool(config.DATABASE_URL, {
  max: config.DATABASE_POOL_SIZE,
  onError: (error) => {
    app.log.warn({ err: error }, 'idle database client failed');
  },
});
const background = createBackgroundTasks({
  error: (object, message) => {
    app.log.error(object, message);
  },
});
const recognition = createRecognition({
  apiKey: config.CHADGPT_API_KEY,
  baseUrl: config.CHADGPT_BASE_URL,
  visionModel: config.CHADGPT_MODEL,
  fallbackModel: config.CHADGPT_FALLBACK_MODEL,
  timeoutMs: config.CHADGPT_TIMEOUT_MS,
  menuTimeoutMs: config.CHADGPT_MENU_TIMEOUT_MS,
  logger: {
    info: (object, message) => {
      app.log.info(object, message);
    },
    warn: (object, message) => {
      app.log.warn(object, message);
    },
  },
});
const services = createServices({
  config,
  pool,
  clock: systemClock,
  recognition,
  background,
  demoDataset: config.DEMO_MODE ? await loadDemoDataset() : null,
});
const botLogger: MaxLogger = {
  debug: (object, message) => {
    app.log.debug(object, message);
  },
  info: (object, message) => {
    app.log.info(object, message);
  },
  warn: (object, message) => {
    app.log.warn(object, message);
  },
  error: (object, message) => {
    app.log.error(object, message);
  },
};
const botSettings = maxBotSettings(config);
const botRuntime =
  botSettings &&
  createBotRuntime({
    settings: botSettings,
    api: createMaxApi({ token: botSettings.token, baseUrl: config.MAX_API_BASE_URL }),
    pool,
    services,
    clock: systemClock,
    logger: botLogger,
    miniAppEnabled: config.MINI_APP_ENABLED,
  });
const webhook = botSettings?.webhook;
const app = await buildApp({
  config,
  services,
  maxWebhook:
    webhook && botRuntime ? { secret: webhook.secret, handler: botRuntime.handle, background } : undefined,
});

if (config.DEMO_MODE) {
  app.log.warn('demo mode is on: demo bearer tokens grant access to the demo accounts');
}
if (!config.MAX_BOT_TOKEN) {
  app.log.warn('MAX_BOT_TOKEN is not set: sign in with MAX and the bot are disabled');
} else if (config.BOT_MODE === 'off') {
  app.log.info('BOT_MODE=off: the MAX bot is not started');
}
if (!config.CHADGPT_API_KEY) {
  app.log.warn('CHADGPT_API_KEY is not set: photo recognition is disabled, text uses offline fallbacks');
}

if (config.MIGRATE_ON_START) {
  const applied = await migrate(pool, await loadMigrations());
  app.log.info({ applied }, 'database migrations checked');
}
if (services.demo.enabled) {
  app.log.info({ demo: await services.demo.seed() }, 'demo data seeded');
}

let closing = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  await botRuntime?.stop();
  background.stop();
  await app.close();
  await background.idle(10_000);
  await pool.end();
  process.exit(0);
};

process.once('SIGINT', (signal) => void shutdown(signal));
process.once('SIGTERM', (signal) => void shutdown(signal));

await app.listen({ host: config.HOST, port: config.PORT });
botRuntime?.start();
