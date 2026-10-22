import { eq, sql } from 'drizzle-orm';
import type { Database } from './index.js';
import { backgroundJobRuns } from './market-schema.js';
import { ensureUpcomingRuns } from './recurrence.js';

export const MARKET_RUNS_JOB = 'generate-market-runs';
export async function runMarketRunsJob(
  db: Database,
  source: 'cron' | 'cli' | 'admin' | 'worker',
  asOf = new Date(),
) {
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
