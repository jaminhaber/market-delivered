import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../packages/db/src/index.js';
const databaseURL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://market:market@localhost:5433/market_delivered_e2e';
if (!new URL(databaseURL).pathname.endsWith('_e2e'))
  throw new Error(
    'E2E_DATABASE_URL must name an isolated database ending in _e2e',
  );
const { db, pool } = createDatabase(databaseURL);
try {
  await migrate(db, {
    migrationsFolder: fileURLToPath(
      new URL('../packages/db/drizzle', import.meta.url),
    ),
  });
  // This runner only accepts an isolated *_e2e database; reset fixtures between runs.
  await db.execute(
    sql`TRUNCATE TABLE users, farms, markets, auth_verifications, auth_rate_limits, background_job_runs CASCADE`,
  );
} finally {
  await pool.end();
}
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: databaseURL,
  API_PORT: '3101',
  WEB_PORT: '5180',
  WEB_ORIGIN: 'http://localhost:5180',
  BETTER_AUTH_URL: 'http://localhost:5180',
  BETTER_AUTH_SECRET: 'e2e-only-secret-never-use-in-production-123456789',
  RESEND_API_KEY: '',
  GOOGLE_MAPS_API_KEY: '',
  JOBS_WORKER_DISABLED: '1',
  CRON_SECRET: 'e2e-only-cron-secret-not-for-production-123456789',
  EMAIL_FROM: '',
};
const child = spawn('npm', ['run', 'dev:apps'], { env, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
