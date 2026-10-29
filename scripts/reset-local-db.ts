import { sql } from 'drizzle-orm';
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
const { db, pool } = createDatabase(databaseURL);
try {
  // Reset schema objects and the migration ledger together so migrations can
  // recreate the database from scratch.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('market-delivered:migrations'))`,
    );
    await tx.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await tx.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await tx.execute(sql`CREATE SCHEMA public`);
  });
  console.log('Local development schema, data and migration history cleared.');
} finally {
  await pool.end();
}
