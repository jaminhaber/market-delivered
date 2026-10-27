import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from './index.js';
import {
  inventory,
  marketRuns,
  marketSchedules,
  markets,
  scheduleInventory,
} from './market-schema.js';

// Job implementation: maintain four orderable dates for each active schedule.
// Existing dated runs and their inventory are immutable to this materializer.
export async function ensureUpcomingRuns(
  db: Pick<Database, 'transaction'>,
  asOf = new Date(),
) {
  return db.transaction(async (tx) => {
    // Serialize competing requests and schedule edits, always in the same lock order.
    const schedules = await tx
      .select()
      .from(marketSchedules)
      .where(eq(marketSchedules.active, true))
      .orderBy(asc(marketSchedules.id))
      .for('update');
    let runsCreated = 0;
    for (const schedule of schedules) {
      const [market] = await tx
        .select()
        .from(markets)
        .where(eq(markets.id, schedule.marketId));
      if (!market) continue;
      const { rows: dates } = await tx.execute<{
        starts_at: Date;
        ends_at: Date;
      }>(sql`
        WITH candidates AS (
          SELECT day::date AS market_date FROM generate_series(
            (${asOf.toISOString()}::timestamptz AT TIME ZONE ${market.timezone})::date::timestamp,
            (${asOf.toISOString()}::timestamptz AT TIME ZONE ${market.timezone})::date::timestamp + interval '70 days', interval '1 day'
          ) AS day
          WHERE extract(dow FROM day) = ${schedule.weekday}
            AND NOT (${schedule.skipThanksgiving} AND extract(dow FROM day) = 4 AND extract(month FROM day) = 11 AND extract(day FROM day) BETWEEN 22 AND 28)
        )
        SELECT (market_date + make_interval(mins => ${schedule.opensMinute})) AT TIME ZONE ${market.timezone} AS starts_at,
               (market_date + make_interval(mins => ${schedule.closesMinute})) AT TIME ZONE ${market.timezone} AS ends_at
        FROM candidates
        WHERE ((market_date + make_interval(mins => ${schedule.opensMinute})) AT TIME ZONE ${market.timezone}) - make_interval(mins => ${schedule.cutoffMinutes}) > ${asOf.toISOString()}::timestamptz
        ORDER BY market_date
      `);
      let upcoming = 0;
      for (const date of dates) {
        if (upcoming >= 4) break;
        const startsAt = new Date(date.starts_at),
          endsAt = new Date(date.ends_at);
        const [existing] = await tx
          .select()
          .from(marketRuns)
          .where(
            and(
              eq(marketRuns.marketId, market.id),
              eq(marketRuns.startsAt, startsAt),
            ),
          );
        // A cancellation remains a cancellation; continue to the following week.
        if (existing) {
          if (
            existing.status === 'cancelled' ||
            existing.status === 'completed'
          )
            continue;
          upcoming++;
          continue;
        }
        const [run] = await tx
          .insert(marketRuns)
          .values({
            networkId: market.networkId,
            marketId: market.id,
            scheduleId: schedule.id,
            startsAt,
            endsAt,
            cutoffAt: new Date(+startsAt - schedule.cutoffMinutes * 60000),
            deliveryStartAt: new Date(
              +startsAt + schedule.deliveryDelayMinutes * 60000,
            ),
            deliveryEndAt: new Date(
              +startsAt +
                (schedule.deliveryDelayMinutes +
                  schedule.deliveryDurationMinutes) *
                  60000,
            ),
            deliveryFeeCents: schedule.deliveryFeeCents,
          })
          .onConflictDoNothing()
          .returning();
        if (run) {
          runsCreated++;
          const templates = await tx
            .select()
            .from(scheduleInventory)
            .where(eq(scheduleInventory.scheduleId, schedule.id));
          if (templates.length)
            await tx
              .insert(inventory)
              .values(
                templates.map((item) => ({
                  networkId: run.networkId,
                  runId: run.id,
                  produceId: item.produceId,
                  priceCents: item.priceCents,
                  quantity: item.quantity,
                  active: item.active,
                })),
              )
              .onConflictDoNothing();
        }
        upcoming++;
      }
    }
    return { schedulesProcessed: schedules.length, runsCreated };
  });
}
