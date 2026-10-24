import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
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
  const driverIds = [
    ...new Set(rows.flatMap((row) => (row.driverId ? [row.driverId] : []))),
  ];
  const drivers = driverIds.length
    ? await db
        .select({
          id: s.driverProfiles.userId,
          name: s.user.name,
          phone: s.driverProfiles.phone,
        })
        .from(s.driverProfiles)
        .innerJoin(s.user, eq(s.user.id, s.driverProfiles.userId))
        .where(inArray(s.driverProfiles.userId, driverIds))
    : [];
  return rows.map((order) => ({
    ...order,
    driver: drivers.find((driver) => driver.id === order.driverId) ?? null,
    run: runs.find((run) => run.id === order.runId)!,
    items: items.filter((i) => i.orderId === order.id),
    events: events.filter((e) => e.orderId === order.id),
  }));
}
export async function driverOrderDetail(
  db: s.Database,
  id: string,
  actor: Actor,
) {
  const [driver] = await db
    .select()
    .from(s.driverProfiles)
    .where(eq(s.driverProfiles.userId, actor.id));
  ensure(
    actor.admin || driver?.status === 'approved',
    'Approved driver access required',
    'FORBIDDEN',
  );
  const [order] = await db.select().from(s.orders).where(eq(s.orders.id, id));
  ensure(
    order && (actor.admin || order.driverId === actor.id),
    'Order not found',
    'NOT_FOUND',
  );
  const [detail] = await orderDetails(db, [order]);
  const [market] = await db
    .select()
    .from(s.markets)
    .where(eq(s.markets.id, detail!.run.marketId));
  const purchases = await db
    .select({
      itemId: s.orderItems.id,
      purchase: s.purchases,
      contactPhone: s.farms.contactPhone,
      notes: s.farms.notes,
    })
    .from(s.orderItems)
    .innerJoin(s.farms, eq(s.farms.id, s.orderItems.farmId))
    .leftJoin(s.purchases, eq(s.purchases.orderItemId, s.orderItems.id))
    .where(eq(s.orderItems.orderId, id));
  return {
    ...detail!,
    market: market!,
    items: detail!.items.map((item) => ({
      ...item,
      purchase: purchases.find((p) => p.itemId === item.id)?.purchase ?? null,
      farmContactPhone:
        purchases.find((p) => p.itemId === item.id)?.contactPhone ?? '',
      farmNotes: purchases.find((p) => p.itemId === item.id)?.notes ?? '',
    })),
  };
}
export async function runDetail(db: s.Database, id: string, actor: Actor) {
  ensure(actor.admin, 'Administrator access required', 'FORBIDDEN');
  const [run] = await db
    .select()
    .from(s.marketRuns)
    .where(eq(s.marketRuns.id, id));
  ensure(run, 'Run not found', 'NOT_FOUND');
  const rows = await db
    .select()
    .from(s.orders)
    .where(eq(s.orders.runId, id))
    .orderBy(asc(s.orders.createdAt), asc(s.orders.id));
  return { run, orders: await orderDetails(db, rows) };
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

export type DriverView = 'available' | 'mine';
type ReadDb = Pick<s.Database, 'select'>;
const driverSummaryColumns = {
  id: s.orders.id,
  runId: s.orders.runId,
  status: s.orders.status,
  driverId: s.orders.driverId,
  city: s.orders.city,
  postalCode: s.orders.postalCode,
  estimatedTotalCents: s.orders.estimatedTotalCents,
  deliveryFeeCents: s.orders.deliveryFeeCents,
  createdAt: s.orders.createdAt,
  itemCount:
    sql<number>`coalesce((select sum(quantity)::int from order_items where order_id = ${s.orders.id}),0)`.as(
      'item_count',
    ),
};
function driverOrderFilter(
  actor: Actor,
  input: { view: DriverView; runId?: string; marketId?: string },
) {
  return and(
    input.runId ? eq(s.orders.runId, input.runId) : undefined,
    input.marketId ? eq(s.marketRuns.marketId, input.marketId) : undefined,
    input.view === 'mine'
      ? eq(s.orders.driverId, actor.id)
      : and(
          eq(s.orders.status, 'placed'),
          sql`${s.orders.driverId} IS NULL`,
          sql`${s.orders.customerId} <> ${actor.id}`,
          eq(s.marketRuns.status, 'scheduled'),
          sql`${s.marketRuns.endsAt} > now()`,
        ),
  );
}
async function requireDriver(db: ReadDb, actor: Actor) {
  const [profile] = await db
    .select()
    .from(s.driverProfiles)
    .where(eq(s.driverProfiles.userId, actor.id));
  ensure(
    profile?.status === 'approved',
    'Approved driver access required',
    'FORBIDDEN',
  );
}
export async function driverOrders(
  db: s.Database,
  actor: Actor,
  input: { view: DriverView; runId: string; limit: number; offset: number },
) {
  return db.transaction(
    async (tx) => {
      await requireDriver(tx, actor);
      const filter = driverOrderFilter(actor, input);
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(s.orders)
        .innerJoin(s.marketRuns, eq(s.marketRuns.id, s.orders.runId))
        .where(filter);
      const items = await tx
        .select(driverSummaryColumns)
        .from(s.orders)
        .innerJoin(s.marketRuns, eq(s.marketRuns.id, s.orders.runId))
        .where(filter)
        .orderBy(asc(s.orders.createdAt), asc(s.orders.id))
        .limit(input.limit)
        .offset(input.offset);
      const total = count!.total,
        hasMore = input.offset + items.length < total;
      return {
        items,
        total,
        hasMore,
        nextOffset: hasMore ? input.offset + input.limit : null,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
export async function driverOrderGroups(
  db: s.Database,
  actor: Actor,
  input: {
    view: DriverView;
    marketId?: string;
    limit: number;
    offset: number;
    orderLimit: number;
  },
) {
  return db.transaction(
    async (tx) => {
      await requireDriver(tx, actor);
      const filter = driverOrderFilter(actor, input);
      const [count] = await tx
        .select({ total: sql<number>`count(distinct ${s.orders.runId})::int` })
        .from(s.orders)
        .innerJoin(s.marketRuns, eq(s.marketRuns.id, s.orders.runId))
        .where(filter);
      const rows = await tx
        .select({
          run: s.marketRuns,
          market: s.markets,
          orderCount: sql<number>`count(*)::int`,
          priority: sql<number>`min(case when ${s.orders.status} in ('claimed','shopping','ready','out_for_delivery','delivery_failed') then 0 else 1 end)`,
        })
        .from(s.orders)
        .innerJoin(s.marketRuns, eq(s.marketRuns.id, s.orders.runId))
        .innerJoin(s.markets, eq(s.markets.id, s.marketRuns.marketId))
        .where(filter)
        .groupBy(s.marketRuns.id, s.markets.id)
        .orderBy(
          sql`min(case when ${s.orders.status} in ('claimed','shopping','ready','out_for_delivery','delivery_failed') then 0 else 1 end)`,
          asc(s.marketRuns.startsAt),
          asc(s.markets.id),
          asc(s.marketRuns.id),
        )
        .limit(input.limit + 1)
        .offset(input.offset);
      const hasMore = rows.length > input.limit,
        page = rows.slice(0, input.limit);
      const runIds = page.map((row) => row.run.id);
      // Rank within each date so a busy date cannot consume another date's order page.
      const ranked = tx
        .select({
          ...driverSummaryColumns,
          position:
            sql<number>`row_number() over (partition by ${s.orders.runId} order by ${s.orders.createdAt},${s.orders.id})`.as(
              'position',
            ),
        })
        .from(s.orders)
        .innerJoin(s.marketRuns, eq(s.marketRuns.id, s.orders.runId))
        .where(and(filter, inArray(s.orders.runId, runIds)))
        .as('ranked_orders');
      const orderRows = runIds.length
        ? await tx
            .select()
            .from(ranked)
            .where(sql`${ranked.position} <= ${input.orderLimit}`)
            .orderBy(asc(ranked.runId), asc(ranked.position))
        : [];
      type OrderPage = {
        items: Omit<(typeof orderRows)[number], 'position'>[];
        total: number;
        hasMore: boolean;
        nextOffset: number | null;
      };
      const markets: {
        market: (typeof page)[number]['market'];
        orderCount: number;
        dates: { run: (typeof page)[number]['run']; page: OrderPage }[];
      }[] = [];
      for (const row of page) {
        let market = markets.find((group) => group.market.id === row.market.id);
        if (!market) {
          market = { market: row.market, orderCount: 0, dates: [] };
          markets.push(market);
        }
        market.orderCount += row.orderCount;
        const items = orderRows
          .filter((order) => order.runId === row.run.id)
          .map(({ position: _position, ...order }) => order);
        const more = items.length < row.orderCount;
        market.dates.push({
          run: row.run,
          page: {
            items,
            total: row.orderCount,
            hasMore: more,
            nextOffset: more ? input.orderLimit : null,
          },
        });
      }
      return {
        markets,
        totalGroups: count!.total,
        hasMore,
        nextOffset: hasMore ? input.offset + input.limit : null,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

export async function driverShoppingList(
  db: s.Database,
  actor: Actor,
  runId: string,
) {
  return db.transaction(
    async (tx) => {
      await requireDriver(tx, actor);
      const [location] = await tx
        .select({ run: s.marketRuns, market: s.markets })
        .from(s.marketRuns)
        .innerJoin(s.markets, eq(s.markets.id, s.marketRuns.marketId))
        .where(eq(s.marketRuns.id, runId));
      ensure(location, 'Market date not found', 'NOT_FOUND');
      // This deliberately has no order-page limit: it is the driver's entire trip.
      const assigned = await tx
        .select()
        .from(s.orders)
        .where(
          and(
            eq(s.orders.runId, runId),
            eq(s.orders.driverId, actor.id),
            sql`${s.orders.status} <> 'cancelled'`,
          ),
        )
        .orderBy(asc(s.orders.createdAt), asc(s.orders.id));
      ensure(
        assigned.length,
        'No assigned orders for this market date',
        'NOT_FOUND',
      );
      const rows = await tx
        .select({ item: s.orderItems, purchase: s.purchases, farm: s.farms })
        .from(s.orderItems)
        .leftJoin(s.purchases, eq(s.purchases.orderItemId, s.orderItems.id))
        .innerJoin(s.farms, eq(s.farms.id, s.orderItems.farmId))
        .where(
          inArray(
            s.orderItems.orderId,
            assigned.map((order) => order.id),
          ),
        )
        .orderBy(asc(s.orderItems.name), asc(s.orderItems.id));
      const orders = assigned.map((order) => ({
        id: order.id,
        customerName: order.customerName,
        address: order.address,
        phone: order.phone,
        deliveryNotes: order.deliveryNotes,
        status: order.status,
        actualTotalCents: order.actualTotalCents,
        items: rows
          .filter((row) => row.item.orderId === order.id)
          .map((row) => ({ ...row.item, purchase: row.purchase })),
      }));
      type Allocation = {
        orderId: string;
        orderItemId: string;
        customerName: string;
        status: (typeof orders)[number]['status'];
        quantity: number;
        purchasedQuantity: number | null;
        totalCostCents: number | null;
        purchaseUpdatedAt: string | null;
      };
      type Product = {
        inventoryId: string;
        name: string;
        unit: string;
        requestedQuantity: number;
        purchasedQuantity: number;
        remainingQuantity: number;
        shortageQuantity: number;
        totalCostCents: number;
        allocations: Allocation[];
      };
      const vendors: {
        farmId: string;
        name: string;
        location: string;
        phone: string;
        notes: string;
        items: Product[];
      }[] = [];
      for (const order of orders) {
        if (order.status === 'delivered') continue;
        for (const item of order.items) {
          const farm = rows.find((row) => row.item.id === item.id)!.farm;
          let vendor = vendors.find((group) => group.farmId === item.farmId);
          if (!vendor) {
            vendor = {
              farmId: item.farmId,
              name: item.farmName,
              location: item.farmLocation,
              phone: farm.contactPhone,
              notes: farm.notes,
              items: [],
            };
            vendors.push(vendor);
          }
          let product = vendor.items.find(
            (product) => product.inventoryId === item.inventoryId,
          );
          if (!product) {
            product = {
              inventoryId: item.inventoryId,
              name: item.name,
              unit: item.unit,
              requestedQuantity: 0,
              purchasedQuantity: 0,
              remainingQuantity: 0,
              shortageQuantity: 0,
              totalCostCents: 0,
              allocations: [],
            };
            vendor.items.push(product);
          }
          const bought =
            item.fulfilledQuantity ?? item.purchase?.quantity ?? null;
          product.requestedQuantity += item.quantity;
          product.purchasedQuantity += bought ?? 0;
          product.totalCostCents +=
            item.actualCostCents ?? item.purchase?.totalCostCents ?? 0;
          if (bought === null && ['claimed', 'shopping'].includes(order.status))
            product.remainingQuantity += item.quantity;
          else if (bought !== null)
            product.shortageQuantity += item.quantity - bought;
          product.allocations.push({
            orderId: order.id,
            orderItemId: item.id,
            customerName: order.customerName,
            status: order.status,
            quantity: item.quantity,
            purchasedQuantity: bought,
            totalCostCents:
              item.actualCostCents ?? item.purchase?.totalCostCents ?? null,
            purchaseUpdatedAt: item.purchase?.updatedAt.toISOString() ?? null,
          });
        }
      }
      vendors.sort(
        (a, b) =>
          a.name.localeCompare(b.name) || a.farmId.localeCompare(b.farmId),
      );
      for (const vendor of vendors)
        vendor.items.sort(
          (a, b) =>
            a.name.localeCompare(b.name) ||
            a.inventoryId.localeCompare(b.inventoryId),
        );
      return {
        ...location,
        orders,
        vendors,
        claimedOrderCount: orders.filter((order) => order.status === 'claimed')
          .length,
        shoppingOrderCount: orders.filter(
          (order) => order.status === 'shopping',
        ).length,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
