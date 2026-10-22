import { createDatabase, runMarketRunsJob } from '../packages/db/src/index.js';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  console.log(JSON.stringify(await runMarketRunsJob(db, 'cli')));
} finally {
  await pool.end();
}
