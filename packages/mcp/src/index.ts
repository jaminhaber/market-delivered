import { TRPCError } from '@trpc/server';
import { createEmailSender } from '@market/core/email';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { fromNodeHeaders } from 'better-auth/node';
import {
  and,
  eq,
  asc,
  sql,
  ilike,
  or,
  getTableColumns,
  isNull,
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
  farmInput,
  runInput,
  scheduleInput,
  scheduleInventoryInput,
} from '@market/core/operations';
import {
  permissions,
  resolveNetwork,
  networkEmailConfig,
  networkOperations,
  networkInput,
  networkSettingsInput,
  membershipInput,
} from '@market/core/networks';
import { MCP_SCOPE, oauthIdentity } from '@market/core/oauth';
import { resolveOAuth, type OAuthSource } from '@market/core/oauth-routes';
import type { ServerConfig } from '@market/core/server';
import { orderDetails, recentJobRuns } from '@market/core/queries';

const result = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});
const failure = (error: unknown): CallToolResult => ({
  ...result({
    code:
      error instanceof Error && 'code' in error
        ? error.code
        : 'INTERNAL_SERVER_ERROR',
    error:
      error instanceof Error && 'code' in error
        ? error.message
        : 'Operation failed',
  }),
  isError: true,
});
const call = async (fn: () => Promise<unknown>) => {
  try {
    return result(await fn());
  } catch (error) {
    return failure(error);
  }
};
const pagination = {
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(1000000).default(0),
};
const readOnly = { readOnlyHint: true, destructiveHint: false };

export function registerMcp(
  app: FastifyInstance,
  rootDb: s.Database,
  defaults: ServerConfig,
  source: OAuthSource,
  path = '/mcp',
) {
  app.register(async (app) => {
    app.route({
      method: ['GET', 'POST', 'DELETE'],
      url: path,
      async handler(request, reply) {
        const oauth = await resolveOAuth(source, request);
        const boundNetworkId = oauth.network?.id;
        reply.header('Cache-Control', 'no-store');
        const userId = await oauthIdentity(
          rootDb,
          oauth.auth,
          fromNodeHeaders(request.headers),
          oauth.resource,
          boundNetworkId,
        );
        if (!userId)
          return reply
            .header(
              'WWW-Authenticate',
              `Bearer resource_metadata="${new URL(oauth.resourceMetadataPath, new URL(oauth.resource).origin).href}", scope="${MCP_SCOPE} offline_access"`,
            )
            .code(401)
            .send({ error: 'Connect your assistant to Market Delivered.' });
        if (request.method !== 'POST')
          return reply
            .header('Allow', 'POST')
            .code(405)
            .send({ error: 'Use POST for stateless MCP' });
        const [person] = await rootDb
          .select()
          .from(s.user)
          .where(eq(s.user.id, userId));
        if (!person)
          return reply.code(401).send({ error: 'Account no longer exists' });
        const currentAccess = await permissions(rootDb, userId, boundNetworkId);
        if (
          boundNetworkId &&
          !currentAccess.globalAdmin &&
          !currentAccess.networkAdmin
        )
          return reply
            .code(403)
            .send({ error: 'Network administrator access required' });
        const access = boundNetworkId
          ? {
              ...currentAccess,
              globalAdmin: false,
              networkAdmin:
                currentAccess.globalAdmin || currentAccess.networkAdmin,
            }
          : currentAccess;
        const actor = {
          id: person.id,
          name: person.name,
          email: person.email,
          ...access,
          admin: access.globalAdmin || access.networkAdmin,
        };
        const mcp = new McpServer({
          name: 'market-delivered',
          version: '4.0.0',
        });
        async function networkContext(networkId: string) {
          ensure(
            !boundNetworkId || networkId === boundNetworkId,
            'This connection is restricted to its own network',
            'FORBIDDEN',
          );
          const network = await resolveNetwork(rootDb, networkId);
          const current = await permissions(rootDb, userId!, network.id);
          const access = boundNetworkId
            ? {
                ...current,
                globalAdmin: false,
                networkAdmin: current.globalAdmin || current.networkAdmin,
              }
            : current;
          ensure(
            access.globalAdmin || access.networkAdmin,
            'Network administrator access required',
            'FORBIDDEN',
          );
          const actor = {
            id: person!.id,
            name: person!.name,
            email: person!.email,
            ...access,
            admin: access.globalAdmin || access.networkAdmin,
          };
          const db = s.networkDatabase(rootDb, network.id, actor.id);
          const ops = operations(db, actor);
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
              .innerJoin(
                s.produce,
                s.networkWhere(
                  db,
                  s.produce,
                  eq(s.produce.id, s.inventory.produceId),
                ),
              )
              .innerJoin(
                s.farms,
                s.networkWhere(db, s.farms, eq(s.farms.id, s.produce.farmId)),
              )
              .where(
                s.networkWhere(db, s.inventory, eq(s.inventory.runId, runId)),
              );

          return { db, ops, network, actor, stockRows };
        }
        function networkTool<T extends z.ZodObject>(
          name: string,
          config: {
            description: string;
            inputSchema: T;
            annotations?: ToolAnnotations;
          },
          handler: (
            input: z.output<T>,
            context: Awaited<ReturnType<typeof networkContext>>,
          ) => Promise<CallToolResult>,
        ) {
          const inputSchema = config.inputSchema.safeExtend({
            networkId: boundNetworkId
              ? z
                  .uuid()
                  .optional()
                  .describe(
                    'Optional network ID; must match this connection’s network.',
                  )
              : z.uuid().describe('Explicit network ID from list_networks.'),
          });
          mcp.registerTool(name, { ...config, inputSchema }, async (input) => {
            try {
              const { networkId, ...values } = input as {
                networkId: string;
              } & Record<string, unknown>;
              return await handler(
                values as z.output<T>,
                await networkContext(networkId ?? boundNetworkId!),
              );
            } catch (error) {
              return failure(error);
            }
          });
        }
        mcp.registerTool(
          'who_am_i',
          {
            description:
              'Read your account identity and current permissions for this connection.',
            inputSchema: {},
            annotations: readOnly,
          },
          () =>
            call(async () => ({
              ...actor,
              ...(boundNetworkId ? { networkId: boundNetworkId } : {}),
            })),
        );
        mcp.registerTool(
          'list_networks',
          {
            description:
              'List the networks you can access. Use their IDs explicitly in network tools.',
            inputSchema: {},
            annotations: readOnly,
          },
          () =>
            call(async () => {
              const rows = await rootDb
                .select({
                  id: s.networks.id,
                  name: s.networks.name,
                  slug: s.networks.slug,
                  role: s.networkMemberships.role,
                })
                .from(s.networks)
                .leftJoin(
                  s.networkMemberships,
                  and(
                    eq(s.networkMemberships.networkId, s.networks.id),
                    eq(s.networkMemberships.userId, userId!),
                  ),
                )
                .where(
                  and(
                    isNull(s.networks.deletedAt),
                    boundNetworkId
                      ? eq(s.networks.id, boundNetworkId)
                      : undefined,
                    access.globalAdmin
                      ? undefined
                      : boundNetworkId
                        ? undefined
                        : eq(s.networkMemberships.userId, userId!),
                  ),
                )
                .orderBy(s.networks.name, s.networks.id);
              return rows.map((row) => ({
                ...row,
                globalAdmin: access.globalAdmin,
              }));
            }),
        );
        if (access.globalAdmin)
          mcp.registerTool(
            'create_network',
            {
              description:
                'Create an independent delivery network. Requires current global administrator permission.',
              inputSchema: networkInput,
            },
            (input) =>
              call(async () => {
                if (
                  defaults.production &&
                  input.frontendOrigin &&
                  new URL(input.frontendOrigin).protocol !== 'https:'
                )
                  throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'Production frontends require HTTPS',
                  });
                return networkOperations(
                  rootDb,
                  actor,
                  null,
                  defaults.secret,
                ).create(input);
              }),
          );
        networkTool(
          'get_network',
          {
            description:
              'Read network settings. Email credentials are never returned.',
            inputSchema: z.object({}),
            annotations: readOnly,
          },
          (_input, { network, actor }) =>
            call(() =>
              networkOperations(
                rootDb,
                actor,
                network.id,
                defaults.secret,
              ).get(),
            ),
        );
        networkTool(
          'update_network',
          {
            description:
              'Update network settings. Only global administrators can change its slug.',
            inputSchema: z.object({ settings: networkSettingsInput }),
          },
          (input, { network, actor }) =>
            call(async () => {
              if (
                defaults.production &&
                input.settings.frontendOrigin &&
                new URL(input.settings.frontendOrigin).protocol !== 'https:'
              )
                throw new TRPCError({
                  code: 'BAD_REQUEST',
                  message: 'Production frontends require HTTPS',
                });
              return networkOperations(
                rootDb,
                actor,
                network.id,
                defaults.secret,
              ).update(input.settings);
            }),
        );
        networkTool(
          'list_network_members',
          {
            description: 'List a network’s members and administrator roles.',
            inputSchema: z.object({}),
            annotations: readOnly,
          },
          (_input, { network, actor }) =>
            call(() =>
              networkOperations(
                rootDb,
                actor,
                network.id,
                defaults.secret,
              ).members(),
            ),
        );
        networkTool(
          'set_network_member',
          {
            description:
              'Assign an existing account as member or network administrator. Cannot grant global administrator permission.',
            inputSchema: membershipInput,
          },
          (input, { network, actor }) =>
            call(() =>
              networkOperations(
                rootDb,
                actor,
                network.id,
                defaults.secret,
              ).setMember(input),
            ),
        );
        networkTool(
          'invite_user',
          {
            description:
              'Invite a customer, driver, or network administrator and email them a signup link valid for seven days. Defaults to customer; driver invitations grant approved driver access after signup. Can grant network_admin access in this network; cannot grant global_admin access. Requires configured email delivery. Success means the email provider accepted the message, not that it reached the inbox. Creates a new invitation on each call; do not retry after success.',
            inputSchema: z.object({
              email: z.string().trim().email().max(254).toLowerCase(),
              role: z
                .enum(['customer', 'driver', 'network_admin'])
                .default('customer'),
            }),
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          (input, { ops, network }) =>
            call(async () => {
              const emailConfig = await networkEmailConfig(rootDb, network.id, {
                ...defaults,
                secret: defaults.secret || '',
              });
              if (!emailConfig.resendKey || !emailConfig.emailFrom)
                throw new TRPCError({
                  code: 'PRECONDITION_FAILED',
                  message:
                    'Invitation email delivery requires RESEND_API_KEY and EMAIL_FROM. Configure email delivery before retrying.',
                });
              if (!network.frontendOrigin)
                throw new TRPCError({
                  code: 'PRECONDITION_FAILED',
                  message:
                    'Configure the network frontend origin before sending invitations.',
                });
              const invitation = await ops.createInvitation(input);
              const url = new URL('/account', network.frontendOrigin);
              url.searchParams.set('invite', invitation.token);
              try {
                await createEmailSender(emailConfig)(
                  input.email,
                  `You’re invited to ${network.name.replace(/[\r\n]/g, ' ')}`,
                  url.href,
                  `You’re invited to ${network.name} as a ${input.role === 'network_admin' ? 'administrator' : input.role}. Sign up within seven days using this email address: ${input.email}`,
                );
              } catch {
                await ops.revokeInvitation(invitation.id);
                throw new TRPCError({
                  code: 'INTERNAL_SERVER_ERROR',
                  message:
                    'Invitation email delivery failed. The invitation has been revoked; retry to create and send a new one.',
                });
              }
              return {
                id: invitation.id,
                email: input.email,
                role: input.role,
                expiresAt: invitation.expiresAt,
                emailStatus: 'accepted',
              };
            }),
        );
        networkTool(
          'list_farms',
          {
            description:
              'List reusable farms/vendors, including archived records. Filter by name/location and active status. Create a farm first, then use its id as farmId in create_produce. Page with limit and offset.',
            inputSchema: z.object({
              ...pagination,
              search: z.string().trim().max(150).default(''),
              active: z.boolean().optional(),
            }),
            annotations: readOnly,
          },
          (input, { db }) =>
            call(() =>
              db
                .select()
                .from(s.farms)
                .where(
                  s.networkWhere(
                    db,
                    s.farms,
                    and(
                      input.search
                        ? or(
                            ilike(s.farms.name, `%${input.search}%`),
                            ilike(s.farms.location, `%${input.search}%`),
                          )
                        : undefined,
                      input.active === undefined
                        ? undefined
                        : eq(s.farms.active, input.active),
                    ),
                  ),
                )
                .orderBy(asc(s.farms.name), asc(s.farms.id))
                .limit(input.limit)
                .offset(input.offset),
            ),
        );
        networkTool(
          'get_farm',
          {
            description:
              'Read farm contact details and shopping notes. Use list_produce with farmId to inspect its catalog.',
            inputSchema: z.object({ id: z.uuid() }),
            annotations: readOnly,
          },
          (input, { db }) =>
            call(async () => {
              const [farm] = await db
                .select()
                .from(s.farms)
                .where(s.networkWhere(db, s.farms, eq(s.farms.id, input.id)));
              ensure(farm, 'Farm not found', 'NOT_FOUND');
              return farm;
            }),
        );
        networkTool(
          'create_farm',
          {
            description:
              'Create a reusable farm/vendor. Does not create a login or market-day inventory. Keep the returned id for create_produce.',
            inputSchema: farmInput,
          },
          (input, { ops }) => call(() => ops.createFarm(input)),
        );
        networkTool(
          'update_farm',
          {
            description:
              'Update a farm by id. Supply all fields. Set active=false to archive it and hide offerings from new orders. Existing orders retain their farm snapshots. No historical records are deleted.',
            inputSchema: farmInput.extend({ id: z.uuid() }),
            annotations: { idempotentHint: true },
          },
          ({ id, ...input }, { ops }) => call(() => ops.updateFarm(id, input)),
        );
        networkTool(
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
                driverId: z.string().min(1).max(200).optional(),
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
          (input, { db }) =>
            call(async () => {
              const rows = await db
                .select(getTableColumns(s.orders))
                .from(s.orders)
                .innerJoin(
                  s.marketRuns,
                  s.networkWhere(
                    db,
                    s.marketRuns,
                    eq(s.marketRuns.id, s.orders.runId),
                  ),
                )
                .where(
                  s.networkWhere(
                    db,
                    s.orders,
                    and(
                      input.runId ? eq(s.orders.runId, input.runId) : undefined,
                      input.marketId
                        ? eq(s.marketRuns.marketId, input.marketId)
                        : undefined,
                      input.driverId
                        ? eq(s.orders.driverId, input.driverId)
                        : undefined,
                      input.customerId
                        ? eq(s.orders.customerId, input.customerId)
                        : undefined,
                      input.status
                        ? eq(s.orders.status, input.status)
                        : undefined,
                      input.from
                        ? sql`${s.marketRuns.startsAt} >= ${new Date(input.from)}`
                        : undefined,
                      input.to
                        ? sql`${s.marketRuns.startsAt} < ${new Date(input.to)}`
                        : undefined,
                    ),
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
        networkTool(
          'get_order',
          {
            description:
              'Read one order including its customer delivery snapshot, items, fulfillment history, run and cash records. Does not modify the order.',
            inputSchema: z.object({ id: z.uuid() }),
            annotations: readOnly,
          },
          (input, { db }) =>
            call(async () => {
              const [order] = await db
                .select()
                .from(s.orders)
                .where(s.networkWhere(db, s.orders, eq(s.orders.id, input.id)));
              ensure(order, 'Order not found', 'NOT_FOUND');
              return (await orderDetails(db, [order]))[0]!;
            }),
        );
        networkTool(
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
          (input, { db }) =>
            call(() =>
              db
                .select()
                .from(s.markets)
                .where(
                  s.networkWhere(
                    db,
                    s.markets,
                    input.search
                      ? or(
                          ilike(s.markets.name, `%${input.search}%`),
                          ilike(s.markets.address, `%${input.search}%`),
                        )
                      : undefined,
                  ),
                )
                .orderBy(asc(s.markets.name), asc(s.markets.id))
                .limit(input.limit)
                .offset(input.offset),
            ),
        );
        networkTool(
          'get_market',
          {
            description: 'Read one market location and its weekly schedules.',
            inputSchema: z.object({ id: z.uuid() }),
            annotations: readOnly,
          },
          (input, { db }) =>
            call(async () => {
              const [market] = await db
                .select()
                .from(s.markets)
                .where(
                  s.networkWhere(db, s.markets, eq(s.markets.id, input.id)),
                );
              ensure(market, 'Market not found', 'NOT_FOUND');
              return {
                ...market,
                schedules: await db
                  .select()
                  .from(s.marketSchedules)
                  .where(
                    s.networkWhere(
                      db,
                      s.marketSchedules,
                      eq(s.marketSchedules.marketId, input.id),
                    ),
                  )
                  .orderBy(asc(s.marketSchedules.weekday)),
              };
            }),
        );
        networkTool(
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
          (input, { db }) =>
            call(() =>
              db
                .select()
                .from(s.marketRuns)
                .where(
                  s.networkWhere(
                    db,
                    s.marketRuns,
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
        networkTool(
          'get_run',
          {
            description:
              'Read a dated run, its market, and order count. Does not return customer personal details. Use list_inventory to inspect stock.',
            inputSchema: z.object({ id: z.uuid() }),
            annotations: readOnly,
          },
          (input, { db }) =>
            call(async () => {
              const [row] = await db
                .select({ run: s.marketRuns, market: s.markets })
                .from(s.marketRuns)
                .innerJoin(
                  s.markets,
                  s.networkWhere(
                    db,
                    s.markets,
                    eq(s.markets.id, s.marketRuns.marketId),
                  ),
                )
                .where(
                  s.networkWhere(
                    db,
                    s.marketRuns,
                    eq(s.marketRuns.id, input.id),
                  ),
                );
              ensure(row, 'Run not found', 'NOT_FOUND');
              const [count] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(s.orders)
                .where(
                  s.networkWhere(db, s.orders, eq(s.orders.runId, input.id)),
                );
              return { ...row, orderCount: count!.count };
            }),
        );
        networkTool(
          'list_produce',
          {
            description:
              'Search the produce catalog, including vendor metadata. Filter by category or farmId; page with limit and offset. Prices and quantities for a market day are in list_inventory.',
            inputSchema: z.object({
              ...pagination,
              search: z.string().trim().max(150).default(''),
              category: z.enum(s.produceCategory.enumValues).optional(),
              farmId: z.uuid().optional(),
            }),
            annotations: readOnly,
          },
          (input, { db }) =>
            call(() =>
              db
                .select({
                  ...getTableColumns(s.produce),
                  source: s.farms.name,
                  location: s.farms.location,
                })
                .from(s.produce)
                .innerJoin(
                  s.farms,
                  s.networkWhere(db, s.farms, eq(s.farms.id, s.produce.farmId)),
                )
                .where(
                  s.networkWhere(
                    db,
                    s.produce,
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
                      input.farmId
                        ? eq(s.produce.farmId, input.farmId)
                        : undefined,
                    ),
                  ),
                )
                .orderBy(asc(s.produce.name), asc(s.produce.id))
                .limit(input.limit)
                .offset(input.offset),
            ),
        );
        networkTool(
          'get_produce',
          {
            description: 'Read a catalog item and its vendor metadata.',
            inputSchema: z.object({ id: z.uuid() }),
            annotations: readOnly,
          },
          (input, { db }) =>
            call(async () => {
              const [item] = await db
                .select({
                  ...getTableColumns(s.produce),
                  source: s.farms.name,
                  location: s.farms.location,
                })
                .from(s.produce)
                .innerJoin(
                  s.farms,
                  s.networkWhere(db, s.farms, eq(s.farms.id, s.produce.farmId)),
                )
                .where(
                  s.networkWhere(db, s.produce, eq(s.produce.id, input.id)),
                );
              ensure(item, 'Produce not found', 'NOT_FOUND');
              return item;
            }),
        );
        networkTool(
          'catalog_options',
          {
            description:
              'Read valid produce categories and sale units before creating or updating catalog items.',
            inputSchema: z.object({}),
            annotations: readOnly,
          },
          () =>
            call(async () => ({
              categories: s.produceCategory.enumValues,
              units: s.produceUnit.enumValues,
            })),
        );
        networkTool(
          'list_inventory',
          {
            description:
              'Read run inventory, including inactive items, prices in cents, total/reserved/available quantities and vendor metadata. Returns an array; page with limit and offset.',
            inputSchema: z.object({ runId: z.uuid(), ...pagination }),
            annotations: readOnly,
          },
          (input, { db, stockRows }) =>
            call(async () => {
              const [run] = await db
                .select({ id: s.marketRuns.id })
                .from(s.marketRuns)
                .where(
                  s.networkWhere(
                    db,
                    s.marketRuns,
                    eq(s.marketRuns.id, input.runId),
                  ),
                );
              ensure(run, 'Run not found', 'NOT_FOUND');
              return stockRows(input.runId)
                .orderBy(asc(s.produce.name), asc(s.inventory.id))
                .limit(input.limit)
                .offset(input.offset);
            }),
        );
        networkTool(
          'list_schedule_inventory',
          {
            description:
              'Read recurring stock and price defaults, including inactive items and catalog details. Changes to defaults do not alter existing runs. Returns an array; page with limit and offset.',
            inputSchema: z.object({ scheduleId: z.uuid(), ...pagination }),
            annotations: readOnly,
          },
          (input, { db }) =>
            call(async () => {
              const [schedule] = await db
                .select({ id: s.marketSchedules.id })
                .from(s.marketSchedules)
                .where(
                  s.networkWhere(
                    db,
                    s.marketSchedules,
                    eq(s.marketSchedules.id, input.scheduleId),
                  ),
                );
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
                  s.networkWhere(
                    db,
                    s.produce,
                    eq(s.produce.id, s.scheduleInventory.produceId),
                  ),
                )
                .innerJoin(
                  s.farms,
                  s.networkWhere(db, s.farms, eq(s.farms.id, s.produce.farmId)),
                )
                .where(
                  s.networkWhere(
                    db,
                    s.scheduleInventory,
                    eq(s.scheduleInventory.scheduleId, input.scheduleId),
                  ),
                )
                .orderBy(asc(s.produce.name), asc(s.produce.id))
                .limit(input.limit)
                .offset(input.offset);
            }),
        );
        networkTool(
          'update_market',
          {
            description:
              'Update name, address and timezone. Supply all market fields. Timezone cannot change once runs exist. Weekly schedules and dated run times are unchanged.',
            inputSchema: marketInput.extend({ id: z.uuid() }),
          },
          ({ id, ...input }, { ops }) =>
            call(() => ops.updateMarket(id, input)),
        );
        networkTool(
          'update_produce',
          {
            description:
              'Update a catalog item using an existing active farmId. Supply all catalog fields. Existing order snapshots and run prices stay unchanged. Farm and sale unit cannot change once inventory/defaults exist; create a new item instead.',
            inputSchema: produceInput.extend({ id: z.uuid() }),
          },
          ({ id, ...input }, { ops }) =>
            call(() => ops.updateProduce(id, input)),
        );
        networkTool(
          'update_run',
          {
            description:
              'Update an unbooked scheduled run before its cutoff. Supply all run fields. Cannot change market or move a recurring opening date; cancel and create a replacement for those changes. Delivery windows may extend after market closing.',
            inputSchema: runInput.safeExtend({ id: z.uuid() }),
          },
          ({ id, ...input }, { ops }) => call(() => ops.updateRun(id, input)),
        );
        networkTool(
          'create_market',
          {
            description: 'Create a market location and its IANA timezone.',
            inputSchema: marketInput,
          },
          (input, { ops }) => call(() => ops.createMarket(input)),
        );
        networkTool(
          'schedule_run',
          {
            description:
              'Schedule one dated market day with an explicit cutoff and delivery window. All timestamps require UTC offsets.',
            inputSchema: runInput,
          },
          (input, { ops }) => call(() => ops.scheduleRun(input)),
        );
        networkTool(
          'save_inventory',
          {
            description:
              'Set a run’s estimated inventory and unit prices. Cannot reduce below reserved quantities or edit after cutoff.',
            inputSchema: inventoryInput,
          },
          (input, { ops }) => call(() => ops.saveInventory(input)),
        );
        networkTool(
          'create_produce',
          {
            description:
              'Create a catalog item for an existing active farmId. Call create_farm or list_farms first. Then publish it using save_inventory or save_schedule_inventory. Does not create a farmer account.',
            inputSchema: produceInput,
          },
          (input, { ops }) => call(() => ops.createProduce(input)),
        );
        networkTool(
          'cancel_run',
          {
            description:
              'Cancel an empty scheduled run. Runs with orders cannot be cancelled through MCP because order access is read-only.',
            inputSchema: z.object({ id: z.uuid() }),
          },
          (input, { ops }) =>
            call(() => ops.cancelRun(input.id, { allowOrders: false })),
        );
        networkTool(
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
          (input, { db }) =>
            call(() =>
              db
                .select()
                .from(s.marketSchedules)
                .where(
                  s.networkWhere(
                    db,
                    s.marketSchedules,
                    and(
                      input.marketId
                        ? eq(s.marketSchedules.marketId, input.marketId)
                        : undefined,
                      input.active === undefined
                        ? undefined
                        : eq(s.marketSchedules.active, input.active),
                    ),
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
        networkTool(
          'save_schedule',
          {
            description:
              'Create or update a weekly schedule. The daily scheduling job generates upcoming dates. Changes apply to new dates; existing runs and orders are preserved.',
            inputSchema: scheduleInput,
          },
          (input, { ops }) => call(() => ops.saveSchedule(input)),
        );
        networkTool(
          'save_schedule_inventory',
          {
            description:
              'Set default inventory and prices for future automatically generated market runs. Existing run inventory is preserved.',
            inputSchema: scheduleInventoryInput,
          },
          (input, { ops }) => call(() => ops.saveScheduleInventory(input)),
        );
        networkTool(
          'run_scheduling_job',
          {
            description:
              'Run the market scheduling job now after updating recurring schedules or defaults. Safe to retry; preserves existing runs and orders.',
            inputSchema: z.object({}),
          },
          (_input, { db }) => call(() => s.runMarketRunsJob(db, 'admin')),
        );
        networkTool(
          'list_job_runs',
          {
            description:
              'Read recent job results with entity changes. Set includeEmpty to include no-op, skipped, running, and failed attempts.',
            inputSchema: z.object({ includeEmpty: z.boolean().default(false) }),
          },
          (input, { db }) => call(() => recentJobRuns(db, input.includeEmpty)),
        );

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        // The transport writes directly to the raw response after hijacking.
        for (const [name, value] of Object.entries(reply.getHeaders())) {
          if (value !== undefined) reply.raw.setHeader(name, value);
        }
        reply.hijack();
        reply.raw.on('close', () => {
          void transport.close();
          void mcp.close();
        });
        await mcp.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      },
    });
  });
}
