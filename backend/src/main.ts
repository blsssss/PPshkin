import { loadConfig } from './config.ts';
import { createServices } from './container.ts';
import { loadMigrations, migrate } from './db/migrate.ts';
import { createPool } from './db/pool.ts';
import { buildApp } from './http/app.ts';
import { systemClock } from './shared/clock.ts';

const config = loadConfig(process.env);
const pool = createPool(config.DATABASE_URL, {
  max: config.DATABASE_POOL_SIZE,
  onError: (error) => {
    app.log.warn({ err: error }, 'idle database client failed');
  },
});
const services = createServices({ config, pool, clock: systemClock });
const app = await buildApp({ config, services });

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
  await pool.end();
  process.exit(0);
};

process.once('SIGINT', (signal) => void shutdown(signal));
process.once('SIGTERM', (signal) => void shutdown(signal));

await app.listen({ host: config.HOST, port: config.PORT });
