import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as catalog from './schema.js';
import * as auth from './auth-schema.js';
import * as market from './market-schema.js';
const schema = { ...catalog, ...auth, ...market };

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
export type Database = ReturnType<typeof createDatabase>['db'];
export * from './schema.js';

export * from './auth-schema.js';
export * from './market-schema.js';
export { ensureUpcomingRuns } from './recurrence.js';
export {
  runMarketRunsJob,
  MARKET_RUNS_JOB,
  runCloseMarketsJob,
  CLOSE_MARKETS_JOB,
} from './jobs.js';
