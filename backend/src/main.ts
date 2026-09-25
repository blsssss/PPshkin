import { loadConfig } from './config.ts';
import { createServices } from './container.ts';
import { loadMigrations, migrate } from './db/migrate.ts';
import { createPool } from './db/pool.ts';
import { buildApp } from './http/app.ts';
import { disabledRecognition } from './recognition/index.ts';
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
const services = createServices({
  config,
  pool,
  clock: systemClock,
  recognition: disabledRecognition(),
  background,
});
const app = await buildApp({ config, services });

if (config.DEMO_MODE) {
  app.log.warn('demo mode is on: demo bearer tokens grant access to the demo accounts');
}
if (!config.MAX_BOT_TOKEN) {
  app.log.warn('MAX_BOT_TOKEN is not set: sign in with MAX and the bot are disabled');
}

if (config.MIGRATE_ON_START) {
  const applied = await migrate(pool, await loadMigrations());
  app.log.info({ applied }, 'database migrations checked');
}

let closing = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await background.idle();
  await pool.end();
  process.exit(0);
};

process.once('SIGINT', (signal) => void shutdown(signal));
process.once('SIGTERM', (signal) => void shutdown(signal));

await app.listen({ host: config.HOST, port: config.PORT });
