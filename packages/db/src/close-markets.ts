import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './index.js';
import {
  inventory,
  marketRuns,
  orderEvents,
  orderItems,
  orders,
} from './market-schema.js';

export const pendingOrderStatuses = ['placed', 'claimed'] as const;
export async function closeExpiredMarkets(
  db: Pick<Database, 'transaction'>,
  asOf = new Date(),
) {
  return db.transaction(async (tx) => {
    // All checkout/fulfillment writes lock the run first. Use the same order here.
    const runs = await tx
      .select()
      .from(marketRuns)
      .where(
        and(
          sql`${marketRuns.endsAt} <= ${asOf}`,
          sql`(${marketRuns.status} IN ('scheduled','shopping','delivering') OR EXISTS (SELECT 1 FROM ${orders} WHERE ${orders.runId} = ${marketRuns.id} AND ${orders.status} IN ('placed','claimed')))`,
        ),
      )
      .orderBy(asc(marketRuns.id))
      .for('update');
    let ordersCancelled = 0;
    let runsClosed = 0;
    for (const run of runs) {
      const cancelled = await tx
        .update(orders)
        .set({
          status: 'cancelled',
          // Preserve collected cash and its original charge for manual reconciliation.
          actualTotalCents: sql`CASE WHEN ${orders.cashCollectedCents} = 0 THEN 0 ELSE ${orders.actualTotalCents} END`,
        })
        .where(
          and(
            eq(orders.runId, run.id),
            inArray(orders.status, [...pendingOrderStatuses]),
          ),
        )
        .returning({ id: orders.id });
      ordersCancelled += cancelled.length;
      if (cancelled.length) {
        const ids = cancelled.map((order) => order.id);
        const quantities = await tx
          .select({
            inventoryId: orderItems.inventoryId,
            quantity: sql<number>`sum(${orderItems.quantity})::int`,
          })
          .from(orderItems)
          .where(inArray(orderItems.orderId, ids))
          .groupBy(orderItems.inventoryId);
        for (const row of quantities)
          await tx
            .update(inventory)
            .set({
              reservedQuantity: sql`greatest(0, ${inventory.reservedQuantity} - ${row.quantity})`,
            })
            .where(eq(inventory.id, row.inventoryId));
        await tx.insert(orderEvents).values(
          ids.map((orderId) => ({
            orderId,
            actorId: null,
            status: 'cancelled' as const,
            note: 'Automatically cancelled: the market closed before shopping started.',
            createdAt: asOf,
          })),
        );
      }
      const [active] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.runId, run.id),
            inArray(orders.status, [
              'shopping',
              'ready',
              'out_for_delivery',
              'delivery_failed',
            ]),
          ),
        )
        .limit(1);
      if (active) continue;
      await tx
        .update(marketRuns)
        .set({ status: 'completed' })
        .where(eq(marketRuns.id, run.id));
      runsClosed++;
    }
    return { ordersCancelled, runsClosed };
  });
}
