import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';

import {
  createDatabase,
  runMigrations,
  networks,
} from '../packages/db/src/index.js';
const databaseURL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://market:market@localhost:5433/market_delivered_e2e';
if (!new URL(databaseURL).pathname.endsWith('_e2e'))
  throw new Error(
    'E2E_DATABASE_URL must name an isolated database ending in _e2e',
  );
const { db, pool } = createDatabase(databaseURL);
try {
  // Only the explicitly isolated *_e2e database is reset. Exercise the complete
  // migration history on every run, including the network upgrade.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('market-delivered:migrations'))`,
    );
    await tx.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await tx.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await tx.execute(sql`CREATE SCHEMA public`);
  });
  await runMigrations(
    db,
    fileURLToPath(new URL('../packages/db/drizzle', import.meta.url)),
  );
  // Explicit test fixture only; application migrations create no networks.
  await db.insert(networks).values({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Ojai',
    slug: 'ojai',
    location: {
      city: 'Ojai',
      region: 'CA',
      postalCode: '93023',
      timezone: 'America/Los_Angeles',
      autocompleteBias: {
        latitude: 34.448,
        longitude: -119.243,
        radiusMeters: 30000,
      },
    },
  });
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
