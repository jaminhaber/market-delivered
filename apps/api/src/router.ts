import { initTRPC, TRPCError, type inferRouterOutputs } from '@trpc/server';
import { and, asc, eq, ilike, or, sql, desc } from 'drizzle-orm';
import * as s from '@market/db';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  ensure,
  claimBatchInput,
  combinedPurchaseInput,
  customerProfileInput,
  driverProfileInput,
  operations,
  marketInput,
  runInput,
  inventoryInput,
  produceInput,
  farmInput,
  scheduleInput,
  scheduleInventoryInput,
  type Actor,
} from './operations.js';
import {
  addressInput,
  geocodeAddress,
  suggestAddresses,
  resolveAddress,
} from './addresses.js';
import {
  driverOrderDetail,
  driverOrderGroups,
  driverShoppingList,
  driverOrders,
  myOrders,
  runDetail,
} from './queries.js';
import { checkRateLimit } from './rate-limit.js';
export type Context = {
  db: s.Database;
  actor: Actor | null;
  googleMapsKey?: string;
};
const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      message:
        error.code === 'INTERNAL_SERVER_ERROR'
          ? 'Unable to complete the request.'
          : shape.message,
      data: { ...shape.data, stack: undefined },
    };
  },
});
const publicProcedure = t.procedure;
const authenticated = t.procedure.use(({ ctx, next }) => {
  if (!ctx.actor)
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Please sign in' });
  return next({
    ctx: { ...ctx, actor: ctx.actor, ops: operations(ctx.db, ctx.actor) },
  });
});
const admin = authenticated.use(({ ctx, next }) => {
  ensure(ctx.actor.admin, 'Administrator access required', 'FORBIDDEN');
  return next();
});
const addressProcedure = authenticated.use(async ({ ctx, next, path }) => {
  await checkRateLimit(
    ctx.db,
    `address:${path}:${ctx.actor.id}`,
    path === 'addresses.suggest' ? 60 : 10,
    60_000,
  );
  return next();
});
const id = z.object({ id: z.uuid() });
export const appRouter = t.router({
  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.actor) return null;
    const [customer] = await ctx.db
      .select()
      .from(s.customerProfiles)
      .where(eq(s.customerProfiles.userId, ctx.actor.id));
    const [driver] = await ctx.db
      .select()
      .from(s.driverProfiles)
      .where(eq(s.driverProfiles.userId, ctx.actor.id));
    return { ...ctx.actor, customer: customer ?? null, driver: driver ?? null };
  }),
  invitation: publicProcedure
    .input(z.object({ token: z.string().min(32).max(256) }))
    .query(async ({ ctx, input }) => {
      const [invite] = await ctx.db
        .select({ email: s.invitations.email })
        .from(s.invitations)
        .where(
          and(
            eq(
              s.invitations.tokenHash,
              createHash('sha256').update(input.token).digest('hex'),
            ),
            sql`${s.invitations.expiresAt} > now()`,
            sql`${s.invitations.usedAt} IS NULL`,
            sql`${s.invitations.revokedAt} IS NULL`,
          ),
        );
      ensure(invite, 'This invitation is invalid or expired.', 'NOT_FOUND');
      return invite;
    }),
  addresses: t.router({
    suggest: addressProcedure
      .input(
        z.object({
          input: z.string().trim().min(3).max(200),
          sessionToken: z.uuid(),
        }),
      )
      .mutation(({ ctx, input }) =>
        suggestAddresses(input.input, input.sessionToken, ctx.googleMapsKey),
      ),
    resolve: addressProcedure
      .input(
        z.object({
          placeId: z
            .string()
            .min(1)
            .max(300)
            .regex(/^[A-Za-z0-9_-]+$/),
          sessionToken: z.uuid(),
        }),
      )
      .mutation(({ ctx, input }) =>
        resolveAddress(input.placeId, input.sessionToken, ctx.googleMapsKey),
      ),
  }),
  profile: t.router({
    save: authenticated
      .input(customerProfileInput)
      .mutation(({ ctx, input }) => ctx.ops.saveCustomerProfile(input)),
    locateAddress: addressProcedure.mutation(async ({ ctx }) => {
      const [profile] = await ctx.db
        .select()
        .from(s.customerProfiles)
        .where(eq(s.customerProfiles.userId, ctx.actor.id));
      ensure(profile, 'Save your delivery address first');
      const address = addressInput.parse(profile);
      const match = await geocodeAddress(address, ctx.googleMapsKey);
      if (match.needsReview) return { success: false, ...match };
      await ctx.ops.saveAddressLocation(address, match.googlePlaceId);
      return { success: true, ...match };
    }),
    saveDriver: authenticated
      .input(driverProfileInput)
      .mutation(({ ctx, input }) => ctx.ops.saveDriverProfile(input)),
  }),
  produce: t.router({
    categories: authenticated.query(() => s.produceCategory.enumValues),
    list: authenticated
      .input(
        z
          .object({
            search: z.string().trim().max(100).default(''),
            category: z.enum(s.produceCategory.enumValues).optional(),
          })
          .default({ search: '' }),
      )
      .query(async ({ ctx, input }) => {
        const search = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`;
        return ctx.db
          .select({
            id: s.produce.id,
            name: s.produce.name,
            description: s.produce.description,
            category: s.produce.category,
            unit: s.produce.unit,
            priceCents: s.produce.priceCents,
            availableQuantity: s.produce.availableQuantity,
            farm: {
              id: s.farms.id,
              name: s.farms.name,
              location: s.farms.location,
            },
          })
          .from(s.produce)
          .innerJoin(s.farms, eq(s.produce.farmId, s.farms.id))
          .where(
            and(
              input.category
                ? eq(s.produce.category, input.category)
                : undefined,
              input.search
                ? or(ilike(s.produce.name, search), ilike(s.farms.name, search))
                : undefined,
            ),
          )
          .orderBy(asc(s.produce.name))
          .limit(100);
      }),
  }),
  markets: t.router({
    list: authenticated.query(({ ctx }) =>
      ctx.db.select().from(s.markets).orderBy(asc(s.markets.name)),
    ),
    runs: authenticated.query(async ({ ctx }) => {
      return ctx.db
        .select({
          id: s.marketRuns.id,
          marketId: s.marketRuns.marketId,
          marketName: s.markets.name,
          marketAddress: s.markets.address,
          timezone: s.markets.timezone,
          startsAt: s.marketRuns.startsAt,
          endsAt: s.marketRuns.endsAt,
          cutoffAt: s.marketRuns.cutoffAt,
          deliveryStartAt: s.marketRuns.deliveryStartAt,
          deliveryEndAt: s.marketRuns.deliveryEndAt,
          deliveryFeeCents: s.marketRuns.deliveryFeeCents,
          status: s.marketRuns.status,
        })
        .from(s.marketRuns)
        .innerJoin(s.markets, eq(s.marketRuns.marketId, s.markets.id))
        .where(
          sql`${s.marketRuns.cutoffAt} > now() AND ${s.marketRuns.startsAt} <= now() + interval '14 days' AND ${s.marketRuns.status} = 'scheduled'`,
        )
        .orderBy(asc(s.marketRuns.startsAt))
        .limit(100);
    }),
    inventory: authenticated.input(id).query(({ ctx, input }) =>
      ctx.db
        .select({
          id: s.inventory.id,
          produceId: s.produce.id,
          name: s.produce.name,
          description: s.produce.description,
          category: s.produce.category,
          unit: s.produce.unit,
          priceCents: s.inventory.priceCents,
          quantity: s.inventory.quantity,
          reservedQuantity: s.inventory.reservedQuantity,
          availableQuantity: sql<number>`${s.inventory.quantity} - ${s.inventory.reservedQuantity}`,
          active: s.inventory.active,
          source: s.farms.name,
        })
        .from(s.inventory)
        .innerJoin(s.produce, eq(s.produce.id, s.inventory.produceId))
        .innerJoin(s.farms, eq(s.farms.id, s.produce.farmId))
        .where(
          and(
            eq(s.inventory.runId, input.id),
            eq(s.inventory.active, true),
            eq(s.farms.active, true),
          ),
        )
        .orderBy(asc(s.produce.name)),
    ),
  }),
  orders: t.router({
    recordCash: authenticated
      .input(
        z.object({
          orderId: z.uuid(),
          amountCents: z.number().int().min(0).max(100_000_000),
          note: z.string().trim().max(500).default(''),
        }),
      )
      .mutation(({ ctx, input }) => ctx.ops.recordCash(input)),
    mine: authenticated.query(({ ctx }) => myOrders(ctx.db, ctx.actor.id)),
    place: authenticated
      .input(
        z.object({
          runId: z.uuid(),
          requestId: z.uuid(),
          items: z
            .array(
              z.object({
                inventoryId: z.uuid(),
                quantity: z.number().int().min(1).max(1000),
              }),
            )
            .min(1)
            .max(100),
        }),
      )
      .mutation(({ ctx, input }) => ctx.ops.placeOrder(input)),
    cancel: authenticated
      .input(id)
      .mutation(({ ctx, input }) => ctx.ops.cancelOrder(input.id)),
  }),
  driver: t.router({
    shoppingList: authenticated
      .input(z.object({ runId: z.uuid() }))
      .query(({ ctx, input }) =>
        driverShoppingList(ctx.db, ctx.actor, input.runId),
      ),
    startShoppingBatch: authenticated
      .input(z.object({ runId: z.uuid() }))
      .mutation(({ ctx, input }) => ctx.ops.startShoppingBatch(input.runId)),
    combinedPurchase: authenticated
      .input(combinedPurchaseInput)
      .mutation(({ ctx, input }) => ctx.ops.recordCombinedPurchase(input)),
    finishShoppingBatch: authenticated
      .input(z.object({ runId: z.uuid() }))
      .mutation(({ ctx, input }) => ctx.ops.finishShoppingBatch(input.runId)),
    setPacked: authenticated
      .input(
        z.object({
          orderId: z.uuid(),
          orderItemId: z.uuid(),
          packed: z.boolean(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.ops.setPacked(input)),
    orderGroups: authenticated
      .input(
        z
          .object({
            view: z.enum(['available', 'mine']).default('available'),
            marketId: z.uuid().optional(),
            limit: z.number().int().min(1).max(20).default(5),
            offset: z.number().int().min(0).max(1000000).default(0),
            orderLimit: z.number().int().min(1).max(100).default(25),
          })
          .default({ view: 'available', limit: 5, offset: 0, orderLimit: 25 }),
      )
      .query(({ ctx, input }) => driverOrderGroups(ctx.db, ctx.actor, input)),
    orders: authenticated
      .input(
        z.object({
          runId: z.uuid(),
          view: z.enum(['available', 'mine']).default('available'),
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).max(1000000).default(0),
        }),
      )
      .query(({ ctx, input }) => driverOrders(ctx.db, ctx.actor, input)),
    claimBatch: authenticated
      .input(claimBatchInput)
      .mutation(({ ctx, input }) => ctx.ops.claimBatch(input)),
    detail: authenticated
      .input(id)
      .query(({ ctx, input }) =>
        driverOrderDetail(ctx.db, input.id, ctx.actor),
      ),
    claim: authenticated
      .input(id)
      .mutation(({ ctx, input }) => ctx.ops.claimOrder(input.id)),
    release: authenticated
      .input(id)
      .mutation(({ ctx, input }) => ctx.ops.releaseOrder(input.id)),
    start: authenticated
      .input(id)
      .mutation(({ ctx, input }) => ctx.ops.startShopping(input.id)),
    purchase: authenticated
      .input(
        z.object({
          orderId: z.uuid(),
          orderItemId: z.uuid(),
          quantity: z.number().int().min(0).max(100000),
          totalCostCents: z.number().int().min(0).max(100000000),
        }),
      )
      .mutation(({ ctx, input }) => ctx.ops.recordPurchase(input)),
    finish: authenticated
      .input(id)
      .mutation(({ ctx, input }) => ctx.ops.finishShopping(input.id)),
    deliver: authenticated
      .input(
        z.object({
          orderId: z.uuid(),
          status: z.enum(['out_for_delivery', 'delivered', 'delivery_failed']),
          note: z.string().trim().max(500).default(''),
        }),
      )
      .mutation(({ ctx, input }) => ctx.ops.deliver(input)),
  }),
  farms: t.router({
    list: authenticated.query(({ ctx }) =>
      ctx.db.select().from(s.farms).orderBy(asc(s.farms.name), asc(s.farms.id)),
    ),
  }),
  admin: t.router({
    createFarm: admin
      .input(farmInput)
      .mutation(({ ctx, input }) => ctx.ops.createFarm(input)),
    updateFarm: admin
      .input(farmInput.extend({ id: z.uuid() }))
      .mutation(({ ctx, input: { id, ...input } }) =>
        ctx.ops.updateFarm(id, input),
      ),
    updateProduce: admin
      .input(produceInput.extend({ id: z.uuid() }))
      .mutation(({ ctx, input: { id, ...input } }) =>
        ctx.ops.updateProduce(id, input),
      ),
    orders: admin
      .input(
        z
          .object({
            runId: z.uuid().optional(),
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).max(1000000).default(0),
          })
          .default({ limit: 50, offset: 0 }),
      )
      .query(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select()
          .from(s.orders)
          .where(input.runId ? eq(s.orders.runId, input.runId) : undefined)
          .orderBy(desc(s.orders.createdAt), desc(s.orders.id))
          .limit(input.limit)
          .offset(input.offset);
        return (await import('./queries.js')).orderDetails(ctx.db, rows);
      }),
    inventory: admin.input(id).query(({ ctx, input }) =>
      ctx.db
        .select({
          id: s.inventory.id,
          produceId: s.inventory.produceId,
          name: s.produce.name,
          unit: s.produce.unit,
          quantity: s.inventory.quantity,
          reservedQuantity: s.inventory.reservedQuantity,
          priceCents: s.inventory.priceCents,
          active: s.inventory.active,
          availableQuantity: sql<number>`${s.inventory.quantity} - ${s.inventory.reservedQuantity}`,
        })
        .from(s.inventory)
        .innerJoin(s.produce, eq(s.produce.id, s.inventory.produceId))
        .where(eq(s.inventory.runId, input.id))
        .orderBy(asc(s.produce.name)),
    ),
    jobs: admin.query(({ ctx }) =>
      ctx.db
        .select()
        .from(s.backgroundJobRuns)
        .orderBy(desc(s.backgroundJobRuns.startedAt))
        .limit(20),
    ),
    runSchedulingJob: admin.mutation(({ ctx }) =>
      s.runMarketRunsJob(ctx.db, 'admin'),
    ),
    schedules: admin.query(({ ctx }) =>
      ctx.db
        .select({ schedule: s.marketSchedules, market: s.markets })
        .from(s.marketSchedules)
        .innerJoin(s.markets, eq(s.marketSchedules.marketId, s.markets.id))
        .orderBy(asc(s.markets.name), asc(s.marketSchedules.weekday)),
    ),
    saveSchedule: admin
      .input(scheduleInput)
      .mutation(({ ctx, input }) => ctx.ops.saveSchedule(input)),
    saveScheduleInventory: admin
      .input(scheduleInventoryInput)
      .mutation(({ ctx, input }) => ctx.ops.saveScheduleInventory(input)),
    invitations: admin.query(({ ctx }) =>
      ctx.db
        .select({
          id: s.invitations.id,
          email: s.invitations.email,
          role: s.invitations.role,
          expiresAt: s.invitations.expiresAt,
          usedAt: s.invitations.usedAt,
          revokedAt: s.invitations.revokedAt,
        })
        .from(s.invitations)
        .orderBy(desc(s.invitations.createdAt))
        .limit(100),
    ),
    invite: admin
      .input(
        z.object({
          email: z.email().toLowerCase(),
          role: z.enum(['customer', 'driver']),
        }),
      )
      .mutation(({ ctx, input }) => ctx.ops.createInvitation(input)),
    revokeInvite: admin
      .input(id)
      .mutation(({ ctx, input }) => ctx.ops.revokeInvitation(input.id)),
    createMarket: admin
      .input(marketInput)
      .mutation(({ ctx, input }) => ctx.ops.createMarket(input)),
    scheduleRun: admin
      .input(runInput)
      .mutation(({ ctx, input }) => ctx.ops.scheduleRun(input)),
    saveInventory: admin
      .input(inventoryInput)
      .mutation(({ ctx, input }) => ctx.ops.saveInventory(input)),
    createProduce: admin
      .input(produceInput)
      .mutation(({ ctx, input }) => ctx.ops.createProduce(input)),
    cancelRun: admin
      .input(id)
      .mutation(({ ctx, input }) => ctx.ops.cancelRun(input.id)),
    runs: admin.query(async ({ ctx }) => {
      return ctx.db
        .select({ run: s.marketRuns, market: s.markets })
        .from(s.marketRuns)
        .innerJoin(s.markets, eq(s.marketRuns.marketId, s.markets.id))
        .orderBy(
          sql`CASE WHEN ${s.marketRuns.status} IN ('shopping', 'delivering') THEN 0
            WHEN ${s.marketRuns.status} = 'scheduled' AND ${s.marketRuns.endsAt} > now() THEN 1
            ELSE 2 END`,
          asc(s.marketRuns.startsAt),
        )
        .limit(100);
    }),
    detail: admin
      .input(id)
      .query(({ ctx, input }) => runDetail(ctx.db, input.id, ctx.actor)),
    drivers: admin.query(({ ctx }) =>
      ctx.db
        .select({
          profile: s.driverProfiles,
          name: s.user.name,
          email: s.user.email,
        })
        .from(s.driverProfiles)
        .innerJoin(s.user, eq(s.user.id, s.driverProfiles.userId)),
    ),
    reviewDriver: admin
      .input(
        z.object({
          userId: z.string().min(1),
          status: z.enum(['approved', 'suspended']),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.ops.reviewDriver(input.userId, input.status),
      ),
    assignDriver: admin
      .input(
        z.object({ orderId: z.uuid(), driverId: z.string().min(1).nullable() }),
      )
      .mutation(({ ctx, input }) => ctx.ops.assignDriver(input)),
    tokens: admin.query(({ ctx }) =>
      ctx.db
        .select({
          id: s.apiTokens.id,
          name: s.apiTokens.name,
          lastFour: s.apiTokens.lastFour,
          expiresAt: s.apiTokens.expiresAt,
          revokedAt: s.apiTokens.revokedAt,
        })
        .from(s.apiTokens)
        .where(eq(s.apiTokens.userId, ctx.actor.id)),
    ),
    createToken: admin
      .input(z.object({ name: z.string().trim().min(2).max(100) }))
      .mutation(({ ctx, input }) => ctx.ops.createApiToken(input.name)),
    revokeToken: admin
      .input(id)
      .mutation(({ ctx, input }) => ctx.ops.revokeApiToken(input.id)),
  }),
});
export type AppRouter = typeof appRouter;
export type ProduceCategory =
  inferRouterOutputs<AppRouter>['produce']['list'][number]['category'];
