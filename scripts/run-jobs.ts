import {
  createDatabase,
  runMarketRunsJob,
  runCloseMarketsJob,
} from '../packages/db/src/index.js';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const { db, pool } = createDatabase(process.env.DATABASE_URL);
try {
  const name = process.argv[2];
  if (name && name !== 'close-markets') throw new Error('Unknown job');
  const run = name === 'close-markets' ? runCloseMarketsJob : runMarketRunsJob;
  console.log(JSON.stringify(await run(db, 'cli')));
} finally {
  await pool.end();
}
