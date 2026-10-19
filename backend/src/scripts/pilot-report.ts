import { createPool } from '../db/pool.ts';
import { buildPilotReport, parseReportArgs, renderPilotReport } from '../services/pilot-report.ts';
import { systemClock } from '../shared/clock.ts';

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  process.stderr.write('DATABASE_URL is not set\n');
  process.exit(1);
}

let query: ReturnType<typeof parseReportArgs>;
try {
  query = parseReportArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const pool = createPool(databaseUrl, {
  max: 2,
  onError: (error) => {
    process.stderr.write(`idle database client failed: ${error.message}\n`);
  },
});
try {
  process.stdout.write(
    renderPilotReport(await buildPilotReport(pool, query, systemClock.now()), query.format),
  );
} finally {
  await pool.end();
}
