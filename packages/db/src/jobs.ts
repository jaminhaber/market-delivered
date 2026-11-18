import {
  networkValues,
  networkDatabase,
  databaseNetworkId,
} from './network-scope.js';
import { networks } from './network-schema.js';
import { closeExpiredMarkets } from './close-markets.js';
import { sql, isNull } from 'drizzle-orm';
import type { Database } from './index.js';
import { backgroundJobRuns } from './market-schema.js';
import { ensureUpcomingRuns } from './recurrence.js';

export const MARKET_RUNS_JOB = 'generate-market-runs';
export async function runMarketRunsJob(
  db: Database,
  source: 'cron' | 'cli' | 'admin' | 'worker',
  asOf = new Date(),
): Promise<{
  id: string | null;
  status: 'skipped' | 'succeeded';
  schedulesProcessed: number;
  runsCreated: number;
  impactedEntities: number;
}> {
  if (!databaseNetworkId(db)) {
    const all = await db
      .select()
      .from(networks)
      .where(isNull(networks.deletedAt))
      .orderBy(networks.createdAt, networks.id);
    const results = [];
    for (const network of all)
      results.push(
        await runMarketRunsJob(
          networkDatabase(db, network.id, ''),
          source,
          asOf,
        ),
      );
    return {
      id: results.find((result) => result.id)?.id ?? null,
      status: results.some((result) => result.status === 'succeeded')
        ? 'succeeded'
        : 'skipped',
      schedulesProcessed: results.reduce((n, r) => n + r.schedulesProcessed, 0),
      runsCreated: results.reduce((n, r) => n + r.runsCreated, 0),
      impactedEntities: results.reduce((n, r) => n + r.impactedEntities, 0),
    };
  }
  const startedAt = new Date();
  try {
    return await db.transaction(async (tx) => {
      // Transaction-scoped lock works across API processes and serverless instances.
      const {
        rows: [lock],
      } = await tx.execute<{ acquired: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${MARKET_RUNS_JOB})) AS acquired`,
      );
      if (!lock!.acquired) {
        return {
          id: null,
          status: 'skipped' as const,
          schedulesProcessed: 0,
          runsCreated: 0,
          impactedEntities: 0,
        };
      }
      const summary = await ensureUpcomingRuns(tx, asOf);
      // Count changed market dates and orders, not checks, locks, or log rows.
      const impactedEntities = summary.runsCreated;
      const [attempt] =
        impactedEntities > 0
          ? await tx
              .insert(backgroundJobRuns)
              .values(
                networkValues(tx, {
                  name: MARKET_RUNS_JOB,
                  source,
                  status: 'succeeded',
                  startedAt,
                  finishedAt: new Date(),
                  ...summary,
                  impactedEntities,
                }),
              )
              .returning({ id: backgroundJobRuns.id })
          : [];
      return {
        id: attempt?.id ?? null,
        status: 'succeeded' as const,
        ...summary,
        impactedEntities,
      };
    });
  } catch (error) {
    await db.insert(backgroundJobRuns).values(
      networkValues(db, {
        name: MARKET_RUNS_JOB,
        source,
        status: 'failed',
        startedAt,
        finishedAt: new Date(),
        error: 'Market run generation failed; see worker/API logs.',
      }),
    );
    throw error;
  }
}

export const CLOSE_MARKETS_JOB = 'close-expired-markets';
export async function runCloseMarketsJob(
  db: Database,
  source: 'cron' | 'cli' | 'worker',
  asOf = new Date(),
): Promise<{
  id: string | null;
  status: 'skipped' | 'succeeded';
  ordersCancelled: number;
  runsClosed: number;
  impactedEntities: number;
}> {
  if (!databaseNetworkId(db)) {
    const all = await db
      .select()
      .from(networks)
      .where(isNull(networks.deletedAt))
      .orderBy(networks.createdAt, networks.id);
    const results = [];
    for (const network of all)
      results.push(
        await runCloseMarketsJob(
          networkDatabase(db, network.id, ''),
          source,
          asOf,
        ),
      );
    return {
      id: results.find((result) => result.id)?.id ?? null,
      status: results.some((result) => result.status === 'succeeded')
        ? 'succeeded'
        : 'skipped',
      ordersCancelled: results.reduce((n, r) => n + r.ordersCancelled, 0),
      runsClosed: results.reduce((n, r) => n + r.runsClosed, 0),
      impactedEntities: results.reduce((n, r) => n + r.impactedEntities, 0),
    };
  }
  const startedAt = new Date();
  try {
    return await db.transaction(async (tx) => {
      const {
        rows: [lock],
      } = await tx.execute<{ acquired: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${CLOSE_MARKETS_JOB})) AS acquired`,
      );
      if (!lock!.acquired) {
        return {
          id: null,
          status: 'skipped' as const,
          ordersCancelled: 0,
          runsClosed: 0,
          impactedEntities: 0,
        };
      }
      const summary = await closeExpiredMarkets(tx, asOf);
      const impactedEntities = summary.runsClosed + summary.ordersCancelled;
      const [attempt] =
        impactedEntities > 0
          ? await tx
              .insert(backgroundJobRuns)
              .values(
                networkValues(tx, {
                  name: CLOSE_MARKETS_JOB,
                  source,
                  status: 'succeeded',
                  startedAt,
                  finishedAt: new Date(),
                  ...summary,
                  impactedEntities,
                }),
              )
              .returning({ id: backgroundJobRuns.id })
          : [];
      return {
        id: attempt?.id ?? null,
        status: 'succeeded' as const,
        ...summary,
        impactedEntities,
      };
    });
  } catch (error) {
    await db.insert(backgroundJobRuns).values(
      networkValues(db, {
        name: CLOSE_MARKETS_JOB,
        source,
        status: 'failed',
        startedAt,
        finishedAt: new Date(),
        error: 'Market closing failed; see worker/API logs.',
      }),
    );
    throw error;
  }
}
