import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import * as s from '@market/db';
import { ensure, type Actor } from './operations.js';
export async function orderDetails(
  db: s.Database,
  rows: (typeof s.orders.$inferSelect)[],
) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const runs = await db
    .select()
    .from(s.marketRuns)
    .where(inArray(s.marketRuns.id, [...new Set(rows.map((r) => r.runId))]));
  const items = await db
    .select()
    .from(s.orderItems)
    .where(inArray(s.orderItems.orderId, ids));
  const events = await db
    .select()
    .from(s.orderEvents)
    .where(inArray(s.orderEvents.orderId, ids))
    .orderBy(asc(s.orderEvents.createdAt));
  return rows.map((order) => ({
    ...order,
    run: runs.find((run) => run.id === order.runId)!,
    items: items.filter((i) => i.orderId === order.id),
    events: events.filter((e) => e.orderId === order.id),
  }));
}
export async function runDetail(db: s.Database, id: string, actor: Actor) {
  const [run] = await db
    .select()
    .from(s.marketRuns)
    .where(eq(s.marketRuns.id, id));
  ensure(run, 'Run not found', 'NOT_FOUND');
  const [driver] = await db
    .select()
    .from(s.driverProfiles)
    .where(eq(s.driverProfiles.userId, actor.id));
  ensure(
    actor.admin || (run.driverId === actor.id && driver?.status === 'approved'),
    'This is not your run',
    'FORBIDDEN',
  );
  const rows = await db
    .select()
    .from(s.orders)
    .where(eq(s.orders.runId, id))
    .orderBy(asc(s.orders.createdAt), asc(s.orders.id));
  const stock = await db
    .select({
      inventory: s.inventory,
      produce: s.produce,
      purchase: s.purchases,
    })
    .from(s.inventory)
    .innerJoin(s.produce, eq(s.produce.id, s.inventory.produceId))
    .leftJoin(s.purchases, eq(s.purchases.inventoryId, s.inventory.id))
    .where(eq(s.inventory.runId, id));
  return {
    run,
    orders: await orderDetails(db, rows),
    shopping: stock.filter((i) => i.inventory.reservedQuantity > 0),
  };
}
export async function myOrders(db: s.Database, userId: string) {
  return orderDetails(
    db,
    await db
      .select()
      .from(s.orders)
      .where(eq(s.orders.customerId, userId))
      .orderBy(desc(s.orders.createdAt))
      .limit(100),
  );
}
export async function isAdmin(db: s.Database, userId: string) {
  const [role] = await db
    .select()
    .from(s.userRoles)
    .where(and(eq(s.userRoles.userId, userId), eq(s.userRoles.role, 'admin')));
  return !!role;
}
