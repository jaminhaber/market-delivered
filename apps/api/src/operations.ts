import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import * as s from '@market/db';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { addressInput, formatAddress } from './addresses.js';
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
      new Date(v.deliveryStartAt) < new Date(v.endsAt) &&
      new Date(v.deliveryEndAt) > new Date(v.deliveryStartAt),
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
    (v) => v.deliveryDelayMinutes < v.closesMinute - v.opensMinute,
    'Delivery must start before the market closes',
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
export const farmInput = z.object({
  name: z.string().trim().min(2).max(150),
  location: z.string().trim().min(2).max(500),
  contactPhone: z.string().trim().max(30).default(''),
  notes: z.string().trim().max(1000).default(''),
  active: z.boolean().default(true),
});
export const produceInput = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(500),
  category: z.enum(s.produceCategory.enumValues),
  unit: z.enum(s.produceUnit.enumValues),
  farmId: z.uuid(),
});
export const claimBatchInput = z.object({
  runId: z.uuid(),
  orderIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate order IDs'),
});
export const customerProfileInput = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  ...addressInput.shape,
  deliveryNotes: z.string().trim().max(500),
});
export const driverProfileInput = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().min(7).max(30),
  vehicle: z.string().trim().min(2).max(200),
});
export type ClaimResult =
  | { orderId: string; status: 'claimed' | 'already_claimed' }
  | {
      orderId: string;
      status: 'failed';
      code: 'NOT_FOUND' | 'CONFLICT' | 'BAD_REQUEST';
      message: string;
    };
export const combinedPurchaseInput = z.object({
  runId: z.uuid(),
  inventoryId: z.uuid(),
  quantity: z.number().int().min(0).max(100_000_000),
  totalCostCents: z.number().int().min(0).max(100_000_000),
  allocations: z
    .array(
      z.object({
        orderItemId: z.uuid(),
        quantity: z.number().int().min(0).max(100_000),
        expectedPurchaseUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
      }),
    )
    .min(1)
    .max(1000)
    .refine(
      (rows) =>
        new Set(rows.map((row) => row.orderItemId)).size === rows.length,
      'Duplicate order items',
    ),
});
export async function lockRun(
  tx: Tx,
  id: string,
  strength: 'update' | 'share' = 'update',
) {
  const [run] = await tx
    .select()
    .from(s.marketRuns)
    .where(eq(s.marketRuns.id, id))
    .for(strength);
  ensure(run, 'Market run not found', 'NOT_FOUND');
  return run;
}
export async function lockOrder(tx: Tx, id: string) {
  const [initial] = await tx.select().from(s.orders).where(eq(s.orders.id, id));
  ensure(initial, 'Order not found', 'NOT_FOUND');
  const run = await lockRun(tx, initial.runId);
  const [order] = await tx
    .select()
    .from(s.orders)
    .where(eq(s.orders.id, id))
    .for('update');
  ensure(order, 'Order not found', 'NOT_FOUND');
  return { order, run };
}
async function clock(tx: Tx) {
  const {
    rows: [row],
  } = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
  return new Date(row!.now);
}
async function purchaseVersion(tx: Tx, previous: Date[]) {
  // JSON/JavaScript timestamps have millisecond precision; every write advances it.
  const now = await clock(tx);
  return new Date(Math.max(+now, ...previous.map((value) => +value + 1)));
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
    .where(eq(s.driverProfiles.userId, actor.id))
    .for('share');
  ensure(
    driver?.status === 'approved' &&
      driver.phone.length >= 7 &&
      driver.vehicle.length >= 2,
    'An approved driver profile is required',
    'FORBIDDEN',
  );
}
async function claimOrders(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof claimBatchInput>,
) {
  // Claims share the date lock; closing/cancellation still take its exclusive lock.
  const run = await lockRun(tx, input.runId, 'share');
  await driverCheck(tx, actor);
  const rows = await tx
    .select()
    .from(s.orders)
    .where(
      and(
        eq(s.orders.runId, input.runId),
        inArray(s.orders.id, input.orderIds),
      ),
    )
    .orderBy(asc(s.orders.id))
    .for('update');
  const byId = new Map(rows.map((row) => [row.id, row]));
  const now = await clock(tx);
  const results: ClaimResult[] = input.orderIds.map((orderId) => {
    const order = byId.get(orderId);
    if (!order)
      return {
        orderId,
        status: 'failed',
        code: 'NOT_FOUND',
        message: 'Order not found for this market date',
      };
    if (
      order.driverId === actor.id &&
      !['placed', 'cancelled'].includes(order.status)
    )
      return { orderId, status: 'already_claimed' };
    if (run.status !== 'scheduled' || run.endsAt <= now)
      return {
        orderId,
        status: 'failed',
        code: 'CONFLICT',
        message: 'The market is no longer available for claims',
      };
    if (order.status !== 'placed' || order.driverId)
      return {
        orderId,
        status: 'failed',
        code: 'CONFLICT',
        message:
          'Another driver has claimed this order or it is no longer available',
      };
    return { orderId, status: 'claimed' };
  });
  const ids = results
    .filter((result) => result.status === 'claimed')
    .map((result) => result.orderId);
  const updated = ids.length
    ? await tx
        .update(s.orders)
        .set({ driverId: actor.id, claimedAt: now, status: 'claimed' })
        .where(inArray(s.orders.id, ids))
        .returning()
    : [];
  if (ids.length) {
    await tx.insert(s.orderEvents).values(
      ids.map((orderId) => ({
        orderId,
        actorId: actor.id,
        status: 'claimed' as const,
        note: 'A driver claimed your order.',
      })),
    );
    await tx.insert(s.auditEvents).values(
      ids.map((targetId) => ({
        actorId: actor.id,
        action: 'order.claimed',
        targetId,
      })),
    );
  }
  return {
    results,
    orders: rows.map(
      (row) => updated.find((order) => order.id === row.id) ?? row,
    ),
  };
}
async function lockDriverTrip(tx: Tx, actor: Actor, runId: string) {
  const run = await lockRun(tx, runId);
  await driverCheck(tx, actor);
  const orders = await tx
    .select()
    .from(s.orders)
    .where(
      and(
        eq(s.orders.runId, runId),
        eq(s.orders.driverId, actor.id),
        sql`${s.orders.status} <> 'cancelled'`,
      ),
    )
    .orderBy(asc(s.orders.id))
    .for('update');
  ensure(orders.length, 'No assigned orders for this market date', 'NOT_FOUND');
  return { run, orders };
}
async function finalizeShopping(
  tx: Tx,
  actor: Actor,
  order: typeof s.orders.$inferSelect,
) {
  const items = await tx
    .select({ item: s.orderItems, purchase: s.purchases })
    .from(s.orderItems)
    .leftJoin(s.purchases, eq(s.purchases.orderItemId, s.orderItems.id))
    .where(eq(s.orderItems.orderId, order.id));
  let quantity = 0,
    charge = 0;
  for (const { item, purchase } of items) {
    ensure(
      purchase,
      'Record every shopping item, including unavailable items with zero quantity',
    );
    ensure(
      purchase.quantity <= item.quantity,
      'Purchase exceeds ordered quantity',
    );
    await tx
      .update(s.orderItems)
      .set({
        fulfilledQuantity: purchase.quantity,
        actualCostCents: purchase.totalCostCents,
      })
      .where(eq(s.orderItems.id, item.id));
    quantity += purchase.quantity;
    charge += purchase.quantity * item.priceCents;
  }
  const actualTotalCents = charge + (quantity ? order.deliveryFeeCents : 0);
  ensure(actualTotalCents <= 100_000_000, 'Final order total is too large');
  const status = quantity ? ('ready' as const) : ('unavailable' as const);
  await tx
    .update(s.orders)
    .set({ status, actualTotalCents })
    .where(eq(s.orders.id, order.id));
  await tx.insert(s.orderEvents).values({
    orderId: order.id,
    actorId: actor.id,
    status,
    note: 'Shopping complete; purchased quantities and shortages recorded.',
  });
}
export function operations(db: s.Database, actor: Actor) {
  function admin() {
    ensure(actor.admin, 'Administrator access required', 'FORBIDDEN');
  }
  return {
    async saveCustomerProfile(input: z.infer<typeof customerProfileInput>) {
      return db.transaction(async (tx) => {
        await tx
          .update(s.user)
          .set({ name: input.name })
          .where(eq(s.user.id, actor.id));
        const { name: _name, ...fields } = input;
        const [previous] = await tx
          .select()
          .from(s.customerProfiles)
          .where(eq(s.customerProfiles.userId, actor.id))
          .for('update');
        const changed =
          !previous ||
          Object.keys(addressInput.shape).some(
            (key) =>
              previous[key as keyof typeof fields] !==
              fields[key as keyof typeof fields],
          );
        const profile = {
          ...fields,
          address: formatAddress(fields),
          ...(changed
            ? {
                googlePlaceId: null,
                latitude: null,
                longitude: null,
                geocodedAddress: null,
                geocodedAt: null,
                geocoder: null,
              }
            : {}),
        };
        await tx
          .insert(s.customerProfiles)
          .values({ userId: actor.id, ...profile })
          .onConflictDoUpdate({
            target: s.customerProfiles.userId,
            set: profile,
          });
        return { success: true };
      });
    },
    async saveAddressLocation(
      address: z.infer<typeof addressInput>,
      googlePlaceId: string | null,
    ) {
      const [updated] = await db
        .update(s.customerProfiles)
        .set({
          googlePlaceId: googlePlaceId,
          latitude: null,
          longitude: null,
          geocodedAddress: null,
          geocoder: 'google',
          geocodedAt: new Date(),
        })
        .where(
          and(
            eq(s.customerProfiles.userId, actor.id),
            ...Object.keys(addressInput.shape).map((key) =>
              eq(
                s.customerProfiles[key as keyof typeof address],
                address[key as keyof typeof address],
              ),
            ),
          ),
        )
        .returning({ userId: s.customerProfiles.userId });
      ensure(
        updated,
        'Your address changed during lookup. Try again.',
        'CONFLICT',
      );
      return { success: true };
    },
    async saveDriverProfile(input: z.infer<typeof driverProfileInput>) {
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(s.driverProfiles)
          .where(eq(s.driverProfiles.userId, actor.id));
        ensure(
          existing,
          'Driver access requires a driver invitation.',
          'FORBIDDEN',
        );
        await tx
          .update(s.driverProfiles)
          .set({ phone: input.phone, vehicle: input.vehicle })
          .where(eq(s.driverProfiles.userId, actor.id));
        if (input.name)
          await tx
            .update(s.user)
            .set({ name: input.name })
            .where(eq(s.user.id, actor.id));
        return { success: true };
      });
    },
    async createInvitation(input: {
      email: string;
      role: 'customer' | 'driver';
    }) {
      admin();
      return db.transaction(async (tx) => {
        const token = randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 86400000);
        const [invitation] = await tx
          .insert(s.invitations)
          .values({
            ...input,
            createdBy: actor.id,
            tokenHash: createHash('sha256').update(token).digest('hex'),
            expiresAt,
          })
          .returning({ id: s.invitations.id });
        await audit(tx, actor, 'invitation.created', invitation!.id);
        return { token, id: invitation!.id, expiresAt };
      });
    },
    async revokeInvitation(id: string) {
      admin();
      return db.transaction(async (tx) => {
        await tx
          .update(s.invitations)
          .set({ revokedAt: new Date() })
          .where(eq(s.invitations.id, id));
        await audit(tx, actor, 'invitation.revoked', id);
        return { success: true };
      });
    },
    async createApiToken(name: string) {
      admin();
      return db.transaction(async (tx) => {
        const token = `md_${randomBytes(32).toString('hex')}`;
        const [saved] = await tx
          .insert(s.apiTokens)
          .values({
            userId: actor.id,
            name,
            tokenHash: createHash('sha256').update(token).digest('hex'),
            lastFour: token.slice(-4),
            expiresAt: new Date(Date.now() + 90 * 86400000),
          })
          .returning({ id: s.apiTokens.id });
        await audit(tx, actor, 'api_token.created', saved!.id);
        return { token };
      });
    },
    async revokeApiToken(id: string) {
      admin();
      return db.transaction(async (tx) => {
        const [saved] = await tx
          .update(s.apiTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(s.apiTokens.id, id), eq(s.apiTokens.userId, actor.id)))
          .returning({ id: s.apiTokens.id });
        if (saved) await audit(tx, actor, 'api_token.revoked', id);
        return { success: true };
      });
    },
    async createFarm(input: z.infer<typeof farmInput>) {
      admin();
      return db.transaction(async (tx) => {
        const [farm] = await tx.insert(s.farms).values(input).returning();
        await audit(tx, actor, 'farm.created', farm!.id);
        return farm!;
      });
    },
    async updateFarm(id: string, input: z.infer<typeof farmInput>) {
      admin();
      return db.transaction(async (tx) => {
        const [farm] = await tx
          .update(s.farms)
          .set(input)
          .where(eq(s.farms.id, id))
          .returning();
        ensure(farm, 'Farm not found', 'NOT_FOUND');
        await audit(
          tx,
          actor,
          input.active ? 'farm.updated' : 'farm.archived',
          id,
        );
        return farm;
      });
    },
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
        const [farm] = await tx
          .select()
          .from(s.farms)
          .where(eq(s.farms.id, input.farmId))
          .for('share');
        ensure(farm?.active, 'Choose an active farm');
        if (item.farmId !== input.farmId) {
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
            'Farm cannot change after inventory exists; create a new catalog item',
            'CONFLICT',
          );
        }
        const [updated] = await tx
          .update(s.produce)
          .set({
            name: input.name,
            description: input.description,
            category: input.category,
            unit: input.unit,
            farmId: input.farmId,
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
        const [farm] = await tx
          .select()
          .from(s.farms)
          .where(eq(s.farms.id, input.farmId))
          .for('share');
        ensure(farm?.active, 'Choose an active farm');
        const [item] = await tx
          .insert(s.produce)
          .values({
            farmId: input.farmId,
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
    async assignDriver(input: { orderId: string; driverId: string | null }) {
      admin();
      return db.transaction(async (tx) => {
        const { order, run } = await lockOrder(tx, input.orderId);
        ensure(
          [
            'placed',
            'claimed',
            'shopping',
            'ready',
            'out_for_delivery',
            'delivery_failed',
          ].includes(order.status),
          'Only active orders can be reassigned',
          'CONFLICT',
        );
        ensure(
          input.driverId !== null ||
            ['placed', 'claimed'].includes(order.status),
          'An in-progress order needs a replacement driver',
          'CONFLICT',
        );
        if (['placed', 'claimed'].includes(order.status))
          ensure(
            run.endsAt > (await clock(tx)) && run.status !== 'cancelled',
            'The market has closed',
            'CONFLICT',
          );
        if (input.driverId)
          await driverCheck(tx, { ...actor, id: input.driverId });
        const status = ['placed', 'claimed'].includes(order.status)
          ? input.driverId
            ? ('claimed' as const)
            : ('placed' as const)
          : order.status;
        const [updated] = await tx
          .update(s.orders)
          .set({
            driverId: input.driverId,
            claimedAt: input.driverId ? new Date() : null,
            status,
          })
          .where(eq(s.orders.id, order.id))
          .returning();
        await tx.insert(s.orderEvents).values({
          orderId: order.id,
          actorId: actor.id,
          status,
          note: 'Operations updated the assigned driver.',
        });
        await audit(tx, actor, 'order.driver_assigned', order.id);
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
          .select({ inventory: s.inventory, produce: s.produce, farm: s.farms })
          .from(s.inventory)
          .innerJoin(s.produce, eq(s.inventory.produceId, s.produce.id))
          .innerJoin(s.farms, eq(s.farms.id, s.produce.farmId))
          .where(
            inArray(
              s.inventory.id,
              input.items.map((i) => i.inventoryId),
            ),
          )
          .for('share', { of: s.farms });
        ensure(
          stock.length === input.items.length,
          'Some items no longer exist',
        );
        let total = run.deliveryFeeCents;
        const lines = input.items.map((item) => {
          const row = stock.find((r) => r.inventory.id === item.inventoryId)!;
          ensure(
            row.inventory.runId === run.id &&
              row.inventory.active &&
              row.farm.active,
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
            farmId: row.farm.id,
            farmName: row.farm.name,
            farmLocation: row.farm.location,
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
          ['placed', 'claimed'].includes(order!.status) &&
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
    async claimBatch(input: z.infer<typeof claimBatchInput>) {
      return db.transaction(async (tx) => {
        const { results } = await claimOrders(
          tx,
          actor,
          claimBatchInput.parse(input),
        );
        return { results };
      });
    },
    async claimOrder(id: string) {
      return db.transaction(async (tx) => {
        const [initial] = await tx
          .select({ runId: s.orders.runId })
          .from(s.orders)
          .where(eq(s.orders.id, id));
        ensure(initial, 'Order not found', 'NOT_FOUND');
        const { results, orders } = await claimOrders(tx, actor, {
          runId: initial.runId,
          orderIds: [id],
        });
        const result = results[0]!;
        if (result.status === 'failed')
          throw new TRPCError({ code: result.code, message: result.message });
        return orders[0]!;
      });
    },
    async releaseOrder(id: string) {
      return db.transaction(async (tx) => {
        const { order } = await lockOrder(tx, id);
        await driverCheck(tx, actor);
        ensure(
          order.driverId === actor.id,
          'This is not your order',
          'FORBIDDEN',
        );
        ensure(
          order.status === 'claimed',
          'An order can only be released before shopping starts',
          'CONFLICT',
        );
        await tx
          .update(s.orders)
          .set({ status: 'placed', driverId: null, claimedAt: null })
          .where(eq(s.orders.id, id));
        await tx.insert(s.orderEvents).values({
          orderId: id,
          actorId: actor.id,
          status: 'placed',
          note: 'Driver released the order for another driver.',
        });
        return { success: true };
      });
    },
    async startShoppingBatch(runId: string) {
      return db.transaction(async (tx) => {
        const { run, orders } = await lockDriverTrip(tx, actor, runId);
        const ids = orders
          .filter((order) => order.status === 'claimed')
          .map((order) => order.id);
        if (!ids.length) return { ordersStarted: 0 };
        const now = await clock(tx);
        ensure(
          run.startsAt <= now && run.endsAt > now && run.status !== 'cancelled',
          'Shopping starts while the market is open',
          'CONFLICT',
        );
        await tx
          .update(s.orders)
          .set({ status: 'shopping' })
          .where(inArray(s.orders.id, ids));
        await tx.insert(s.orderEvents).values(
          ids.map((orderId) => ({
            orderId,
            actorId: actor.id,
            status: 'shopping' as const,
          })),
        );
        await audit(tx, actor, 'shopping.batch_started', runId);
        return { ordersStarted: ids.length };
      });
    },
    async recordCombinedPurchase(input: z.infer<typeof combinedPurchaseInput>) {
      return db.transaction(async (tx) => {
        const { orders } = await lockDriverTrip(tx, actor, input.runId);
        const shopping = orders.filter((order) => order.status === 'shopping');
        ensure(
          shopping.length,
          'Start shopping before recording purchases',
          'CONFLICT',
        );
        const items = await tx
          .select()
          .from(s.orderItems)
          .where(
            and(
              inArray(
                s.orderItems.orderId,
                shopping.map((order) => order.id),
              ),
              eq(s.orderItems.inventoryId, input.inventoryId),
            ),
          )
          .orderBy(asc(s.orderItems.id));
        const supplied = new Map(
          input.allocations.map((row) => [row.orderItemId, row]),
        );
        ensure(
          items.length > 0 &&
            items.length === supplied.size &&
            items.every((item) => supplied.has(item.id)),
          'The shopping list changed; refresh and review the allocations',
          'CONFLICT',
        );
        const existing = await tx
          .select()
          .from(s.purchases)
          .where(
            inArray(
              s.purchases.orderItemId,
              items.map((item) => item.id),
            ),
          );
        let quantity = 0;
        for (const item of items) {
          const allocation = supplied.get(item.id)!;
          ensure(
            allocation.quantity <= item.quantity,
            'Allocated quantity exceeds the customer order',
          );
          const purchase = existing.find((row) => row.orderItemId === item.id);
          ensure(
            (purchase?.updatedAt.toISOString() ?? null) ===
              (allocation.expectedPurchaseUpdatedAt
                ? new Date(allocation.expectedPurchaseUpdatedAt).toISOString()
                : null),
            'A purchase record changed; refresh before saving',
            'CONFLICT',
          );
          quantity += allocation.quantity;
        }
        ensure(
          quantity === input.quantity,
          'Allocated quantities must equal the purchased quantity',
        );
        ensure(
          quantity > 0 || input.totalCostCents === 0,
          'Unavailable items must have zero cost',
        );
        // Stable placement order determines only the rounding pennies; quantities are explicit.
        const priority = new Map(
          [...shopping]
            .sort(
              (a, b) => +a.createdAt - +b.createdAt || a.id.localeCompare(b.id),
            )
            .map((order, index) => [order.id, index]),
        );
        items.sort(
          (a, b) =>
            priority.get(a.orderId)! - priority.get(b.orderId)! ||
            a.id.localeCompare(b.id),
        );
        let cumulative = 0;
        const now = await purchaseVersion(
          tx,
          existing.map((purchase) => purchase.updatedAt),
        );
        const records = items.map((item) => {
          const bought = supplied.get(item.id)!.quantity;
          const before = cumulative;
          cumulative += bought;
          const cost = quantity
            ? Number(
                (BigInt(input.totalCostCents) * BigInt(cumulative)) /
                  BigInt(quantity) -
                  (BigInt(input.totalCostCents) * BigInt(before)) /
                    BigInt(quantity),
              )
            : 0;
          return {
            orderItemId: item.id,
            quantity: bought,
            totalCostCents: cost,
            recordedBy: actor.id,
            updatedAt: now,
          };
        });
        await tx
          .insert(s.purchases)
          .values(records)
          .onConflictDoUpdate({
            target: s.purchases.orderItemId,
            set: {
              quantity: sql`excluded.quantity`,
              totalCostCents: sql`excluded.total_cost_cents`,
              recordedBy: actor.id,
              updatedAt: now,
            },
          });
        await tx.insert(s.auditEvents).values(
          items.map((item) => ({
            actorId: actor.id,
            action: 'purchase.recorded',
            targetId: item.id,
          })),
        );
        return {
          quantity,
          totalCostCents: input.totalCostCents,
          allocations: records.map((record) => ({
            orderItemId: record.orderItemId,
            quantity: record.quantity,
            totalCostCents: record.totalCostCents,
          })),
        };
      });
    },
    async finishShoppingBatch(runId: string) {
      return db.transaction(async (tx) => {
        const { orders } = await lockDriverTrip(tx, actor, runId);
        const shopping = orders.filter((order) => order.status === 'shopping');
        for (const order of shopping) await finalizeShopping(tx, actor, order);
        if (shopping.length)
          await audit(tx, actor, 'shopping.batch_finished', runId);
        return { ordersCompleted: shopping.length };
      });
    },
    async setPacked(input: {
      orderId: string;
      orderItemId: string;
      packed: boolean;
    }) {
      return db.transaction(async (tx) => {
        const { order } = await lockOrder(tx, input.orderId);
        await driverCheck(tx, actor);
        ensure(
          order.driverId === actor.id,
          'This is not your order',
          'FORBIDDEN',
        );
        ensure(
          ['ready', 'out_for_delivery', 'delivery_failed'].includes(
            order.status,
          ),
          'Finish shopping before packing this order',
          'CONFLICT',
        );
        const [item] = await tx
          .select()
          .from(s.orderItems)
          .where(
            and(
              eq(s.orderItems.id, input.orderItemId),
              eq(s.orderItems.orderId, order.id),
            ),
          );
        ensure(item, 'Order item not found', 'NOT_FOUND');
        ensure(
          item.fulfilledQuantity !== null && item.fulfilledQuantity > 0,
          'Unavailable items cannot be packed',
        );
        const packedAt = input.packed
          ? (item.packedAt ?? (await clock(tx)))
          : null;
        await tx
          .update(s.orderItems)
          .set({ packedAt })
          .where(eq(s.orderItems.id, item.id));
        await audit(
          tx,
          actor,
          input.packed ? 'item.packed' : 'item.unpacked',
          item.id,
        );
        return { packedAt };
      });
    },
    async startShopping(id: string) {
      return db.transaction(async (tx) => {
        const { order, run } = await lockOrder(tx, id);
        await driverCheck(tx, actor);
        ensure(
          order.driverId === actor.id,
          'This is not your order',
          'FORBIDDEN',
        );
        const now = await clock(tx);
        ensure(
          order.status === 'claimed' &&
            run.startsAt <= now &&
            run.endsAt > now &&
            run.status !== 'cancelled',
          'Shopping starts while the market is open, after claiming the order',
          'CONFLICT',
        );
        await tx
          .update(s.orders)
          .set({ status: 'shopping' })
          .where(eq(s.orders.id, id));
        await tx
          .insert(s.orderEvents)
          .values({ orderId: id, actorId: actor.id, status: 'shopping' });
        return { success: true };
      });
    },
    async recordPurchase(input: {
      orderId: string;
      orderItemId: string;
      quantity: number;
      totalCostCents: number;
    }) {
      return db.transaction(async (tx) => {
        const { order } = await lockOrder(tx, input.orderId);
        await driverCheck(tx, actor);
        ensure(
          order.driverId === actor.id,
          'This is not your order',
          'FORBIDDEN',
        );
        ensure(
          order.status === 'shopping',
          'Order must be in the shopping phase',
          'CONFLICT',
        );
        const [item] = await tx
          .select()
          .from(s.orderItems)
          .where(
            and(
              eq(s.orderItems.id, input.orderItemId),
              eq(s.orderItems.orderId, order.id),
            ),
          );
        ensure(item, 'Order item not found', 'NOT_FOUND');
        ensure(
          input.quantity <= item.quantity,
          'Purchased quantity cannot exceed ordered quantity',
        );
        ensure(
          input.quantity > 0 || input.totalCostCents === 0,
          'Unavailable items must have zero cost',
        );
        const [previous] = await tx
          .select({ updatedAt: s.purchases.updatedAt })
          .from(s.purchases)
          .where(eq(s.purchases.orderItemId, item.id));
        const updatedAt = await purchaseVersion(
          tx,
          previous ? [previous.updatedAt] : [],
        );
        await tx
          .insert(s.purchases)
          .values({
            orderItemId: item.id,
            quantity: input.quantity,
            totalCostCents: input.totalCostCents,
            recordedBy: actor.id,
            updatedAt,
          })
          .onConflictDoUpdate({
            target: s.purchases.orderItemId,
            set: {
              quantity: input.quantity,
              totalCostCents: input.totalCostCents,
              recordedBy: actor.id,
              updatedAt,
            },
          });
        await audit(tx, actor, 'purchase.recorded', item.id);
        return { success: true };
      });
    },
    async finishShopping(id: string) {
      return db.transaction(async (tx) => {
        const { order } = await lockOrder(tx, id);
        await driverCheck(tx, actor);
        ensure(
          order.driverId === actor.id,
          'This is not your order',
          'FORBIDDEN',
        );
        ensure(
          order.status === 'shopping',
          'Order must be in the shopping phase',
          'CONFLICT',
        );
        await finalizeShopping(tx, actor, order);
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
        await lockRun(tx, initial.runId);
        const [assigned] = await tx
          .select()
          .from(s.orders)
          .where(eq(s.orders.id, input.orderId));
        if (!actor.admin) {
          await driverCheck(tx, actor);
          ensure(
            assigned?.driverId === actor.id,
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
        await lockRun(tx, initial.runId);
        const [assigned] = await tx
          .select()
          .from(s.orders)
          .where(eq(s.orders.id, input.orderId));
        await driverCheck(tx, actor);
        ensure(
          assigned?.driverId === actor.id,
          'This is not your delivery',
          'FORBIDDEN',
        );
        const [order] = await tx
          .select()
          .from(s.orders)
          .where(eq(s.orders.id, input.orderId))
          .for('update');
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
        const [inProgress] = await tx
          .select({ id: s.orders.id })
          .from(s.orders)
          .where(
            and(
              eq(s.orders.runId, id),
              inArray(s.orders.status, [
                'shopping',
                'ready',
                'out_for_delivery',
                'delivery_failed',
                'delivered',
              ]),
            ),
          )
          .limit(1);
        ensure(
          !inProgress,
          'Orders already being fulfilled must be resolved individually',
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
          .where(
            and(
              eq(s.orders.runId, id),
              inArray(s.orders.status, ['placed', 'claimed']),
            ),
          )
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
