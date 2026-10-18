import { runRevokeSessions } from '../auth/revocation.ts';
import { loadConfig } from '../config.ts';
import { createPool } from '../db/pool.ts';

const config = loadConfig(process.env);
const pool = createPool(config.DATABASE_URL, {
  max: 1,
  onError: (error) => {
    process.stderr.write(`database client failed: ${error.message}\n`);
  },
});

try {
  process.exitCode = await runRevokeSessions(process.argv.slice(2), {
    db: pool,
    stdout: process.stdout,
    stderr: process.stderr,
  });
} finally {
  await pool.end();
}
