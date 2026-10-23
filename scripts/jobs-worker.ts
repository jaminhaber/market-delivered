import cron from 'node-cron';
import {
  createDatabase,
  runMarketRunsJob,
  runCloseMarketsJob,
} from '../packages/db/src/index.js';
if (process.env.JOBS_WORKER_DISABLED === '1') {
  console.log('Local job worker disabled for isolated E2E tests.');
} else {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { db, pool } = createDatabase(process.env.DATABASE_URL);
  pool.on('error', (error) =>
    console.error('Job worker database error', error),
  );
  const jobs = [
    {
      name: 'generate-market-runs',
      schedule: '0 12 * * *',
      run: runMarketRunsJob,
    },
    {
      name: 'close-expired-markets',
      schedule: '* * * * *',
      run: runCloseMarketsJob,
    },
  ].map((job) => {
    let active: Promise<void> | undefined;
    function execute() {
      if (active) return active;
      active = job
        .run(db, 'worker')
        .then((result) =>
          console.log(JSON.stringify({ job: job.name, ...result })),
        )
        .catch((error) => console.error(`${job.name} failed`, error))
        .finally(() => {
          active = undefined;
        });
      return active;
    }
    const task = cron.schedule(job.schedule, execute, {
      timezone: 'UTC',
      noOverlap: true,
    });
    return { task, execute, finish: () => active };
  });
  console.log(
    'Job worker: market generation daily at 12:00 UTC; market closing every minute; both once on startup.',
  );
  for (const job of jobs) void job.execute();
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void (async () => {
        await Promise.all(jobs.map((job) => job.task.stop()));
        await Promise.all(jobs.map((job) => job.finish()));
        await pool.end();
        await Promise.all(jobs.map((job) => job.task.destroy()));
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    });
}
