import { networkDatabase } from './network-scope.js';
import { networks } from './network-schema.js';
import { closeExpiredMarkets } from './close-markets.js';
import { eq, sql, isNull } from 'drizzle-orm';
import type { Database } from './index.js';
import { backgroundJobRuns } from './market-schema.js';
import { ensureUpcomingRuns } from './recurrence.js';

export const MARKET_RUNS_JOB = 'generate-market-runs';
export async function runMarketRunsJob(
  db: Database,
  source: 'cron' | 'cli' | 'admin' | 'worker',
  asOf = new Date(),
): Promise<{
  id: string;
  status: 'skipped' | 'succeeded';
  schedulesProcessed: number;
  runsCreated: number;
}> {
  const scope = await db.execute<{ network_id: string | null }>(
    sql`select nullif(current_setting('app.network_id', true), '') as network_id`,
  );
  if (!scope.rows[0]!.network_id) {
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
      ...results[0]!,
      status: results.some((result) => result.status === 'succeeded')
        ? 'succeeded'
        : 'skipped',
      schedulesProcessed: results.reduce((n, r) => n + r.schedulesProcessed, 0),
      runsCreated: results.reduce((n, r) => n + r.runsCreated, 0),
    };
  }
  const [attempt] = await db
    .insert(backgroundJobRuns)
    .values({ name: MARKET_RUNS_JOB, source })
    .returning();
  try {
    return await db.transaction(async (tx) => {
      // Transaction-scoped lock works across API processes and serverless instances.
      const {
        rows: [lock],
      } = await tx.execute<{ acquired: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${MARKET_RUNS_JOB})) AS acquired`,
      );
      if (!lock!.acquired) {
        await tx
          .update(backgroundJobRuns)
          .set({ status: 'skipped', finishedAt: new Date() })
          .where(eq(backgroundJobRuns.id, attempt!.id));
        return {
          id: attempt!.id,
          status: 'skipped' as const,
          schedulesProcessed: 0,
          runsCreated: 0,
        };
      }
      const summary = await ensureUpcomingRuns(tx, asOf);
      await tx
        .update(backgroundJobRuns)
        .set({ status: 'succeeded', finishedAt: new Date(), ...summary })
        .where(eq(backgroundJobRuns.id, attempt!.id));
      return { id: attempt!.id, status: 'succeeded' as const, ...summary };
    });
  } catch (error) {
    await db
      .update(backgroundJobRuns)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        error: 'Market run generation failed; see worker/API logs.',
      })
      .where(eq(backgroundJobRuns.id, attempt!.id));
    throw error;
  }
}

export const CLOSE_MARKETS_JOB = 'close-expired-markets';
export async function runCloseMarketsJob(
  db: Database,
  source: 'cron' | 'cli' | 'worker',
  asOf = new Date(),
): Promise<{
  id: string;
  status: 'skipped' | 'succeeded';
  ordersCancelled: number;
  runsClosed: number;
}> {
  const scope = await db.execute<{ network_id: string | null }>(
    sql`select nullif(current_setting('app.network_id', true), '') as network_id`,
  );
  if (!scope.rows[0]!.network_id) {
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
      ...results[0]!,
      status: results.some((result) => result.status === 'succeeded')
        ? 'succeeded'
        : 'skipped',
      ordersCancelled: results.reduce((n, r) => n + r.ordersCancelled, 0),
      runsClosed: results.reduce((n, r) => n + r.runsClosed, 0),
    };
  }
  const [attempt] = await db
    .insert(backgroundJobRuns)
    .values({ name: CLOSE_MARKETS_JOB, source })
    .returning();
  try {
    return await db.transaction(async (tx) => {
      const {
        rows: [lock],
      } = await tx.execute<{ acquired: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${CLOSE_MARKETS_JOB})) AS acquired`,
      );
      if (!lock!.acquired) {
        await tx
          .update(backgroundJobRuns)
          .set({ status: 'skipped', finishedAt: new Date() })
          .where(eq(backgroundJobRuns.id, attempt!.id));
        return {
          id: attempt!.id,
          status: 'skipped' as const,
          ordersCancelled: 0,
          runsClosed: 0,
        };
      }
      const summary = await closeExpiredMarkets(tx, asOf);
      await tx
        .update(backgroundJobRuns)
        .set({ status: 'succeeded', finishedAt: new Date(), ...summary })
        .where(eq(backgroundJobRuns.id, attempt!.id));
      return { id: attempt!.id, status: 'succeeded' as const, ...summary };
    });
  } catch (error) {
    await db
      .update(backgroundJobRuns)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        error: 'Market closing failed; see worker/API logs.',
      })
      .where(eq(backgroundJobRuns.id, attempt!.id));
    throw error;
  }
}
