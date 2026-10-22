import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  and,
  eq,
  isNull,
  gt,
  asc,
  sql,
  ilike,
  or,
  getTableColumns,
} from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import * as s from '@market/db';
import { z } from 'zod';
import {
  ensure,
  inventoryInput,
  marketInput,
  operations,
  produceInput,
  runInput,
  scheduleInput,
  scheduleInventoryInput,
} from './operations.js';
import { isAdmin, orderDetails } from './queries.js';
export function registerMcp(
  app: FastifyInstance,
  db: s.Database,
  webOrigin: string,
) {
  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    async handler(request, reply) {
      const origin = request.headers.origin;
      if (origin && origin !== webOrigin)
        return reply.code(403).send({ error: 'Origin not allowed' });
      const header = request.headers.authorization;
      if (!header?.startsWith('Bearer '))
        return reply
          .header('WWW-Authenticate', 'Bearer realm="market-operations"')
          .code(401)
          .send({ error: 'A market operations token is required' });
      const hash = createHash('sha256').update(header.slice(7)).digest('hex');
      const [token] = await db
        .select()
        .from(s.apiTokens)
        .where(
          and(
            eq(s.apiTokens.tokenHash, hash),
            isNull(s.apiTokens.revokedAt),
            gt(s.apiTokens.expiresAt, new Date()),
          ),
        );
      if (!token || !(await isAdmin(db, token.userId)))
        return reply
          .code(401)
          .send({ error: 'Invalid, expired, or revoked token' });
      if (request.method !== 'POST')
        return reply
          .header('Allow', 'POST')
          .code(405)
          .send({ error: 'Use POST for stateless MCP' });
      const [person] = await db
        .select()
        .from(s.user)
        .where(eq(s.user.id, token.userId));
      const ops = operations(db, {
        id: person!.id,
        name: person!.name,
        email: person!.email,
        admin: true,
      });
      const mcp = new McpServer({
        name: 'market-delivered-operations',
        version: '1.0.0',
      });
      const result = (value: unknown) => ({
        content: [{ type: 'text' as const, text: JSON.stringify(value) }],
      });
      const call = async (fn: () => Promise<unknown>) => {
        try {
          return result(await fn());
        } catch (error) {
          return {
            ...result({
              error:
                error instanceof Error && 'code' in error
                  ? error.message
                  : 'Operation failed',
            }),
            isError: true,
          };
        }
      };
      const pagination = {
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).max(1000000).default(0),
      };
      const readOnly = { readOnlyHint: true, destructiveHint: false };
      const stockRows = (runId: string) =>
        db
          .select({
            ...getTableColumns(s.inventory),
            name: s.produce.name,
            description: s.produce.description,
            unit: s.produce.unit,
            category: s.produce.category,
            source: s.farms.name,
            location: s.farms.location,
            availableQuantity: sql<number>`${s.inventory.quantity} - ${s.inventory.reservedQuantity}`,
          })
          .from(s.inventory)
          .innerJoin(s.produce, eq(s.produce.id, s.inventory.produceId))
          .innerJoin(s.farms, eq(s.farms.id, s.produce.farmId))
          .where(eq(s.inventory.runId, runId));
      mcp.registerTool(
        'list_orders',
        {
          description:
            'Read orders with customer delivery details, item/price snapshots, fulfillment history and cash records. Filter by run, market, customer or status. from/to filter market opening times (inclusive/exclusive), not order placement times. Returns newest orders first; paginate with limit and offset. Does not modify orders.',
          inputSchema: z
            .object({
              ...pagination,
              runId: z.uuid().optional(),
              marketId: z.uuid().optional(),
              customerId: z.string().min(1).max(200).optional(),
              status: z.enum(s.orderStatus.enumValues).optional(),
              from: z.iso.datetime({ offset: true }).optional(),
              to: z.iso.datetime({ offset: true }).optional(),
            })
            .refine(
              (input) =>
                !input.from ||
                !input.to ||
                new Date(input.from) < new Date(input.to),
              'from must be before to',
            ),
          annotations: readOnly,
        },
        (input) =>
          call(async () => {
            const rows = await db
              .select(getTableColumns(s.orders))
              .from(s.orders)
              .innerJoin(s.marketRuns, eq(s.marketRuns.id, s.orders.runId))
              .where(
                and(
                  input.runId ? eq(s.orders.runId, input.runId) : undefined,
                  input.marketId
                    ? eq(s.marketRuns.marketId, input.marketId)
                    : undefined,
                  input.customerId
                    ? eq(s.orders.customerId, input.customerId)
                    : undefined,
                  input.status ? eq(s.orders.status, input.status) : undefined,
                  input.from
                    ? sql`${s.marketRuns.startsAt} >= ${new Date(input.from)}`
                    : undefined,
                  input.to
                    ? sql`${s.marketRuns.startsAt} < ${new Date(input.to)}`
                    : undefined,
                ),
              )
              .orderBy(
                sql`${s.orders.createdAt} DESC`,
                sql`${s.orders.id} DESC`,
              )
              .limit(input.limit)
              .offset(input.offset);
            return orderDetails(db, rows);
          }),
      );
      mcp.registerTool(
        'get_order',
        {
          description:
            'Read one order including its customer delivery snapshot, items, fulfillment history, run and cash records. Does not modify the order.',
          inputSchema: z.object({ id: z.uuid() }),
          annotations: readOnly,
        },
        (input) =>
          call(async () => {
            const [order] = await db
              .select()
              .from(s.orders)
              .where(eq(s.orders.id, input.id));
            ensure(order, 'Order not found', 'NOT_FOUND');
            return (await orderDetails(db, [order]))[0]!;
          }),
      );
      mcp.registerTool(
        'list_markets',
        {
          description:
            'Search market locations. Lists return arrays; use limit and offset for pagination.',
          inputSchema: z.object({
            ...pagination,
            search: z.string().trim().max(150).default(''),
          }),
          annotations: readOnly,
        },
        (input) =>
          call(() =>
            db
              .select()
              .from(s.markets)
              .where(
                input.search
                  ? or(
                      ilike(s.markets.name, `%${input.search}%`),
                      ilike(s.markets.address, `%${input.search}%`),
                    )
                  : undefined,
              )
              .orderBy(asc(s.markets.name), asc(s.markets.id))
              .limit(input.limit)
              .offset(input.offset),
          ),
      );
      mcp.registerTool(
        'get_market',
        {
          description: 'Read one market location and its weekly schedules.',
          inputSchema: z.object({ id: z.uuid() }),
          annotations: readOnly,
        },
        (input) =>
          call(async () => {
            const [market] = await db
              .select()
              .from(s.markets)
              .where(eq(s.markets.id, input.id));
            ensure(market, 'Market not found', 'NOT_FOUND');
            return {
              ...market,
              schedules: await db
                .select()
                .from(s.marketSchedules)
                .where(eq(s.marketSchedules.marketId, input.id))
                .orderBy(asc(s.marketSchedules.weekday)),
            };
          }),
      );
      mcp.registerTool(
        'list_runs',
        {
          description:
            'Filter dated runs by market, status and opening time (from inclusive, to exclusive). Active work and upcoming runs sort before history. Returns an array; page with limit and offset.',
          inputSchema: z.object({
            ...pagination,
            marketId: z.uuid().optional(),
            status: z.enum(s.runStatus.enumValues).optional(),
            from: z.iso.datetime({ offset: true }).optional(),
            to: z.iso.datetime({ offset: true }).optional(),
          }),
          annotations: readOnly,
        },
        (input) =>
          call(() =>
            db
              .select()
              .from(s.marketRuns)
              .where(
                and(
                  input.marketId
                    ? eq(s.marketRuns.marketId, input.marketId)
                    : undefined,
                  input.status
                    ? eq(s.marketRuns.status, input.status)
                    : undefined,
                  input.from
                    ? sql`${s.marketRuns.startsAt} >= ${new Date(input.from)}`
                    : undefined,
                  input.to
                    ? sql`${s.marketRuns.startsAt} < ${new Date(input.to)}`
                    : undefined,
                ),
              )
              .orderBy(
                sql`CASE WHEN ${s.marketRuns.status} IN ('shopping','delivering') THEN 0 WHEN ${s.marketRuns.status}='scheduled' AND ${s.marketRuns.endsAt}>now() THEN 1 ELSE 2 END`,
                asc(s.marketRuns.startsAt),
                asc(s.marketRuns.id),
              )
              .limit(input.limit)
              .offset(input.offset),
          ),
      );
      mcp.registerTool(
        'get_run',
        {
          description:
            'Read a dated run, its market, and order count. Does not return customer personal details. Use list_inventory to inspect stock.',
          inputSchema: z.object({ id: z.uuid() }),
          annotations: readOnly,
        },
        (input) =>
          call(async () => {
            const [row] = await db
              .select({ run: s.marketRuns, market: s.markets })
              .from(s.marketRuns)
              .innerJoin(s.markets, eq(s.markets.id, s.marketRuns.marketId))
              .where(eq(s.marketRuns.id, input.id));
            ensure(row, 'Run not found', 'NOT_FOUND');
            const [count] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(s.orders)
              .where(eq(s.orders.runId, input.id));
            return { ...row, orderCount: count!.count };
          }),
      );
      mcp.registerTool(
        'list_produce',
        {
          description:
            'Search the produce catalog, including vendor metadata. Filter by category or source ID; page with limit and offset. Prices and quantities for a market day are in list_inventory.',
          inputSchema: z.object({
            ...pagination,
            search: z.string().trim().max(150).default(''),
            category: z.enum(s.produceCategory.enumValues).optional(),
            sourceId: z.uuid().optional(),
          }),
          annotations: readOnly,
        },
        (input) =>
          call(() =>
            db
              .select({
                ...getTableColumns(s.produce),
                source: s.farms.name,
                location: s.farms.location,
              })
              .from(s.produce)
              .innerJoin(s.farms, eq(s.farms.id, s.produce.farmId))
              .where(
                and(
                  input.search
                    ? or(
                        ilike(s.produce.name, `%${input.search}%`),
                        ilike(s.farms.name, `%${input.search}%`),
                      )
                    : undefined,
                  input.category
                    ? eq(s.produce.category, input.category)
                    : undefined,
                  input.sourceId
                    ? eq(s.produce.farmId, input.sourceId)
                    : undefined,
                ),
              )
              .orderBy(asc(s.produce.name), asc(s.produce.id))
              .limit(input.limit)
              .offset(input.offset),
          ),
      );
      mcp.registerTool(
        'get_produce',
        {
          description: 'Read a catalog item and its vendor metadata.',
          inputSchema: z.object({ id: z.uuid() }),
          annotations: readOnly,
        },
        (input) =>
          call(async () => {
            const [item] = await db
              .select({
                ...getTableColumns(s.produce),
                source: s.farms.name,
                location: s.farms.location,
              })
              .from(s.produce)
              .innerJoin(s.farms, eq(s.farms.id, s.produce.farmId))
              .where(eq(s.produce.id, input.id));
            ensure(item, 'Produce not found', 'NOT_FOUND');
            return item;
          }),
      );
      mcp.registerTool(
        'catalog_options',
        {
          description:
            'Read valid produce categories and sale units before creating or updating catalog items.',
          inputSchema: {},
          annotations: readOnly,
        },
        () =>
          call(async () => ({
            categories: s.produceCategory.enumValues,
            units: s.produceUnit.enumValues,
          })),
      );
      mcp.registerTool(
        'list_inventory',
        {
          description:
            'Read run inventory, including inactive items, prices in cents, total/reserved/available quantities and vendor metadata. Returns an array; page with limit and offset.',
          inputSchema: z.object({ runId: z.uuid(), ...pagination }),
          annotations: readOnly,
        },
        (input) =>
          call(async () => {
            const [run] = await db
              .select({ id: s.marketRuns.id })
              .from(s.marketRuns)
              .where(eq(s.marketRuns.id, input.runId));
            ensure(run, 'Run not found', 'NOT_FOUND');
            return stockRows(input.runId)
              .orderBy(asc(s.produce.name), asc(s.inventory.id))
              .limit(input.limit)
              .offset(input.offset);
          }),
      );
      mcp.registerTool(
        'list_schedule_inventory',
        {
          description:
            'Read recurring stock and price defaults, including inactive items and catalog details. Changes to defaults do not alter existing runs. Returns an array; page with limit and offset.',
          inputSchema: z.object({ scheduleId: z.uuid(), ...pagination }),
          annotations: readOnly,
        },
        (input) =>
          call(async () => {
            const [schedule] = await db
              .select({ id: s.marketSchedules.id })
              .from(s.marketSchedules)
              .where(eq(s.marketSchedules.id, input.scheduleId));
            ensure(schedule, 'Schedule not found', 'NOT_FOUND');
            return db
              .select({
                ...getTableColumns(s.scheduleInventory),
                name: s.produce.name,
                unit: s.produce.unit,
                source: s.farms.name,
                location: s.farms.location,
              })
              .from(s.scheduleInventory)
              .innerJoin(
                s.produce,
                eq(s.produce.id, s.scheduleInventory.produceId),
              )
              .innerJoin(s.farms, eq(s.farms.id, s.produce.farmId))
              .where(eq(s.scheduleInventory.scheduleId, input.scheduleId))
              .orderBy(asc(s.produce.name), asc(s.produce.id))
              .limit(input.limit)
              .offset(input.offset);
          }),
      );
      mcp.registerTool(
        'update_market',
        {
          description:
            'Update name, address and timezone. Supply all market fields. Timezone cannot change once runs exist. Weekly schedules and dated run times are unchanged.',
          inputSchema: marketInput.extend({ id: z.uuid() }),
        },
        ({ id, ...input }) => call(() => ops.updateMarket(id, input)),
      );
      mcp.registerTool(
        'update_produce',
        {
          description:
            'Update a catalog item and its source metadata. Supply all catalog fields. Existing order snapshots and run prices stay unchanged. A changed source is attached only to this item. Sale unit cannot change once inventory/defaults exist; create a new item instead.',
          inputSchema: produceInput.extend({ id: z.uuid() }),
        },
        ({ id, ...input }) => call(() => ops.updateProduce(id, input)),
      );
      mcp.registerTool(
        'update_run',
        {
          description:
            'Update an unbooked scheduled run before its cutoff. Supply all run fields. Cannot change market or move a recurring opening date; cancel and create a replacement for those changes. Deliveries must remain during market hours.',
          inputSchema: runInput.safeExtend({ id: z.uuid() }),
        },
        ({ id, ...input }) => call(() => ops.updateRun(id, input)),
      );
      mcp.registerTool(
        'create_market',
        {
          description: 'Create a market location and its IANA timezone.',
          inputSchema: marketInput,
        },
        (input) => call(() => ops.createMarket(input)),
      );
      mcp.registerTool(
        'schedule_run',
        {
          description:
            'Schedule one dated market day with an explicit cutoff and delivery window. All timestamps require UTC offsets.',
          inputSchema: runInput,
        },
        (input) => call(() => ops.scheduleRun(input)),
      );
      mcp.registerTool(
        'save_inventory',
        {
          description:
            'Set a run’s estimated inventory and unit prices. Cannot reduce below reserved quantities or edit after cutoff.',
          inputSchema: inventoryInput,
        },
        (input) => call(() => ops.saveInventory(input)),
      );
      mcp.registerTool(
        'create_produce',
        {
          description:
            'Create an inventory catalog item and vendor metadata. Does not create a farmer account.',
          inputSchema: produceInput,
        },
        (input) => call(() => ops.createProduce(input)),
      );
      mcp.registerTool(
        'cancel_run',
        {
          description:
            'Cancel an empty scheduled run. Runs with orders cannot be cancelled through MCP because order access is read-only.',
          inputSchema: z.object({ id: z.uuid() }),
        },
        (input) => call(() => ops.cancelRun(input.id, { allowOrders: false })),
      );
      mcp.registerTool(
        'list_schedules',
        {
          description:
            'List weekly schedules, optionally filtered by market and active status. Weekday uses Sunday=0 through Saturday=6; times are minutes after midnight. Delivery delay is from opening. Returns an array; page with limit and offset.',
          inputSchema: z.object({
            ...pagination,
            marketId: z.uuid().optional(),
            active: z.boolean().optional(),
          }),
          annotations: readOnly,
        },
        (input) =>
          call(() =>
            db
              .select()
              .from(s.marketSchedules)
              .where(
                and(
                  input.marketId
                    ? eq(s.marketSchedules.marketId, input.marketId)
                    : undefined,
                  input.active === undefined
                    ? undefined
                    : eq(s.marketSchedules.active, input.active),
                ),
              )
              .orderBy(
                asc(s.marketSchedules.marketId),
                asc(s.marketSchedules.weekday),
                asc(s.marketSchedules.id),
              )
              .limit(input.limit)
              .offset(input.offset),
          ),
      );
      mcp.registerTool(
        'save_schedule',
        {
          description:
            'Create or update a weekly schedule. The daily scheduling job generates upcoming dates. Changes apply to new dates; existing runs and orders are preserved.',
          inputSchema: scheduleInput,
        },
        (input) => call(() => ops.saveSchedule(input)),
      );
      mcp.registerTool(
        'save_schedule_inventory',
        {
          description:
            'Set default inventory and prices for future automatically generated market runs. Existing run inventory is preserved.',
          inputSchema: scheduleInventoryInput,
        },
        (input) => call(() => ops.saveScheduleInventory(input)),
      );
      mcp.registerTool(
        'run_scheduling_job',
        {
          description:
            'Run the market scheduling job now after updating recurring schedules or defaults. Safe to retry; preserves existing runs and orders.',
          inputSchema: {},
        },
        () => call(() => s.runMarketRunsJob(db, 'admin')),
      );
      mcp.registerTool(
        'list_job_runs',
        {
          description: 'Read recent scheduling job results and failure status.',
          inputSchema: {},
        },
        () =>
          call(() =>
            db
              .select()
              .from(s.backgroundJobRuns)
              .orderBy(sql`${s.backgroundJobRuns.startedAt} DESC`)
              .limit(20),
          ),
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      reply.hijack();
      reply.raw.on('close', () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    },
  });
}
