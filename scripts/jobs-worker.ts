import cron from 'node-cron';
import { createDatabase, runMarketRunsJob } from '../packages/db/src/index.js';
if (process.env.JOBS_WORKER_DISABLED === '1') {
  console.log('Local job worker disabled for isolated E2E tests.');
} else {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { db, pool } = createDatabase(process.env.DATABASE_URL);
  pool.on('error', (error) =>
    console.error('Job worker database error', error),
  );
  let active: Promise<void> | undefined;
  function execute() {
    if (active) return active;
    active = runMarketRunsJob(db, 'worker')
      .then((result) =>
        console.log(JSON.stringify({ job: 'generate-market-runs', ...result })),
      )
      .catch((error) => console.error('Market scheduling job failed', error))
      .finally(() => {
        active = undefined;
      });
    return active;
  }
  const task = cron.schedule('0 12 * * *', execute, {
    timezone: 'UTC',
    noOverlap: true,
  });
  console.log(
    'Market scheduling worker: daily at 12:00 UTC, plus once on startup.',
  );
  void execute();
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void (async () => {
        await task.stop();
        await active;
        await pool.end();
        await task.destroy();
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    });
}
