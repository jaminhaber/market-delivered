import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import * as s from '@market/db';
import { z } from 'zod';
export type Actor = { id: string; name: string; email: string; admin: boolean };
type Tx = Parameters<Parameters<s.Database['transaction']>[0]>[0];
export function ensure(
  condition: unknown,
  message: string,
  code: 'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' = 'BAD_REQUEST',
): asserts condition {
  if (!condition) throw new TRPCError({ code, message });
}
export const marketInput = z.object({
  name: z.string().trim().min(2).max(150),
  address: z.string().trim().min(5).max(500),
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid timezone'),
});
export const runInput = z
  .object({
    marketId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    cutoffAt: z.iso.datetime({ offset: true }),
    deliveryStartAt: z.iso.datetime({ offset: true }),
    deliveryEndAt: z.iso.datetime({ offset: true }),
    deliveryFeeCents: z.number().int().min(0).max(100_000),
  })
  .refine(
    (v) =>
      new Date(v.cutoffAt) <= new Date(v.startsAt) &&
      new Date(v.startsAt) < new Date(v.endsAt) &&
      new Date(v.deliveryStartAt) >= new Date(v.startsAt) &&
      new Date(v.deliveryEndAt) > new Date(v.deliveryStartAt) &&
      new Date(v.deliveryEndAt) <= new Date(v.endsAt),
    'Invalid cutoff, market, or delivery dates',
  );
export const scheduleInput = z
  .object({
    marketId: z.uuid(),
    weekday: z.number().int().min(0).max(6),
    opensMinute: z.number().int().min(0).max(1439),
    closesMinute: z.number().int().min(1).max(1440),
    cutoffMinutes: z.number().int().min(0).max(10080).default(720),
    deliveryDelayMinutes: z.number().int().min(0).max(1440).default(0),
    deliveryDurationMinutes: z.number().int().min(1).max(1440).default(120),
    deliveryFeeCents: z.number().int().min(0).max(100000).default(500),
    skipThanksgiving: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .refine(
    (v) => v.closesMinute > v.opensMinute,
    'Closing time must be after opening time',
  )
  .refine(
    (v) =>
      v.deliveryDelayMinutes + v.deliveryDurationMinutes <=
      v.closesMinute - v.opensMinute,
    'The delivery window must fit within market hours',
  );
export const scheduleInventoryInput = z.object({
  scheduleId: z.uuid(),
  produceId: z.uuid(),
  priceCents: z.number().int().min(0).max(1000000),
  quantity: z.number().int().min(0).max(100000),
  active: z.boolean().default(true),
});
export const inventoryInput = z.object({
  runId: z.uuid(),
  produceId: z.uuid(),
  priceCents: z.number().int().min(0).max(1_000_000),
  quantity: z.number().int().min(0).max(100_000),
  active: z.boolean().default(true),
  repeat: z.boolean().default(true),
});
export const produceInput = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(500),
  category: z.enum(s.produceCategory.enumValues),
  unit: z.enum(s.produceUnit.enumValues),
  source: z.string().trim().min(2).max(150),
  location: z.string().trim().min(2).max(150),
});
export async function lockRun(tx: Tx, id: string) {
  const [run] = await tx
    .select()
    .from(s.marketRuns)
    .where(eq(s.marketRuns.id, id))
    .for('update');
  ensure(run, 'Market run not found', 'NOT_FOUND');
  return run;
}
async function clock(tx: Tx) {
  const {
    rows: [row],
  } = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  return new Date(row!.now);
}
async function audit(tx: Tx, actor: Actor, action: string, targetId: string) {
  await tx
    .insert(s.auditEvents)
    .values({ actorId: actor.id, action, targetId });
}
async function driverCheck(tx: Tx, actor: Actor) {
  const [driver] = await tx
    .select()
    .from(s.driverProfiles)
    .where(eq(s.driverProfiles.userId, actor.id));
  ensure(
    driver?.status === 'approved' &&
      driver.phone.length >= 7 &&
      driver.vehicle.length >= 2,
    'An approved driver profile is required',
    'FORBIDDEN',
  );
}
export function operations(db: s.Database, actor: Actor) {
  function admin() {
    ensure(actor.admin, 'Administrator access required', 'FORBIDDEN');
  }
  return {
    async saveSchedule(input: z.infer<typeof scheduleInput>) {
      admin();
      return db.transaction(async (tx) => {
        const [market] = await tx
          .select()
          .from(s.markets)
          .where(eq(s.markets.id, input.marketId));
        ensure(market, 'Market not found', 'NOT_FOUND');
        const [schedule] = await tx
          .insert(s.marketSchedules)
          .values(input)
          .onConflictDoUpdate({
            target: [s.marketSchedules.marketId, s.marketSchedules.weekday],
            set: input,
          })
          .returning();
        await audit(tx, actor, 'schedule.saved', schedule!.id);
        return schedule!;
      });
    },
    async saveScheduleInventory(input: z.infer<typeof scheduleInventoryInput>) {
      admin();
      return db.transaction(async (tx) => {
        const [schedule] = await tx
          .select()
          .from(s.marketSchedules)
          .where(eq(s.marketSchedules.id, input.scheduleId))
          .for('update');
        ensure(schedule, 'Schedule not found', 'NOT_FOUND');
        const [item] = await tx
          .select()
          .from(s.produce)
          .where(eq(s.produce.id, input.produceId));
        ensure(item, 'Produce not found', 'NOT_FOUND');
        const [template] = await tx
          .insert(s.scheduleInventory)
          .values(input)
          .onConflictDoUpdate({
            target: [
              s.scheduleInventory.scheduleId,
              s.scheduleInventory.produceId,
            ],
            set: input,
          })
          .returning();
        await audit(tx, actor, 'schedule_inventory.saved', schedule.id);
        return template!;
      });
    },
    async createMarket(input: z.infer<typeof marketInput>) {
      admin();
      return db.transaction(async (tx) => {
        const [market] = await tx.insert(s.markets).values(input).returning();
        await audit(tx, actor, 'market.created', market!.id);
        return market!;
      });
    },
    async updateMarket(id: string, input: z.infer<typeof marketInput>) {
      admin();
      return db.transaction(async (tx) => {
        const [market] = await tx
          .select()
          .from(s.markets)
          .where(eq(s.markets.id, id))
          .for('update');
        ensure(market, 'Market not found', 'NOT_FOUND');
        if (market.timezone !== input.timezone) {
          const [run] = await tx
            .select({ id: s.marketRuns.id })
            .from(s.marketRuns)
            .where(eq(s.marketRuns.marketId, id))
            .limit(1);
          ensure(
            !run,
            'Timezone cannot change after runs exist; create a new market instead',
            'CONFLICT',
          );
        }
        const [updated] = await tx
          .update(s.markets)
          .set(input)
          .where(eq(s.markets.id, id))
          .returning();
        await audit(tx, actor, 'market.updated', id);
        return updated!;
      });
    },
    async updateRun(id: string, input: z.infer<typeof runInput>) {
      admin();
      return db.transaction(async (tx) => {
        const run = await lockRun(tx, id);
        ensure(
          run.status === 'scheduled' && run.cutoffAt > (await clock(tx)),
          'Only scheduled runs before cutoff can be edited',
          'CONFLICT',
        );
        ensure(
          input.marketId === run.marketId,
          'A run cannot be moved to another market',
        );
        const [order] = await tx
          .select({ id: s.orders.id })
          .from(s.orders)
          .where(eq(s.orders.runId, id))
          .limit(1);
        ensure(
          !order,
          'A run with orders cannot be rescheduled; cancel it and create a replacement',
          'CONFLICT',
        );
        const startsAt = new Date(input.startsAt);
        ensure(
          !run.scheduleId || +startsAt === +run.startsAt,
          'To move a recurring date, cancel it and create a one-off replacement',
          'CONFLICT',
        );
        ensure(
          new Date(input.cutoffAt) > (await clock(tx)),
          'Cutoff must be in the future',
        );
        const [duplicate] = await tx
          .select({ id: s.marketRuns.id })
          .from(s.marketRuns)
          .where(
            and(
              eq(s.marketRuns.marketId, run.marketId),
              eq(s.marketRuns.startsAt, startsAt),
              sql`${s.marketRuns.id} <> ${id}`,
            ),
          )
          .limit(1);
        ensure(
          !duplicate,
          'This market already has a run at that time',
          'CONFLICT',
        );
        const [updated] = await tx
          .update(s.marketRuns)
          .set({
            ...input,
            startsAt,
            endsAt: new Date(input.endsAt),
            cutoffAt: new Date(input.cutoffAt),
            deliveryStartAt: new Date(input.deliveryStartAt),
            deliveryEndAt: new Date(input.deliveryEndAt),
          })
          .where(eq(s.marketRuns.id, id))
          .returning();
        await audit(tx, actor, 'run.updated', id);
        return updated!;
      });
    },
    async updateProduce(id: string, input: z.infer<typeof produceInput>) {
      admin();
      return db.transaction(async (tx) => {
        const [item] = await tx
          .select()
          .from(s.produce)
          .where(eq(s.produce.id, id))
          .for('update');
        ensure(item, 'Produce not found', 'NOT_FOUND');
        if (item.unit !== input.unit) {
          const [stock] = await tx
            .select({ id: s.inventory.id })
            .from(s.inventory)
            .where(eq(s.inventory.produceId, id))
            .limit(1);
          const [template] = await tx
            .select({ id: s.scheduleInventory.produceId })
            .from(s.scheduleInventory)
            .where(eq(s.scheduleInventory.produceId, id))
            .limit(1);
          ensure(
            !stock && !template,
            'Unit cannot change after inventory exists; create a new catalog item',
            'CONFLICT',
          );
        }
        const [source] = await tx
          .select()
          .from(s.farms)
          .where(eq(s.farms.id, item.farmId));
        let farmId = item.farmId;
        if (
          source?.name !== input.source ||
          source?.location !== input.location
        ) {
          const [replacement] = await tx
            .insert(s.farms)
            .values({ name: input.source, location: input.location })
            .returning();
          farmId = replacement!.id;
        }
        const [updated] = await tx
          .update(s.produce)
          .set({
            name: input.name,
            description: input.description,
            category: input.category,
            unit: input.unit,
            farmId,
          })
          .where(eq(s.produce.id, id))
          .returning();
        await audit(tx, actor, 'produce.updated', id);
        return updated!;
      });
    },
    async scheduleRun(input: z.infer<typeof runInput>) {
      admin();
      return db.transaction(async (tx) => {
        ensure(
          new Date(input.cutoffAt) > (await clock(tx)),
          'Cutoff must be in the future',
        );
        const [market] = await tx
          .select()
          .from(s.markets)
          .where(eq(s.markets.id, input.marketId));
        ensure(market, 'Market not found', 'NOT_FOUND');
        const [run] = await tx
          .insert(s.marketRuns)
          .values({
            ...input,
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            cutoffAt: new Date(input.cutoffAt),
            deliveryStartAt: new Date(input.deliveryStartAt),
            deliveryEndAt: new Date(input.deliveryEndAt),
          })
          .onConflictDoNothing()
          .returning();
        ensure(run, 'This market already has a run at that time', 'CONFLICT');
        await audit(tx, actor, 'run.scheduled', run.id);
        return run;
      });
    },
    async saveInventory(input: z.infer<typeof inventoryInput>) {
      admin();
      return db.transaction(async (tx) => {
        const run = await lockRun(tx, input.runId);
        ensure(
          run.status === 'scheduled' && run.cutoffAt > (await clock(tx)),
          'Inventory is locked after the cutoff',
        );
        const [item] = await tx
          .select()
          .from(s.produce)
          .where(eq(s.produce.id, input.produceId));
        ensure(item, 'Produce not found', 'NOT_FOUND');
        const [existing] = await tx
          .select()
          .from(s.inventory)
          .where(
            and(
              eq(s.inventory.runId, input.runId),
              eq(s.inventory.produceId, input.produceId),
            ),
          );
        ensure(
          !existing || input.quantity >= existing.reservedQuantity,
          'Quantity cannot be below existing reservations',
        );
        const [entry] = await tx
          .insert(s.inventory)
          .values({
            runId: input.runId,
            produceId: input.produceId,
            priceCents: input.priceCents,
            quantity: input.quantity,
            active: input.active,
          })
          .onConflictDoUpdate({
            target: [s.inventory.runId, s.inventory.produceId],
            set: {
              priceCents: input.priceCents,
              quantity: input.quantity,
              active: input.active,
            },
          })
          .returning();
        if (input.repeat && run.scheduleId)
          await tx
            .insert(s.scheduleInventory)
            .values({
              scheduleId: run.scheduleId,
              produceId: input.produceId,
              priceCents: input.priceCents,
              quantity: input.quantity,
              active: input.active,
            })
            .onConflictDoUpdate({
              target: [
                s.scheduleInventory.scheduleId,
                s.scheduleInventory.produceId,
              ],
              set: {
                priceCents: input.priceCents,
                quantity: input.quantity,
                active: input.active,
              },
            });
        await audit(tx, actor, 'inventory.saved', entry!.id);
        return entry!;
      });
    },
    async createProduce(input: z.infer<typeof produceInput>) {
      admin();
      return db.transaction(async (tx) => {
        const [source] = await tx
          .insert(s.farms)
          .values({ name: input.source, location: input.location })
          .returning();
        const [item] = await tx
          .insert(s.produce)
          .values({
            farmId: source!.id,
            name: input.name,
            description: input.description,
            category: input.category,
            unit: input.unit,
            priceCents: 0,
            availableQuantity: 0,
          })
          .returning();
        await audit(tx, actor, 'produce.created', item!.id);
        return item!;
      });
    },
    async reviewDriver(userId: string, status: 'approved' | 'suspended') {
      admin();
      return db.transaction(async (tx) => {
        const [driver] = await tx
          .update(s.driverProfiles)
          .set({ status })
          .where(eq(s.driverProfiles.userId, userId))
          .returning();
        ensure(driver, 'Driver application not found', 'NOT_FOUND');
        await audit(tx, actor, `driver.${status}`, userId);
        return driver;
      });
    },
    async assignDriver(input: { runId: string; driverId: string | null }) {
      admin();
      return db.transaction(async (tx) => {
        const run = await lockRun(tx, input.runId);
        ensure(
          ['scheduled', 'shopping', 'delivering'].includes(run.status),
          'Only active runs can be reassigned',
          'CONFLICT',
        );
        ensure(
          input.driverId !== null || run.status === 'scheduled',
          'An in-progress run needs a replacement driver',
          'CONFLICT',
        );
        if (input.driverId) {
          const [driver] = await tx
            .select()
            .from(s.driverProfiles)
            .where(eq(s.driverProfiles.userId, input.driverId))
            .for('share');
          ensure(
            driver?.status === 'approved' &&
              driver.phone.length >= 7 &&
              driver.vehicle.length >= 2,
            'Choose an approved driver with complete contact and vehicle details',
          );
        }
        const [updated] = await tx
          .update(s.marketRuns)
          .set({ driverId: input.driverId })
          .where(eq(s.marketRuns.id, run.id))
          .returning();
        await audit(tx, actor, 'run.driver_assigned', run.id);
        const affected = await tx
          .select({ id: s.orders.id, status: s.orders.status })
          .from(s.orders)
          .where(
            and(
              eq(s.orders.runId, run.id),
              inArray(s.orders.status, [
                'placed',
                'ready',
                'out_for_delivery',
                'delivery_failed',
              ]),
            ),
          );
        if (affected.length)
          await tx.insert(s.orderEvents).values(
            affected.map((order) => ({
              orderId: order.id,
              actorId: actor.id,
              status: order.status,
              note: 'Operations updated the assigned driver.',
            })),
          );
        return updated!;
      });
    },
    async placeOrder(input: {
      runId: string;
      requestId: string;
      items: { inventoryId: string; quantity: number }[];
    }) {
      return db.transaction(async (tx) => {
        const run = await lockRun(tx, input.runId);
        const [previous] = await tx
          .select()
          .from(s.orders)
          .where(
            and(
              eq(s.orders.customerId, actor.id),
              eq(s.orders.requestId, input.requestId),
            ),
          );
        if (previous) {
          ensure(
            previous.runId === input.runId,
            'Request ID belongs to a different run',
            'CONFLICT',
          );
          return previous;
        }
        ensure(
          run.status === 'scheduled' && run.cutoffAt > (await clock(tx)),
          'Ordering has closed for this market run',
          'CONFLICT',
        );
        const [profile] = await tx
          .select()
          .from(s.customerProfiles)
          .where(eq(s.customerProfiles.userId, actor.id));
        ensure(
          profile &&
            profile.street.length >= 3 &&
            profile.city.length > 0 &&
            profile.region.length === 2 &&
            profile.postalCode.length >= 5 &&
            profile.phone.length >= 7,
          'Save your delivery address and phone in your profile first',
        );
        ensure(
          new Set(input.items.map((i) => i.inventoryId)).size ===
            input.items.length,
          'Duplicate inventory items',
        );
        const stock = await tx
          .select({ inventory: s.inventory, produce: s.produce })
          .from(s.inventory)
          .innerJoin(s.produce, eq(s.inventory.produceId, s.produce.id))
          .where(
            inArray(
              s.inventory.id,
              input.items.map((i) => i.inventoryId),
            ),
          );
        ensure(
          stock.length === input.items.length,
          'Some items no longer exist',
        );
        let total = run.deliveryFeeCents;
        const lines = input.items.map((item) => {
          const row = stock.find((r) => r.inventory.id === item.inventoryId)!;
          ensure(
            row.inventory.runId === run.id && row.inventory.active,
            'Item is not available for this run',
          );
          ensure(
            row.inventory.quantity - row.inventory.reservedQuantity >=
              item.quantity,
            `${row.produce.name} has insufficient stock`,
            'CONFLICT',
          );
          total += row.inventory.priceCents * item.quantity;
          return {
            inventoryId: item.inventoryId,
            quantity: item.quantity,
            name: row.produce.name,
            unit: row.produce.unit,
            priceCents: row.inventory.priceCents,
          };
        });
        ensure(total <= 100_000_000, 'Order total is too large');
        const [order] = await tx
          .insert(s.orders)
          .values({
            customerId: actor.id,
            runId: run.id,
            requestId: input.requestId,
            customerName: actor.name,
            phone: profile.phone,
            address: profile.address,
            googlePlaceId: profile.googlePlaceId,
            street: profile.street,
            unit: profile.unit,
            city: profile.city,
            region: profile.region,
            postalCode: profile.postalCode,
            country: profile.country,
            latitude: profile.latitude,
            longitude: profile.longitude,
            geocodedAddress: profile.geocodedAddress,
            geocoder: profile.geocoder,
            geocodedAt: profile.geocodedAt,
            deliveryNotes: profile.deliveryNotes,
            deliveryFeeCents: run.deliveryFeeCents,
            estimatedTotalCents: total,
          })
          .returning();
        await tx
          .insert(s.orderItems)
          .values(lines.map((line) => ({ ...line, orderId: order!.id })));
        for (const line of lines)
          await tx
            .update(s.inventory)
            .set({
              reservedQuantity: sql`${s.inventory.reservedQuantity} + ${line.quantity}`,
            })
            .where(eq(s.inventory.id, line.inventoryId));
        await tx
          .insert(s.orderEvents)
          .values({ orderId: order!.id, actorId: actor.id, status: 'placed' });
        return order!;
      });
    },
    async cancelOrder(id: string) {
      return db.transaction(async (tx) => {
        const [initial] = await tx
          .select()
          .from(s.orders)
          .where(eq(s.orders.id, id));
        ensure(
          initial && initial.customerId === actor.id,
          'Order not found',
          'NOT_FOUND',
        );
        const run = await lockRun(tx, initial.runId);
        const [order] = await tx
          .select()
          .from(s.orders)
          .where(eq(s.orders.id, id))
          .for('update');
        if (order!.status === 'cancelled') return order!;
        ensure(
          order!.status === 'placed' &&
            run.status === 'scheduled' &&
            run.cutoffAt > (await clock(tx)),
          'Orders can only be cancelled before the cutoff',
          'CONFLICT',
        );
        const lines = await tx
          .select()
          .from(s.orderItems)
          .where(eq(s.orderItems.orderId, id));
        for (const line of lines)
          await tx
            .update(s.inventory)
            .set({
              reservedQuantity: sql`${s.inventory.reservedQuantity} - ${line.quantity}`,
            })
            .where(eq(s.inventory.id, line.inventoryId));
        const [cancelled] = await tx
          .update(s.orders)
          .set({ status: 'cancelled', actualTotalCents: 0 })
          .where(eq(s.orders.id, id))
          .returning();
        await tx
          .insert(s.orderEvents)
          .values({ orderId: id, actorId: actor.id, status: 'cancelled' });
        return cancelled!;
      });
    },
    async claimRun(id: string) {
      return db.transaction(async (tx) => {
        const run = await lockRun(tx, id);
        await driverCheck(tx, actor);
        ensure(
          run.status === 'scheduled' && run.endsAt > (await clock(tx)),
          'Run is no longer available',
          'CONFLICT',
        );
        ensure(
          !run.driverId || run.driverId === actor.id,
          'Another driver has claimed this run',
          'CONFLICT',
        );
        const [claimed] = await tx
          .update(s.marketRuns)
          .set({ driverId: actor.id })
          .where(eq(s.marketRuns.id, id))
          .returning();
        await audit(tx, actor, 'run.claimed', id);
        return claimed!;
      });
    },
    async startShopping(id: string) {
      return db.transaction(async (tx) => {
        const run = await lockRun(tx, id);
        await driverCheck(tx, actor);
        ensure(run.driverId === actor.id, 'This is not your run', 'FORBIDDEN');
        ensure(
          run.endsAt > (await clock(tx)),
          'The market has closed; this run can no longer be fulfilled',
          'CONFLICT',
        );
        const now = await clock(tx);
        ensure(
          run.status === 'scheduled' &&
            run.cutoffAt <= now &&
            run.startsAt <= now,
          'Shopping starts after the cutoff and market opening',
          'CONFLICT',
        );
        await tx
          .update(s.marketRuns)
          .set({ status: 'shopping' })
          .where(eq(s.marketRuns.id, id));
        await audit(tx, actor, 'run.shopping', id);
        return { success: true };
      });
    },
    async recordPurchase(input: {
      runId: string;
      inventoryId: string;
      quantity: number;
      totalCostCents: number;
    }) {
      return db.transaction(async (tx) => {
        const run = await lockRun(tx, input.runId);
        await driverCheck(tx, actor);
        ensure(run.driverId === actor.id, 'This is not your run', 'FORBIDDEN');
        ensure(
          run.endsAt > (await clock(tx)),
          'The market has closed; this run can no longer be fulfilled',
          'CONFLICT',
        );
        ensure(
          run.status === 'shopping',
          'Run must be in the shopping phase',
          'CONFLICT',
        );
        const [stock] = await tx
          .select()
          .from(s.inventory)
          .where(
            and(
              eq(s.inventory.id, input.inventoryId),
              eq(s.inventory.runId, run.id),
            ),
          );
        ensure(stock, 'Inventory not found', 'NOT_FOUND');
        ensure(
          input.quantity <= stock.reservedQuantity,
          'Purchased quantity cannot exceed customer demand',
        );
        ensure(
          input.quantity > 0 || input.totalCostCents === 0,
          'Unavailable items must have zero cost',
        );
        const { runId: _runId, ...data } = input;
        await tx
          .insert(s.purchases)
          .values({ ...data, recordedBy: actor.id })
          .onConflictDoUpdate({
            target: s.purchases.inventoryId,
            set: {
              quantity: input.quantity,
              totalCostCents: input.totalCostCents,
              recordedBy: actor.id,
              updatedAt: new Date(),
            },
          });
        await audit(tx, actor, 'purchase.recorded', input.inventoryId);
        return { success: true };
      });
    },
    async finishShopping(id: string) {
      return db.transaction(async (tx) => {
        const run = await lockRun(tx, id);
        await driverCheck(tx, actor);
        ensure(run.driverId === actor.id, 'This is not your run', 'FORBIDDEN');
        ensure(
          run.endsAt > (await clock(tx)),
          'The market has closed; this run can no longer be fulfilled',
          'CONFLICT',
        );
        ensure(
          run.status === 'shopping',
          'Run must be in the shopping phase',
          'CONFLICT',
        );
        const runOrders = await tx
          .select()
          .from(s.orders)
          .where(and(eq(s.orders.runId, id), eq(s.orders.status, 'placed')))
          .orderBy(asc(s.orders.createdAt), asc(s.orders.id));
        const lines = runOrders.length
          ? await tx
              .select()
              .from(s.orderItems)
              .where(
                inArray(
                  s.orderItems.orderId,
                  runOrders.map((o) => o.id),
                ),
              )
          : [];
        const stock = await tx
          .select()
          .from(s.inventory)
          .where(eq(s.inventory.runId, id));
        const bought = stock.length
          ? await tx
              .select()
              .from(s.purchases)
              .where(
                inArray(
                  s.purchases.inventoryId,
                  stock.map((i) => i.id),
                ),
              )
          : [];
        const totals = new Map(
          runOrders.map((o) => [o.id, { quantity: 0, cost: 0, charge: 0 }]),
        );
        for (const inventoryId of new Set(lines.map((l) => l.inventoryId))) {
          const purchase = bought.find((p) => p.inventoryId === inventoryId);
          ensure(
            purchase,
            'Record every shopping item, including unavailable items with zero quantity',
          );
          const itemLines = lines
            .filter((l) => l.inventoryId === inventoryId)
            .sort(
              (a, b) =>
                runOrders.findIndex((o) => o.id === a.orderId) -
                runOrders.findIndex((o) => o.id === b.orderId),
            );
          ensure(
            purchase.quantity <=
              itemLines.reduce((sum, l) => sum + l.quantity, 0),
            'Purchase exceeds demand',
          );
          let allocated = 0;
          for (const line of itemLines) {
            const quantity = Math.min(
              line.quantity,
              purchase.quantity - allocated,
            );
            const cost = purchase.quantity
              ? Math.floor(
                  (purchase.totalCostCents * (allocated + quantity)) /
                    purchase.quantity,
                ) -
                Math.floor(
                  (purchase.totalCostCents * allocated) / purchase.quantity,
                )
              : 0;
            allocated += quantity;
            await tx
              .update(s.orderItems)
              .set({ fulfilledQuantity: quantity, actualCostCents: cost })
              .where(eq(s.orderItems.id, line.id));
            const total = totals.get(line.orderId)!;
            total.quantity += quantity;
            total.cost += cost;
            total.charge += quantity * line.priceCents;
          }
        }
        let deliveries = 0;
        for (const order of runOrders) {
          const total = totals.get(order.id)!;
          ensure(
            total.charge + (total.quantity ? order.deliveryFeeCents : 0) <=
              100_000_000,
            'Final order total is too large',
          );
          const status = total.quantity
            ? ('ready' as const)
            : ('unavailable' as const);
          if (total.quantity) deliveries++;
          await tx
            .update(s.orders)
            .set({
              status,
              actualTotalCents:
                total.charge + (total.quantity ? order.deliveryFeeCents : 0),
            })
            .where(eq(s.orders.id, order.id));
          await tx.insert(s.orderEvents).values({
            orderId: order.id,
            actorId: actor.id,
            status,
            note: 'Purchases allocated in order of placement; shortages recorded on each item.',
          });
        }
        await tx
          .update(s.marketRuns)
          .set({ status: deliveries ? 'delivering' : 'completed' })
          .where(eq(s.marketRuns.id, id));
        await audit(tx, actor, 'run.shopping_completed', id);
        return { success: true };
      });
    },
    async recordCash(input: {
      orderId: string;
      amountCents: number;
      note: string;
    }) {
      return db.transaction(async (tx) => {
        const [initial] = await tx
          .select()
          .from(s.orders)
          .where(eq(s.orders.id, input.orderId));
        ensure(initial, 'Order not found', 'NOT_FOUND');
        const run = await lockRun(tx, initial.runId);
        if (!actor.admin) {
          await driverCheck(tx, actor);
          ensure(
            run.driverId === actor.id,
            'This is not your delivery',
            'FORBIDDEN',
          );
        }
        const [order] = await tx
          .select()
          .from(s.orders)
          .where(eq(s.orders.id, input.orderId))
          .for('update');
        ensure(
          order &&
            [
              'ready',
              'out_for_delivery',
              'delivery_failed',
              'delivered',
            ].includes(order.status) &&
            order.actualTotalCents !== null,
          'Cash can be recorded after shopping is complete',
          'CONFLICT',
        );
        ensure(
          input.amountCents <= order.actualTotalCents,
          'Cash recorded cannot exceed the order total',
        );
        await tx
          .update(s.orders)
          .set({
            cashCollectedCents: input.amountCents,
            cashRecordedAt: new Date(),
            cashRecordedBy: actor.id,
            cashNote: input.note,
          })
          .where(eq(s.orders.id, input.orderId));
        await audit(tx, actor, 'order.cash_recorded', input.orderId);
        await tx.insert(s.orderEvents).values({
          orderId: order.id,
          actorId: actor.id,
          status: order.status,
          note: `Cash collection record set to $${(input.amountCents / 100).toFixed(2)}.${input.note ? ' ' + input.note : ''}`,
        });
        return { success: true };
      });
    },
    async deliver(input: {
      orderId: string;
      status: 'out_for_delivery' | 'delivered' | 'delivery_failed';
      note: string;
    }) {
      return db.transaction(async (tx) => {
        const [initial] = await tx
          .select()
          .from(s.orders)
          .where(eq(s.orders.id, input.orderId));
        ensure(initial, 'Order not found', 'NOT_FOUND');
        const run = await lockRun(tx, initial.runId);
        await driverCheck(tx, actor);
        ensure(
          run.driverId === actor.id,
          'This is not your delivery',
          'FORBIDDEN',
        );
        ensure(
          run.endsAt > (await clock(tx)),
          'The market has closed; this order can no longer be fulfilled',
          'CONFLICT',
        );
        const [order] = await tx
          .select()
          .from(s.orders)
          .where(eq(s.orders.id, input.orderId))
          .for('update');
        ensure(
          run.status === 'delivering',
          'Run is not delivering',
          'CONFLICT',
        );
        const valid =
          input.status === 'out_for_delivery'
            ? ['ready', 'delivery_failed'].includes(order!.status)
            : order!.status === 'out_for_delivery';
        ensure(valid, 'Invalid delivery status transition', 'CONFLICT');
        ensure(
          input.status !== 'delivery_failed' || input.note.trim().length > 0,
          'Please give a reason for the failed delivery',
        );
        await tx
          .update(s.orders)
          .set({
            status: input.status,
            deliveredAt: input.status === 'delivered' ? new Date() : null,
          })
          .where(eq(s.orders.id, input.orderId));
        await tx.insert(s.orderEvents).values({
          orderId: input.orderId,
          actorId: actor.id,
          status: input.status,
          note: input.note,
        });
        const remaining = await tx
          .select({ id: s.orders.id })
          .from(s.orders)
          .where(
            and(
              eq(s.orders.runId, run.id),
              inArray(s.orders.status, [
                'placed',
                'ready',
                'out_for_delivery',
                'delivery_failed',
              ]),
            ),
          );
        if (!remaining.length)
          await tx
            .update(s.marketRuns)
            .set({ status: 'completed' })
            .where(eq(s.marketRuns.id, run.id));
        return { success: true };
      });
    },
    async cancelRun(id: string, options: { allowOrders?: boolean } = {}) {
      admin();
      return db.transaction(async (tx) => {
        const run = await lockRun(tx, id);
        ensure(
          run.status === 'scheduled',
          'Only scheduled runs can be cancelled',
          'CONFLICT',
        );
        if (options.allowOrders === false) {
          const [order] = await tx
            .select({ id: s.orders.id })
            .from(s.orders)
            .where(eq(s.orders.runId, id))
            .limit(1);
          ensure(
            !order,
            'MCP order access is read-only; a run with orders must be cancelled through the app',
            'CONFLICT',
          );
        }
        const cancelled = await tx
          .update(s.orders)
          .set({ status: 'cancelled', actualTotalCents: 0 })
          .where(and(eq(s.orders.runId, id), eq(s.orders.status, 'placed')))
          .returning();
        if (cancelled.length)
          await tx.insert(s.orderEvents).values(
            cancelled.map((o) => ({
              orderId: o.id,
              actorId: actor.id,
              status: 'cancelled' as const,
              note: 'Market run cancelled by operations.',
            })),
          );
        await tx
          .update(s.inventory)
          .set({ reservedQuantity: 0 })
          .where(eq(s.inventory.runId, id));
        await tx
          .update(s.marketRuns)
          .set({ status: 'cancelled' })
          .where(eq(s.marketRuns.id, id));
        await audit(tx, actor, 'run.cancelled', id);
        return { success: true };
      });
    },
  };
}
