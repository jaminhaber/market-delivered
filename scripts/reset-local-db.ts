import { createDatabase } from '../packages/db/src/index.js';

const databaseURL = process.env.DATABASE_URL;
if (!databaseURL) throw new Error('DATABASE_URL is required');
const target = new URL(databaseURL);
if (
  process.env.NODE_ENV === 'production' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/market_delivered'
)
  throw new Error(
    'Reset only supports the local market_delivered development database',
  );
const { pool } = createDatabase(databaseURL);
try {
  // Explicit application roots cascade to all user, order, invitation, stock and schedule data.
  // Preserve the Drizzle migration ledger and database schema.
  await pool.query(
    'TRUNCATE TABLE users, farms, markets, auth_verifications, auth_rate_limits, background_job_runs CASCADE',
  );
  console.log('Local development data cleared.');
} finally {
  await pool.end();
}
