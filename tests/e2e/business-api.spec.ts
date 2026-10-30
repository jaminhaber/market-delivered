import { createRequire } from 'node:module';
import { connectAssistant } from './oauth';
import { createOAuth } from '../../packages/core/src/oauth-routes.js';
import { registerMcp } from '@market/mcp';
import {
  addressInput,
  geocodeAddress,
  suggestAddresses,
  resolveAddress,
} from '../../packages/core/src/addresses.js';
import {
  test,
  expect,
  request as rawRequestFactory,
  type APIRequestContext,
} from '@playwright/test';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import type { AppRouter } from '../../packages/core/src/router.js';
import {
  createDatabase,
  customerProfiles,
  invitations,
  networkMemberships,
  networks,
  farms,
  withNetwork,
  networkDatabase,
  networkWhere,
  user,
  marketRuns,
  orders,
  inventory,
  orderItems,
  oauthAccessToken,
  marketSchedules,
  runMarketRunsJob,
  runCloseMarketsJob,
  backgroundJobRuns,
  MARKET_RUNS_JOB,
  markets,
} from '../../packages/db/src/index.js';
import { and, eq, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createAuth } from '../../packages/core/src/auth.js';
import { checkRateLimit } from '../../packages/core/src/rate-limit.js';
import { rateLimit } from '../../packages/db/src/index.js';
const baseURL = 'http://localhost:5180';
const TEST_NETWORK_ID = '00000000-0000-4000-8000-000000000001';
const requestFactory = {
  newContext: (
    options: Parameters<typeof rawRequestFactory.newContext>[0] = {},
  ) =>
    rawRequestFactory.newContext({
      ...options,
      extraHTTPHeaders: {
        'x-network-id': TEST_NETWORK_ID,
        ...options.extraHTTPHeaders,
      },
    }),
};
const databaseURL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://market:market@localhost:5433/market_delivered_e2e';
if (!new URL(databaseURL).pathname.endsWith('_e2e'))
  throw new Error('Refusing to test against a non-E2E database');
const { db, pool } = createDatabase(databaseURL);
test.afterAll(async () => {
  await pool.end();
});
const password = 'A-long-market-password-123!';
const unique = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;
function api(request: APIRequestContext, network?: string, origin = baseURL) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: origin + '/trpc',
        headers: { 'x-network-id': network || TEST_NETWORK_ID },
        fetch: async (url, options) => {
          const response = await request.fetch(String(url), {
            method: options?.method ?? 'GET',
            headers: options?.headers as Record<string, string>,
            data: options?.body as string | undefined,
          });
          return new Response(await response.text(), {
            status: response.status(),
            headers: response.headers(),
          });
        },
      }),
    ],
  });
}
async function invite(email: string, role = 'customer') {
  const token = randomBytes(32).toString('hex');
  const [row] = await db
    .insert(invitations)
    .values({
      networkId: TEST_NETWORK_ID,
      email,
      role,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 86400000),
    })
    .returning();
  return { token, id: row!.id };
}
async function actor(role: 'customer' | 'driver' | 'admin' = 'customer') {
  const email = `${unique(role)}@example.test`,
    request = await requestFactory.newContext({ baseURL });
  const invitation = await invite(
    email,
    role === 'driver' ? 'driver' : 'customer',
  );
  const response = await request.post('/api/auth/sign-up/email', {
    headers: { 'x-invite-token': invitation.token, Origin: baseURL },
    data: {
      name: role === 'driver' ? 'Local Driver' : 'Local Customer',
      email,
      password,
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  const rpc = api(request);
  const me = await rpc.me.query();
  expect(me).not.toBeNull();
  if (role === 'admin')
    await db
      .update(networkMemberships)
      .set({ role: 'network_admin' })
      .where(
        and(
          eq(networkMemberships.userId, me!.id),
          eq(networkMemberships.networkId, TEST_NETWORK_ID),
        ),
      );
  await rpc.profile.save.mutate({
    name: role === 'driver' ? 'Local Driver' : 'Local Customer',
    phone: '7075550101',
    street: '10 Market Street',
    city: 'Ojai',
    region: 'CA',
    postalCode: '93023',
    deliveryNotes: 'Leave by the green door',
  });
  if (role === 'driver')
    await rpc.profile.saveDriver.mutate({
      phone: '7075550101',
      vehicle: 'Blue hatchback',
    });
  return { email, request, rpc, id: me!.id };
}
async function setup(quantity = 10) {
  const admin = await actor('admin');
  const market = await admin.rpc.admin.createMarket.mutate({
    name: unique('Test market'),
    address: '123 Market Plaza, Sonoma, CA',
    timezone: 'America/Los_Angeles',
  });
  const now = Date.now(),
    startsAt = new Date(now + 86400000).toISOString();
  const run = await admin.rpc.admin.scheduleRun.mutate({
    marketId: market.id,
    cutoffAt: new Date(now + 3600000).toISOString(),
    startsAt,
    endsAt: new Date(now + 2 * 86400000).toISOString(),
    deliveryStartAt: new Date(now + 86400000 + 3600000).toISOString(),
    deliveryEndAt: new Date(now + 2 * 86400000).toISOString(),
    deliveryFeeCents: 500,
  });
  const farm = await admin.rpc.admin.createFarm.mutate({
    name: 'Test grower',
    location: 'Sonoma',
  });
  const produce = await admin.rpc.admin.createProduce.mutate({
    name: unique('Carrots'),
    description: 'Fresh test carrots',
    category: 'Vegetables',
    unit: 'bunch',
    farmId: farm.id,
  });
  const stock = await admin.rpc.admin.saveInventory.mutate({
    runId: run.id,
    produceId: produce.id,
    priceCents: 350,
    quantity,
    active: true,
  });
  return { admin, market, run, farm, produce, stock };
}
async function closeCutoff(runId: string) {
  await db
    .update(marketRuns)
    .set({
      cutoffAt: new Date(Date.now() - 120000),
      startsAt: new Date(Date.now() - 60000),
    })
    .where(eq(marketRuns.id, runId));
}
async function rejectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error('Expected request to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(TRPCClientError);
    expect((error as TRPCClientError<AppRouter>).data?.code).toBe(code);
  }
}
test('concurrent orders cannot oversell, retries are idempotent, cancellation releases reservations', async () => {
  const { run, stock } = await setup(1),
    a = await actor(),
    b = await actor();
  const requestId = randomUUID();
  const results = await Promise.allSettled([
    a.rpc.orders.place.mutate({
      runId: run.id,
      requestId,
      items: [{ inventoryId: stock.id, quantity: 1 }],
    }),
    b.rpc.orders.place.mutate({
      runId: run.id,
      requestId: randomUUID(),
      items: [{ inventoryId: stock.id, quantity: 1 }],
    }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const winner = results[0]!.status === 'fulfilled' ? a : b;
  const order = (await winner.rpc.orders.mine.query())[0]!;
  const retried = await winner.rpc.orders.place.mutate({
    runId: run.id,
    requestId: order.requestId,
    items: [{ inventoryId: stock.id, quantity: 1 }],
  });
  expect(retried.id).toBe(order.id);
  await winner.rpc.orders.cancel.mutate({ id: order.id });
  await winner.rpc.orders.cancel.mutate({ id: order.id });
  const [row] = await db
    .select()
    .from(inventory)
    .where(eq(inventory.id, stock.id));
  expect(row!.reservedQuantity).toBe(0);
  const loser = winner === a ? b : a;
  await loser.rpc.orders.place.mutate({
    runId: run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: stock.id, quantity: 1 }],
  });
  await a.request.dispose();
  await b.request.dispose();
});

test('server enforces cutoffs, ownership, driver approval, and transitions', async () => {
  const { admin, run, stock } = await setup(),
    customer = await actor(),
    other = await actor(),
    driver = await actor('driver'),
    driver2 = await actor('driver');
  const order = await customer.rpc.orders.place.mutate({
    runId: run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: stock.id, quantity: 1 }],
  });
  await rejectCode(
    other.rpc.orders.cancel.mutate({ id: order.id }),
    'NOT_FOUND',
  );
  await rejectCode(customer.rpc.admin.runs.query(), 'FORBIDDEN');
  await rejectCode(
    customer.rpc.driver.claim.mutate({ id: order.id }),
    'FORBIDDEN',
  );
  await driver.rpc.driver.claim.mutate({ id: order.id });
  await rejectCode(
    driver2.rpc.driver.claim.mutate({ id: order.id }),
    'CONFLICT',
  );
  await rejectCode(
    driver2.rpc.driver.detail.query({ id: order.id }),
    'NOT_FOUND',
  );
  await rejectCode(
    driver.rpc.driver.start.mutate({ id: order.id }),
    'CONFLICT',
  );
  await admin.rpc.admin.reviewDriver.mutate({
    userId: driver.id,
    status: 'suspended',
  });
  await rejectCode(
    driver.rpc.driver.detail.query({ id: order.id }),
    'FORBIDDEN',
  );
  await admin.rpc.admin.reviewDriver.mutate({
    userId: driver.id,
    status: 'approved',
  });
  await closeCutoff(run.id);
  await rejectCode(
    customer.rpc.orders.cancel.mutate({ id: order.id }),
    'CONFLICT',
  );
  await rejectCode(
    other.rpc.orders.place.mutate({
      runId: run.id,
      requestId: randomUUID(),
      items: [{ inventoryId: stock.id, quantity: 1 }],
    }),
    'CONFLICT',
  );
  await rejectCode(
    admin.rpc.admin.saveInventory.mutate({
      runId: run.id,
      produceId: stock.produceId,
      quantity: 20,
      priceCents: 100,
    }),
    'BAD_REQUEST',
  );
  await driver.rpc.driver.start.mutate({ id: order.id });
  await rejectCode(
    driver.rpc.driver.deliver.mutate({
      orderId: order.id,
      status: 'delivered',
      note: '',
    }),
    'CONFLICT',
  );
  await driver.rpc.driver.purchase.mutate({
    orderId: order.id,
    orderItemId: (await driver.rpc.driver.detail.query({ id: order.id }))
      .items[0]!.id,
    quantity: 0,
    totalCostCents: 0,
  });
  await driver.rpc.driver.finish.mutate({ id: order.id });
  const result = (await customer.rpc.orders.mine.query())[0]!;
  expect(result.status).toBe('unavailable');
  expect(result.actualTotalCents).toBe(0);
  expect((await driver.rpc.driver.detail.query({ id: order.id })).status).toBe(
    'unavailable',
  );
});

test('immutable order snapshots, invalid inventory, cross-run items, and run cancellation', async () => {
  const { admin, run, stock } = await setup(),
    customer = await actor();
  const second = await setup();
  await rejectCode(
    customer.rpc.orders.place.mutate({
      runId: run.id,
      requestId: randomUUID(),
      items: [{ inventoryId: second.stock.id, quantity: 1 }],
    }),
    'BAD_REQUEST',
  );
  const order = await customer.rpc.orders.place.mutate({
    runId: run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: stock.id, quantity: 2 }],
  });
  await rejectCode(
    admin.rpc.admin.saveInventory.mutate({
      runId: run.id,
      produceId: stock.produceId,
      quantity: 1,
      priceCents: 100,
    }),
    'BAD_REQUEST',
  );
  await admin.rpc.admin.saveInventory.mutate({
    runId: run.id,
    produceId: stock.produceId,
    quantity: 10,
    priceCents: 999,
  });
  await customer.rpc.profile.save.mutate({
    name: 'New Name',
    phone: '7075559999',
    street: '20 Different Street',
    city: 'Ojai',
    region: 'CA',
    postalCode: '93023',
    deliveryNotes: '',
  });
  const [snapshot] = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  expect(snapshot!.priceCents).toBe(350);
  const [address] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, order.id));
  expect(address!.address).toBe('10 Market Street, Ojai, CA 93023, US');
  expect(address!.street).toBe('10 Market Street');
  expect(address!.city).toBe('Ojai');
  expect(address!.postalCode).toBe('93023');
  await admin.rpc.admin.cancelRun.mutate({ id: run.id });
  expect(
    await customer.rpc.orders.mine.query({ statuses: ['placed'] }),
  ).toEqual([]);
  expect(
    (await customer.rpc.orders.mine.query({ statuses: [] }))[0]!.status,
  ).toBe('cancelled');
  expect(
    await admin.rpc.admin.orders.query({
      runId: run.id,
      limit: 1,
      statuses: ['placed'],
    }),
  ).toEqual([]);
  expect(
    (
      await admin.rpc.admin.orders.query({
        runId: run.id,
        statuses: [],
        limit: 1,
      })
    )[0]!.id,
  ).toBe(order.id);
  expect(
    (await db.select().from(inventory).where(eq(inventory.id, stock.id)))[0]!
      .reservedQuantity,
  ).toBe(0);
});

test('MCP invitations email usable signup links and revoke failed sends', async () => {
  const Fastify: typeof import('fastify').default = createRequire(
    import.meta.url,
  )('fastify');
  const admin = await actor('admin');
  const { token } = await connectAssistant(admin.email, password);
  const config = {
    secret: randomBytes(32).toString('hex'),
    adminSecret: 'e2e-admin-only-secret-not-for-production-123456789',
    adminOrigin: 'http://localhost:5190',
    baseURL,
    webOrigin: baseURL,
    resendKey: 'local-stub-only',
    emailFrom: 'accounts@example.test',
  };
  const server = Fastify();
  registerMcp(server, db, config, createOAuth(db, config));
  const unconfigured = Fastify();
  const missingConfig = {
    secret: config.secret,
    adminSecret: config.adminSecret,
    adminOrigin: config.adminOrigin,
  };
  registerMcp(unconfigured, db, missingConfig, createOAuth(db, missingConfig));
  const messages: { to: string; subject: string; text: string }[] = [];
  let failEmail = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    expect(String(url)).toBe('https://api.resend.com/emails');
    messages.push(JSON.parse(String(options?.body)));
    return new Response('{}', { status: failEmail ? 503 : 200 });
  };
  const call = async (arguments_: object, target = server, bearer = token) => {
    const response = await target.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'invite_user',
          arguments: { networkId: TEST_NETWORK_ID, ...arguments_ },
        },
      },
    });
    return response;
  };
  try {
    expect(
      (await call({ email: 'blocked@example.test' }, server, 'invalid'))
        .statusCode,
    ).toBe(401);
    for (const role of ['customer', 'driver'] as const) {
      const email = `${unique('mcp-invite')}@example.test`;
      const response = await call({
        email: email.toUpperCase(),
        ...(role === 'driver' ? { role } : {}),
      });
      expect(response.statusCode).toBe(200);
      const result = response.json().result;
      expect(result.isError).not.toBe(true);
      const saved = JSON.parse(result.content[0].text);
      expect(saved).toMatchObject({ email, role, emailStatus: 'accepted' });
      expect(saved.token).toBeUndefined();
      const message = messages.at(-1)!;
      expect(message.to).toBe(email);
      expect(message.subject).toBe('You’re invited to Ojai');
      expect(message.text).toContain('You’re invited to Ojai as a');
      const url = new URL(message.text.split('\n\n')[1]!);
      expect(url.origin).toBe(baseURL);
      const invitationToken = url.searchParams.get('invite')!;
      const [row] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.id, saved.id));
      expect(row!.tokenHash).toBe(
        createHash('sha256').update(invitationToken).digest('hex'),
      );
      expect(row!.createdBy).toBe(admin.id);
      expect(row!.revokedAt).toBeNull();
      expect(new Date(saved.expiresAt).getTime() - Date.now()).toBeGreaterThan(
        6 * 86400000,
      );
      const signup = await admin.request.post('/api/auth/sign-up/email', {
        headers: { 'x-invite-token': invitationToken, Origin: baseURL },
        data: { name: 'Invited via MCP', email, password },
      });
      expect(signup.ok(), await signup.text()).toBeTruthy();
    }
    const count = messages.length;
    for (const input of [
      { email: 'invalid' },
      { email: 'admin@example.test', role: 'admin' },
    ]) {
      expect((await call(input)).json().result.isError).toBe(true);
    }
    const missingEmail = `${unique('mcp-no-email')}@example.test`;
    const missing = (await call({ email: missingEmail }, unconfigured)).json()
      .result;
    expect(JSON.parse(missing.content[0].text).code).toBe(
      'PRECONDITION_FAILED',
    );
    expect(
      await db
        .select()
        .from(invitations)
        .where(eq(invitations.email, missingEmail)),
    ).toHaveLength(0);
    expect(messages).toHaveLength(count);
    failEmail = true;
    const email = `${unique('mcp-email-failure')}@example.test`;
    const failed = (await call({ email })).json().result;
    expect(failed.isError).toBe(true);
    expect(JSON.parse(failed.content[0].text).error).toContain('revoked');
    const [revoked] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.email, email));
    expect(revoked!.revokedAt).not.toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
    await unconfigured.close();
  }
});

test('authenticated MCP schedules markets and inventory; invalid, expired, revoked, and demoted tokens fail', async () => {
  const { admin, produce, farm } = await setup();
  const grant = await connectAssistant(admin.email, password);
  const { token } = grant;
  const unauth = await fetch('http://127.0.0.1:5180/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(unauth.status).toBe(401);
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  const callTool = (params: Parameters<typeof client.callTool>[0]) =>
    client.callTool({
      ...params,
      arguments: { networkId: TEST_NETWORK_ID, ...params.arguments },
    });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://127.0.0.1:5180/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const tools = await client.listTools();
  expect(tools.tools.map((t) => t.name)).toContain('schedule_run');
  const marketResult = await callTool({
    name: 'create_market',
    arguments: {
      name: unique('MCP market'),
      address: '55 Market Square, Sonoma',
      timezone: 'America/Los_Angeles',
    },
  });
  expect(marketResult.isError).not.toBe(true);
  const market = JSON.parse(
    (marketResult.content as { text: string }[])[0]!.text,
  ) as { id: string };
  const now = Date.now();
  const runResult = await callTool({
    name: 'schedule_run',
    arguments: {
      marketId: market.id,
      cutoffAt: new Date(now + 3600000).toISOString(),
      startsAt: new Date(now + 86400000).toISOString(),
      endsAt: new Date(now + 90000000).toISOString(),
      deliveryStartAt: new Date(now + 87000000).toISOString(),
      deliveryEndAt: new Date(now + 90000000).toISOString(),
      deliveryFeeCents: 0,
    },
  });
  expect(runResult.isError).not.toBe(true);
  const run = JSON.parse(
    (runResult.content as { text: string }[])[0]!.text,
  ) as { id: string };
  const stock = await callTool({
    name: 'save_inventory',
    arguments: {
      runId: run.id,
      produceId: produce.id,
      quantity: 15,
      priceCents: 250,
      active: true,
    },
  });
  expect(stock.isError).not.toBe(true);
  expect(
    (await admin.rpc.markets.inventory.query({ id: run.id }))[0]!.quantity,
  ).toBe(15);
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await callTool({ name, arguments: args });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    return JSON.parse((response.content as { text: string }[])[0]!.text);
  };
  const updatedName = unique('MCP Ojai market');
  const updatedMarket = await tool('update_market', {
    id: market.id,
    name: updatedName,
    address: '414 E Ojai Ave, Ojai, CA 93023',
    timezone: 'America/Los_Angeles',
  });
  expect(updatedMarket.name).toBe(updatedName);
  expect((await tool('get_market', { id: market.id })).address).toContain(
    'Ojai',
  );
  expect(
    (
      await tool('list_markets', { search: updatedName, limit: 1, offset: 0 })
    )[0].id,
  ).toBe(market.id);
  expect(
    await tool('list_markets', { search: updatedName, limit: 1, offset: 1 }),
  ).toEqual([]);
  expect((await tool('catalog_options')).units).toContain('bunch');
  const details = await tool('get_run', { id: run.id });
  expect(details.orderCount).toBe(0);
  expect(
    (
      await tool('list_runs', {
        marketId: market.id,
        status: 'scheduled',
        from: new Date(now).toISOString(),
        to: new Date(now + 2 * 86400000).toISOString(),
      })
    ).map((r: { id: string }) => r.id),
  ).toEqual([run.id]);
  expect(
    await tool('list_runs', { marketId: market.id, status: 'completed' }),
  ).toEqual([]);
  const runFields = {
    marketId: market.id,
    startsAt: details.run.startsAt,
    endsAt: details.run.endsAt,
    cutoffAt: details.run.cutoffAt,
    deliveryStartAt: details.run.deliveryStartAt,
    deliveryEndAt: details.run.deliveryEndAt,
    deliveryFeeCents: 250,
  };
  expect(
    (await tool('update_run', { id: run.id, ...runFields })).deliveryFeeCents,
  ).toBe(250);
  const orchard = await tool('create_farm', {
    name: 'Ojai Orchard',
    location: 'Ojai',
  });
  expect(
    (await tool('list_farms', { search: 'Ojai Orchard' })).map(
      (f: { id: string }) => f.id,
    ),
  ).toContain(orchard.id);
  const catalog = await tool('create_produce', {
    name: unique('MCP Peaches'),
    description: 'Fresh peaches',
    category: 'Fruit',
    unit: 'basket',
    farmId: orchard.id,
  });
  const catalogInput = {
    name: unique('Updated MCP Peaches'),
    description: 'Ripe local peaches',
    category: 'Fruit',
    unit: 'basket',
    farmId: orchard.id,
  };
  await tool('update_farm', {
    id: orchard.id,
    name: 'Valley Orchard',
    location: 'Ojai, CA',
    contactPhone: '8055550101',
    notes: 'North stall',
    active: true,
  });
  expect(await tool('get_farm', { id: orchard.id })).toMatchObject({
    name: 'Valley Orchard',
    notes: 'North stall',
  });
  await tool('update_produce', { id: catalog.id, ...catalogInput });
  expect(await tool('get_produce', { id: catalog.id })).toMatchObject({
    name: catalogInput.name,
    source: 'Valley Orchard',
  });
  expect(
    (
      await tool('list_produce', {
        search: catalogInput.name,
        category: 'Fruit',
        limit: 1,
      })
    )[0].id,
  ).toBe(catalog.id);
  expect(
    await tool('list_produce', {
      search: catalogInput.name,
      category: 'Herbs',
    }),
  ).toEqual([]);
  await tool('save_inventory', {
    runId: run.id,
    produceId: catalog.id,
    quantity: 7,
    priceCents: 500,
    active: false,
    repeat: false,
  });
  const stockRows = await tool('list_inventory', { runId: run.id });
  expect(
    stockRows.find(
      (row: { produceId: string }) => row.produceId === catalog.id,
    ),
  ).toMatchObject({
    quantity: 7,
    reservedQuantity: 0,
    availableQuantity: 7,
    active: false,
    priceCents: 500,
    source: 'Valley Orchard',
  });
  const unitChange = await callTool({
    name: 'update_produce',
    arguments: { id: catalog.id, ...catalogInput, unit: 'lb' },
  });
  expect(unitChange.isError).toBe(true);
  const schedule = await tool('save_schedule', {
    marketId: market.id,
    weekday: 4,
    opensMinute: 900,
    closesMinute: 1140,
  });
  await tool('save_schedule_inventory', {
    scheduleId: schedule.id,
    produceId: catalog.id,
    quantity: 20,
    priceCents: 550,
    active: false,
  });
  expect(
    (await tool('list_schedule_inventory', { scheduleId: schedule.id }))[0],
  ).toMatchObject({
    produceId: catalog.id,
    quantity: 20,
    priceCents: 550,
    active: false,
  });
  expect(
    (await tool('list_schedules', { marketId: market.id, active: true }))[0].id,
  ).toBe(schedule.id);
  await tool('save_schedule', {
    marketId: market.id,
    weekday: 4,
    opensMinute: 900,
    closesMinute: 1140,
    active: false,
  });
  expect(
    await tool('list_schedules', { marketId: market.id, active: true }),
  ).toEqual([]);
  const customer = await actor();
  const publicStock = await admin.rpc.markets.inventory.query({ id: run.id });
  const placedOrder = await customer.rpc.orders.place.mutate({
    runId: run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: publicStock[0]!.id, quantity: 2 }],
  });
  expect((await tool('get_run', { id: run.id })).orderCount).toBe(1);
  const orderTools = (await client.listTools()).tools;
  for (const name of ['list_orders', 'get_order'])
    expect(
      orderTools.find((item) => item.name === name)?.annotations?.readOnlyHint,
    ).toBe(true);
  expect(orderTools.map((item) => item.name)).not.toEqual(
    expect.arrayContaining(['update_order']),
  );
  const beforeReads = await customer.rpc.orders.mine.query();
  const orderDetail = await tool('get_order', { id: placedOrder.id });
  expect(orderDetail).toMatchObject({
    id: placedOrder.id,
    status: 'placed',
    customerId: customer.id,
    address: beforeReads[0]!.address,
    phone: beforeReads[0]!.phone,
    cashCollectedCents: 0,
  });
  expect(orderDetail.items[0]).toMatchObject({ quantity: 2, priceCents: 250 });
  expect(orderDetail.events.length).toBeGreaterThan(0);
  expect(
    (
      await tool('list_orders', {
        runId: run.id,
        marketId: market.id,
        customerId: customer.id,
        status: 'placed',
        from: new Date(now).toISOString(),
        to: new Date(now + 2 * 86400000).toISOString(),
      })
    ).map((order: { id: string }) => order.id),
  ).toEqual([placedOrder.id]);
  expect(
    await tool('list_orders', { runId: run.id, status: 'delivered' }),
  ).toEqual([]);
  expect(
    await tool('list_orders', { runId: run.id, customerId: randomUUID() }),
  ).toEqual([]);
  expect(
    await tool('list_orders', {
      runId: run.id,
      from: new Date(now + 3 * 86400000).toISOString(),
    }),
  ).toEqual([]);
  expect(
    await tool('list_orders', {
      runId: run.id,
      to: new Date(now).toISOString(),
    }),
  ).toEqual([]);
  expect(
    (
      await callTool({
        name: 'get_order',
        arguments: { id: randomUUID() },
      })
    ).isError,
  ).toBe(true);
  expect(
    (
      await callTool({
        name: 'list_orders',
        arguments: {
          from: new Date(now + 86400000).toISOString(),
          to: new Date(now).toISOString(),
        },
      })
    ).isError,
  ).toBe(true);
  expect(await customer.rpc.orders.mine.query()).toEqual(beforeReads);
  const rejectedCancel = await callTool({
    name: 'cancel_run',
    arguments: { id: run.id },
  });
  expect(rejectedCancel.isError).toBe(true);
  expect(await customer.rpc.orders.mine.query()).toEqual(beforeReads);
  expect((await tool('get_run', { id: run.id })).run.status).toBe('scheduled');
  expect(
    (await tool('list_inventory', { runId: run.id })).find(
      (row: { produceId: string }) => row.produceId === produce.id,
    ).reservedQuantity,
  ).toBe(2);
  await customer.rpc.orders.place.mutate({
    runId: run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: publicStock[0]!.id, quantity: 1 }],
  });
  const firstPage = await tool('list_orders', {
    runId: run.id,
    limit: 1,
    offset: 0,
  });
  const secondPage = await tool('list_orders', {
    runId: run.id,
    limit: 1,
    offset: 1,
  });
  expect(firstPage).toHaveLength(1);
  expect(secondPage).toHaveLength(1);
  expect(firstPage[0].id).not.toBe(secondPage[0].id);
  expect(
    await tool('list_orders', { runId: run.id, limit: 1, offset: 2 }),
  ).toEqual([]);
  const emptyRun = await tool('schedule_run', {
    ...runFields,
    startsAt: new Date(now + 3 * 86400000).toISOString(),
    endsAt: new Date(now + 3 * 86400000 + 3600000).toISOString(),
    deliveryStartAt: new Date(now + 3 * 86400000).toISOString(),
    deliveryEndAt: new Date(now + 3 * 86400000 + 3600000).toISOString(),
  });
  await tool('cancel_run', { id: emptyRun.id });
  expect((await tool('get_run', { id: emptyRun.id })).run.status).toBe(
    'cancelled',
  );

  const bookedEdit = await callTool({
    name: 'update_run',
    arguments: { id: run.id, ...runFields, deliveryFeeCents: 0 },
  });
  expect(bookedEdit.isError).toBe(true);
  const reduceStock = await callTool({
    name: 'save_inventory',
    arguments: {
      runId: run.id,
      produceId: produce.id,
      quantity: 1,
      priceCents: 250,
    },
  });
  expect(reduceStock.isError).toBe(true);
  await tool('update_produce', {
    id: produce.id,
    name: 'Renamed catalog item',
    description: 'Edited after checkout',
    category: 'Vegetables',
    unit: 'bunch',
    farmId: farm.id,
  });
  expect((await customer.rpc.orders.mine.query())[0]!.items[0]!.name).not.toBe(
    'Renamed catalog item',
  );
  expect(
    (await customer.rpc.orders.mine.query())[0]!.items[0]!.priceCents,
  ).toBe(250);
  expect(
    (
      await callTool({
        name: 'get_market',
        arguments: { id: randomUUID() },
      })
    ).isError,
  ).toBe(true);
  expect(
    (
      await callTool({
        name: 'list_inventory',
        arguments: { runId: randomUUID() },
      })
    ).isError,
  ).toBe(true);
  const {
    rows: [events],
  } = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from audit_events where target_id in (${market.id},${catalog.id},${run.id}) and action in ('market.updated','produce.updated','run.updated')`,
  );
  expect(events?.count).toBeGreaterThanOrEqual(3);
  await customer.request.dispose();
  const invalid = await callTool({
    name: 'schedule_run',
    arguments: { marketId: market.id, cutoffAt: 'invalid' },
  });
  expect(invalid.isError).toBe(true);
  await client.close();
  const [row] = await db
    .select()
    .from(oauthAccessToken)
    .where(eq(oauthAccessToken.clientId, grant.clientId));
  expect(row!.token).not.toBe(token);
  const revoked = await fetch(
    'http://localhost:5190/oauth/auth/oauth2/revoke',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: grant.clientId,
        token: grant.refreshToken,
        token_type_hint: 'refresh_token',
      }),
    },
  );
  expect(revoked.status).toBe(200);
  const probe = (bearer: string) =>
    fetch('http://127.0.0.1:5180/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
  expect((await probe(token)).status).toBe(401);
  const expired = await connectAssistant(admin.email, password);
  await db
    .update(oauthAccessToken)
    .set({ expiresAt: new Date(0) })
    .where(eq(oauthAccessToken.clientId, expired.clientId));
  expect((await probe(expired.token)).status).toBe(401);
  const demoted = await connectAssistant(admin.email, password);
  await db
    .update(networkMemberships)
    .set({ role: 'member' })
    .where(
      and(
        eq(networkMemberships.userId, admin.id),
        eq(networkMemberships.networkId, TEST_NETWORK_ID),
      ),
    );
  const denied = await fetch('http://127.0.0.1:5180/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${demoted.token}`,
      'content-type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_farms', arguments: { networkId: TEST_NETWORK_ID } },
    }),
  });
  expect(denied.status).toBe(200);
  expect((await denied.json()).result.isError).toBe(true);
});

test('expired and revoked invitations fail, used invitation cannot create another account', async () => {
  const request = await requestFactory.newContext({ baseURL });
  for (const state of ['expired', 'revoked'] as const) {
    const email = `${unique(state)}@example.test`,
      inv = await invite(email);
    await db
      .update(invitations)
      .set(
        state === 'expired'
          ? { expiresAt: new Date(0) }
          : { revokedAt: new Date() },
      )
      .where(eq(invitations.id, inv.id));
    const response = await request.post('/api/auth/sign-up/email', {
      headers: { 'x-invite-token': inv.token },
      data: { name: 'Neighbor', email, password },
    });
    expect(response.status()).toBe(403);
  }
  const email = `${unique('used')}@example.test`,
    inv = await invite(email);
  const payload = {
    headers: { 'x-invite-token': inv.token },
    data: { name: 'Neighbor', email, password },
  };
  expect(
    (await request.post('/api/auth/sign-up/email', payload)).status(),
  ).toBe(200);
  expect(
    (await db.select().from(invitations).where(eq(invitations.id, inv.id)))[0]!
      .usedAt,
  ).not.toBeNull();
  const result = await request.post('/api/auth/sign-up/email', payload);
  expect([200, 400, 422]).toContain(result.status());
  expect(
    await db.select().from(user).where(eq(user.email, email)),
  ).toHaveLength(1);
  await request.dispose();
});

test('market and catalog endpoints require a session independently of the UI', async ({
  request,
}) => {
  const anonymous = api(request);
  expect(await anonymous.me.query()).toBeNull();
  for (const query of [
    () => anonymous.produce.categories.query(),
    () => anonymous.produce.list.query(),
    () => anonymous.markets.list.query(),
    () => anonymous.markets.runs.query(),
    () => anonymous.markets.inventory.query({ id: randomUUID() }),
  ])
    await rejectCode(query(), 'UNAUTHORIZED');

  const customer = await actor();
  try {
    for (const result of await Promise.all([
      customer.rpc.produce.categories.query(),
      customer.rpc.produce.list.query(),
      customer.rpc.markets.list.query(),
      customer.rpc.markets.runs.query(),
      customer.rpc.markets.inventory.query({ id: randomUUID() }),
    ]))
      expect(Array.isArray(result)).toBe(true);
  } finally {
    await customer.request.dispose();
  }
});

test('browser-origin protection and database constraints hold independently of the UI', async () => {
  const customer = await actor();
  const denied = await customer.request.post('/trpc/profile.save', {
    headers: { Origin: 'https://untrusted.example' },
    data: {
      name: 'Changed',
      phone: '7075550101',
      address: 'An unwanted address',
      deliveryNotes: '',
    },
  });
  expect(denied.status()).toBe(403);
  await rejectCode(
    customer.rpc.orders.place.mutate({
      runId: randomUUID(),
      requestId: randomUUID(),
      items: [],
    }),
    'BAD_REQUEST',
  );
  const { stock } = await setup();
  let rejected = false;
  try {
    await db
      .update(inventory)
      .set({ quantity: -1 })
      .where(eq(inventory.id, stock.id));
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
  const [safe] = await db
    .select()
    .from(inventory)
    .where(eq(inventory.id, stock.id));
  expect(safe!.quantity).toBe(10);
  await customer.request.dispose();
});

test('scheduled jobs generate upcoming runs concurrently and roll forward without changing orders', async () => {
  const { admin, market, produce } = await setup();
  const schedule = await admin.rpc.admin.saveSchedule.mutate({
    marketId: market.id,
    weekday: 4,
    opensMinute: 900,
    closesMinute: 1140,
    cutoffMinutes: 720,
    deliveryFeeCents: 500,
    skipThanksgiving: true,
  });
  await admin.rpc.admin.saveScheduleInventory.mutate({
    scheduleId: schedule.id,
    produceId: produce.id,
    quantity: 10,
    priceCents: 350,
  });
  // Customer and administrator reads must never create runs.
  await admin.rpc.markets.runs.query();
  await admin.rpc.admin.runs.query();
  expect(
    await db
      .select()
      .from(marketRuns)
      .where(eq(marketRuns.scheduleId, schedule.id)),
  ).toHaveLength(0);
  const invocations = await Promise.all(
    Array.from({ length: 6 }, () =>
      admin.request.get('http://127.0.0.1:5180/internal/jobs/market-runs', {
        headers: {
          Authorization:
            'Bearer e2e-only-cron-secret-not-for-production-123456789',
        },
      }),
    ),
  );
  expect(invocations.every((response) => response.ok())).toBe(true);
  const generated = await db
    .select()
    .from(marketRuns)
    .where(eq(marketRuns.scheduleId, schedule.id));
  expect(generated).toHaveLength(4);
  for (const date of generated) {
    expect(+date.deliveryStartAt).toBe(+date.startsAt);
    expect(+date.deliveryEndAt).toBeLessThanOrEqual(+date.endsAt);
  }
  const visible = (await admin.rpc.markets.runs.query()).filter(
    (row) => row.marketId === market.id,
  );
  const visibleIds = new Set(visible.map((row) => row.id));
  const horizon = Date.now() + 14 * 86400000;
  for (const date of generated) {
    expect(visibleIds.has(date.id)).toBe(+date.startsAt <= horizon);
  }
  expect(generated.some((date) => +date.startsAt > horizon)).toBe(true);
  const run = generated.sort((a, b) => +a.startsAt - +b.startsAt)[0]!;
  const [stock] = await db
    .select()
    .from(inventory)
    .where(eq(inventory.runId, run.id));
  expect(stock!.quantity).toBe(10);
  expect(stock!.reservedQuantity).toBe(0);
  const customer = await actor();
  const order = await customer.rpc.orders.place.mutate({
    runId: run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: stock!.id, quantity: 2 }],
  });
  await admin.rpc.admin.saveInventory.mutate({
    runId: run.id,
    produceId: produce.id,
    quantity: 12,
    priceCents: 450,
    repeat: true,
  });
  await runMarketRunsJob(db, 'cli', new Date(+new Date(run.cutoffAt) + 1));
  const next = await db
    .select()
    .from(marketRuns)
    .where(eq(marketRuns.scheduleId, schedule.id));
  expect(next).toHaveLength(5);
  const later = next.sort((a, b) => +b.startsAt - +a.startsAt)[0]!;
  expect(+later.startsAt).toBeGreaterThan(+new Date(run.startsAt));
  const [newStock] = await db
    .select()
    .from(inventory)
    .where(eq(inventory.runId, later.id));
  expect(newStock!.quantity).toBe(12);
  expect(newStock!.priceCents).toBe(450);
  expect(newStock!.reservedQuantity).toBe(0);
  const [oldStock] = await db
    .select()
    .from(inventory)
    .where(eq(inventory.id, stock!.id));
  expect(oldStock!.reservedQuantity).toBe(2);
  const [snapshot] = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  expect(snapshot!.priceCents).toBe(350);
  const [original] = await db
    .select()
    .from(marketRuns)
    .where(eq(marketRuns.id, run.id));
  expect(original!.startsAt.toISOString()).toBe(
    new Date(run.startsAt).toISOString(),
  );
  await rejectCode(
    customer.rpc.admin.saveSchedule.mutate({
      marketId: market.id,
      weekday: 0,
      opensMinute: 540,
      closesMinute: 780,
    }),
    'FORBIDDEN',
  );
});

test('recurrence respects Pacific DST, Thanksgiving, cancellations, and paused schedules', async () => {
  const { admin, market } = await setup();
  const sunday = await admin.rpc.admin.saveSchedule.mutate({
    marketId: market.id,
    weekday: 0,
    opensMinute: 540,
    closesMinute: 780,
  });
  await runMarketRunsJob(db, 'cli', new Date('2031-01-01T12:00:00Z'));
  await runMarketRunsJob(db, 'cli', new Date('2031-07-01T12:00:00Z'));
  let rows = await db
    .select()
    .from(marketRuns)
    .where(eq(marketRuns.scheduleId, sunday.id));
  expect(
    rows.some((r) => r.startsAt.toISOString() === '2031-01-05T17:00:00.000Z'),
  ).toBe(true);
  expect(
    rows.some((r) => r.startsAt.toISOString() === '2031-07-06T16:00:00.000Z'),
  ).toBe(true);
  const thursday = await admin.rpc.admin.saveSchedule.mutate({
    marketId: market.id,
    weekday: 4,
    opensMinute: 900,
    closesMinute: 1140,
    skipThanksgiving: true,
  });
  const asOf = new Date('2031-11-26T12:00:00Z');
  await runMarketRunsJob(db, 'cli', asOf);
  const [first] = await db
    .select()
    .from(marketRuns)
    .where(eq(marketRuns.scheduleId, thursday.id));
  expect(first!.startsAt.toISOString()).toBe('2031-12-04T23:00:00.000Z');
  await admin.rpc.admin.cancelRun.mutate({ id: first!.id });
  await runMarketRunsJob(db, 'cli', asOf);
  const runs = await db
    .select()
    .from(marketRuns)
    .where(eq(marketRuns.scheduleId, thursday.id));
  expect(runs).toHaveLength(5);
  expect(runs.find((r) => r.id === first!.id)!.status).toBe('cancelled');
  expect(
    runs.some((r) => r.startsAt.toISOString() === '2031-12-11T23:00:00.000Z'),
  ).toBe(true);
  await admin.rpc.admin.saveSchedule.mutate({
    marketId: market.id,
    weekday: 0,
    opensMinute: 540,
    closesMinute: 780,
    active: false,
  });
  const before = rows.length;
  await runMarketRunsJob(db, 'cli', new Date('2032-01-01T12:00:00Z'));
  rows = await db
    .select()
    .from(marketRuns)
    .where(eq(marketRuns.scheduleId, sunday.id));
  // Other calls above may have materialized a November Sunday before it was paused.
  expect(rows.every((r) => r.startsAt.getUTCFullYear() === 2031)).toBe(true);
  expect(rows.length).toBeGreaterThanOrEqual(before);
  expect(
    (
      await db
        .select()
        .from(marketSchedules)
        .where(eq(marketSchedules.id, sunday.id))
    )[0]!.active,
  ).toBe(false);
  await rejectCode(
    admin.rpc.admin.saveSchedule.mutate({
      marketId: market.id,
      weekday: 0,
      opensMinute: 780,
      closesMinute: 540,
    }),
    'BAD_REQUEST',
  );
});

test('cron job endpoint rejects unauthorized callers, records results, and skips overlapping jobs', async () => {
  const { admin } = await setup();
  const customer = await actor();
  const endpoint = 'http://127.0.0.1:5180/internal/jobs/market-runs';
  for (const headers of [
    {},
    { Authorization: 'Bearer invalid-secret' },
  ] as Record<string, string>[]) {
    const response = await admin.request.get(endpoint, { headers });
    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toBe('no-store');
  }
  await rejectCode(customer.rpc.admin.runSchedulingJob.mutate(), 'FORBIDDEN');
  await rejectCode(customer.rpc.admin.jobs.query(), 'FORBIDDEN');
  const response = await admin.request.get(endpoint, {
    headers: {
      Authorization: 'Bearer e2e-only-cron-secret-not-for-production-123456789',
    },
  });
  expect(response.status()).toBe(200);
  const result = (await response.json()) as { id: string; status: string };
  expect(result.status).toBe('succeeded');
  const [logged] = await db
    .select()
    .from(backgroundJobRuns)
    .where(eq(backgroundJobRuns.id, result.id));
  expect(logged!.source).toBe('cron');
  expect(logged!.finishedAt).not.toBeNull();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${MARKET_RUNS_JOB}))`,
    );
    const overlap = await admin.request.get(endpoint, {
      headers: {
        Authorization:
          'Bearer e2e-only-cron-secret-not-for-production-123456789',
      },
    });
    expect(overlap.status()).toBe(200);
    expect((await overlap.json()).status).toBe('skipped');
  });
});

test('failed scheduling jobs roll back changes, retain failure history, and can be retried', async () => {
  const { admin, market } = await setup();
  await admin.rpc.admin.saveSchedule.mutate({
    marketId: market.id,
    weekday: 0,
    opensMinute: 540,
    closesMinute: 780,
  });
  await db
    .update(markets)
    .set({ timezone: 'Invalid/Test-Timezone' })
    .where(eq(markets.id, market.id));
  try {
    const response = await admin.request.get(
      'http://127.0.0.1:5180/internal/jobs/market-runs',
      {
        headers: {
          Authorization:
            'Bearer e2e-only-cron-secret-not-for-production-123456789',
        },
      },
    );
    expect(response.status()).toBe(500);
    const history = await admin.rpc.admin.jobs.query({ includeEmpty: true });
    expect(history[0]!.status).toBe('failed');
    expect(history[0]!.runsCreated).toBe(0);
    expect(history[0]!.impactedEntities).toBe(0);
    expect(
      (await admin.rpc.admin.jobs.query()).some(
        (job) => job.id === history[0]!.id,
      ),
    ).toBe(false);
    expect(history[0]!.error).toContain('generation failed');
  } finally {
    await db
      .update(markets)
      .set({ timezone: 'America/Los_Angeles' })
      .where(eq(markets.id, market.id));
  }
  const retried = await admin.rpc.admin.runSchedulingJob.mutate();
  expect(retried.status).toBe('succeeded');
});

test('structured addresses retain geocodes until edited and orders snapshot their location', async () => {
  const { run, stock } = await setup();
  const customer = await actor();
  await rejectCode(
    customer.rpc.profile.save.mutate({
      name: 'Customer',
      phone: '8055550101',
      street: '1 Test St',
      city: 'Ojai',
      region: 'XX',
      postalCode: 'wrong',
      deliveryNotes: '',
    }),
    'BAD_REQUEST',
  );
  await db
    .update(customerProfiles)
    .set({
      latitude: 34.448,
      longitude: -119.245,
      geocodedAddress: '10 MARKET ST, OJAI, CA, 93023',
      geocoder: 'us-census',
      geocodedAt: new Date(),
    })
    .where(eq(customerProfiles.userId, customer.id));
  await customer.rpc.profile.save.mutate({
    name: 'Customer',
    phone: '8055550101',
    street: '10 Market Street',
    city: 'Ojai',
    region: 'CA',
    postalCode: '93023',
    deliveryNotes: 'Updated instructions',
  });
  expect((await customer.rpc.me.query())!.customer!.latitude).toBe(34.448);
  const order = await customer.rpc.orders.place.mutate({
    runId: run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: stock.id, quantity: 1 }],
  });
  await customer.rpc.profile.save.mutate({
    name: 'Customer',
    phone: '8055550101',
    street: '20 Market Street',
    city: 'Ojai',
    region: 'CA',
    postalCode: '93023',
    deliveryNotes: '',
  });
  const profile = (await customer.rpc.me.query())!.customer!;
  expect(profile.latitude).toBeNull();
  expect(profile.longitude).toBeNull();
  expect(profile.geocoder).toBeNull();
  const [snapshot] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, order.id));
  expect(snapshot!.latitude).toBe(34.448);
  expect(snapshot!.street).toBe('10 Market Street');
  const anonymous = await requestFactory.newContext({ baseURL });
  await rejectCode(
    api(anonymous).profile.locateAddress.mutate(),
    'UNAUTHORIZED',
  );
  await anonymous.dispose();
  await customer.request.dispose();
});

test('Google address validation handles matches, corrections, configuration and outages', async () => {
  const address = addressInput.parse({
    street: '414 E Ojai Ave',
    unit: 'Suite 2',
    city: 'Ojai',
    region: 'ca',
    postalCode: '93023',
  });
  const result = {
    verdict: { addressComplete: true, validationGranularity: 'PREMISE' },
    address: { formattedAddress: '414 E Ojai Ave, Ojai, CA 93023' },
    geocode: {
      placeId: 'test-place',
      location: { latitude: 34.44, longitude: -119.24 },
    },
  };
  const request: typeof fetch = async (input, options) => {
    expect(String(input)).toBe(
      'https://addressvalidation.googleapis.com/v1:validateAddress',
    );
    expect(new Headers(options?.headers).get('X-Goog-Api-Key')).toBe(
      'test-key',
    );
    expect(JSON.parse(String(options?.body)).address.addressLines).toEqual([
      '414 E Ojai Ave',
      'Suite 2',
    ]);
    return Response.json({ result });
  };
  expect(await geocodeAddress(address, 'test-key', request)).toMatchObject({
    googlePlaceId: 'test-place',
    latitude: 34.44,
    longitude: -119.24,
    needsReview: false,
  });
  await expect(
    geocodeAddress(address, undefined, request),
  ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  for (const status of [403, 429, 503]) {
    await expect(
      geocodeAddress(address, 'test-key', async () =>
        Response.json({}, { status }),
      ),
    ).rejects.toMatchObject({
      code:
        status === 403
          ? 'PRECONDITION_FAILED'
          : status === 429
            ? 'TOO_MANY_REQUESTS'
            : 'BAD_GATEWAY',
    });
  }
  await expect(
    geocodeAddress(address, 'test-key', async () =>
      Response.json({
        result: {
          ...result,
          verdict: { addressComplete: false, validationGranularity: 'ROUTE' },
        },
      }),
    ),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(
    await geocodeAddress(address, 'test-key', async () =>
      Response.json({
        result: {
          ...result,
          verdict: { ...result.verdict, hasReplacedComponents: true },
        },
      }),
    ),
  ).toMatchObject({ needsReview: true });
  await expect(
    geocodeAddress(address, 'test-key', async () =>
      Response.json({
        result: {
          ...result,
          geocode: {
            placeId: 'bad',
            location: { latitude: 900, longitude: 34 },
          },
        },
      }),
    ),
  ).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
});

test('Places API requests use session tokens and resolve US address components', async () => {
  const sessionToken = randomUUID();
  const suggestions = await suggestAddresses(
    '414 E Ojai',
    sessionToken,
    'test-key',
    async (url, options) => {
      expect(String(url)).toBe(
        'https://places.googleapis.com/v1/places:autocomplete',
      );
      const body = JSON.parse(String(options?.body));
      expect(body.sessionToken).toBe(sessionToken);
      expect(body.includedRegionCodes).toEqual(['us']);
      expect(body).not.toHaveProperty('locationBias');
      return Response.json({
        suggestions: [
          {
            placePrediction: {
              placeId: 'place-id',
              text: { text: '414 East Ojai Ave' },
            },
          },
        ],
      });
    },
  );
  expect(suggestions).toEqual([
    { placeId: 'place-id', label: '414 East Ojai Ave' },
  ]);
  const parts = [
    ['street_number', '414'],
    ['route', 'East Ojai Avenue'],
    ['locality', 'Ojai'],
    ['administrative_area_level_1', 'CA'],
    ['postal_code', '93023'],
    ['country', 'US'],
  ];
  const address = await resolveAddress(
    'place-id',
    sessionToken,
    'test-key',
    async (url, options) => {
      expect(new URL(String(url)).searchParams.get('sessionToken')).toBe(
        sessionToken,
      );
      expect(new Headers(options?.headers).get('X-Goog-FieldMask')).toBe(
        'addressComponents',
      );
      return Response.json({
        addressComponents: parts.map(([type, text]) => ({
          types: [type],
          longText: text,
          shortText: text,
        })),
      });
    },
  );
  expect(address).toEqual({
    street: '414 East Ojai Avenue',
    city: 'Ojai',
    region: 'CA',
    postalCode: '93023',
  });
  await expect(
    suggestAddresses('414 Ojai', sessionToken, 'test-key', async () =>
      Response.json({}, { status: 403 }),
    ),
  ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  const anonymous = await requestFactory.newContext({ baseURL });
  await rejectCode(
    api(anonymous).addresses.suggest.mutate({
      input: '414 E Ojai',
      sessionToken,
    }),
    'UNAUTHORIZED',
  );
  await anonymous.dispose();
});

test('production invitations verify email and sign in while legacy verification still works', async () => {
  const email = `${unique('verification')}@example.test`;
  const invitation = await invite(email);
  const origin = 'https://market.example.test';
  const messages: { subject: string; text: string }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    expect(String(url)).toBe('https://api.resend.com/emails');
    messages.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify({ id: unique('email') }), {
      status: 200,
    });
  };
  try {
    const auth = createAuth(db, {
      production: true,
      secret: randomBytes(32).toString('hex'),
      baseURL: origin,
      webOrigin: origin,
      resendKey: 'local-stub-only',
      emailFrom: 'accounts@example.test',
    });
    const call = (path: string, body: object) =>
      auth.handler(
        new Request(`${origin}/api/auth/${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin,
            'x-forwarded-for': '8.8.4.4',
            'x-invite-token': invitation.token,
            'x-network-id': TEST_NETWORK_ID,
          },
          body: JSON.stringify(body),
        }),
      );
    const signup = await call('sign-up/email', {
      email,
      password,
      name: 'Verification tester',
      callbackURL: origin + '/',
    });
    expect(signup.status, await signup.text()).toBe(200);
    expect(messages).toHaveLength(0);
    const signupCookies = signup.headers.getSetCookie();
    expect(signupCookies.join(';')).toContain('Secure');
    expect(signupCookies.join(';')).toContain('HttpOnly');
    const signupSession = await auth.api.getSession({
      headers: {
        cookie: signupCookies.map((cookie) => cookie.split(';')[0]).join('; '),
      },
    });
    expect(signupSession?.user.email).toBe(email);
    expect(signupSession?.user.emailVerified).toBe(true);
    expect((await call('sign-in/email', { email, password })).status).toBe(200);

    // Accounts created before invitations verified email can still verify it.
    await db
      .update(user)
      .set({ emailVerified: false })
      .where(eq(user.email, email));
    const signin = await call('sign-in/email', { email, password });
    expect(signin.status).toBe(403);
    expect(messages).toHaveLength(1);
    for (let i = 0; i < 5; i++) {
      const resend = await call('send-verification-email', {
        email,
        callbackURL: origin + '/',
      });
      expect(resend.status, await resend.text()).toBe(200);
    }
    expect((await call('send-verification-email', { email })).status).toBe(429);
    const url = messages.at(-1)!.text.split('\n\n')[1]!;
    const verified = await auth.handler(
      new Request(url, { headers: { 'x-forwarded-for': '8.8.4.4' } }),
    );
    expect(verified.status).toBe(302);
    expect(verified.headers.get('location')).toBe(origin + '/');
    const cookies = verified.headers.getSetCookie();
    expect(cookies.join(';')).toContain('Secure');
    expect(cookies.join(';')).toContain('HttpOnly');
    const headers = {
      cookie: cookies.map((cookie) => cookie.split(';')[0]).join('; '),
    };
    const session = await auth.api.getSession({ headers });
    expect(session?.user.email).toBe(email);
    expect(session?.user.emailVerified).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('address budgets are atomic across callers and enforced before provider requests', async () => {
  const key = unique('address-budget');
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => checkRateLimit(db, key, 3, 60_000)),
  );
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(3);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(
    7,
  );
  await db
    .update(rateLimit)
    .set({ lastRequest: Date.now() - 60_001 })
    .where(eq(rateLimit.key, key));
  await checkRateLimit(db, key, 3, 60_000);
  const customer = await actor();
  const other = await actor();
  for (let i = 0; i < 10; i++)
    await rejectCode(
      customer.rpc.profile.locateAddress.mutate(),
      'PRECONDITION_FAILED',
    );
  await rejectCode(
    customer.rpc.profile.locateAddress.mutate(),
    'TOO_MANY_REQUESTS',
  );
  await rejectCode(
    other.rpc.profile.locateAddress.mutate(),
    'PRECONDITION_FAILED',
  );
});

test('order claims are atomic, different drivers shop the same date independently, and the claim pool protects customer details', async () => {
  const { run, stock, admin, farm, produce } = await setup(20);
  const customer = await actor(),
    a = await actor('driver'),
    b = await actor('driver');
  const first = await customer.rpc.orders.place.mutate({
    runId: run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: stock.id, quantity: 2 }],
  });
  const second = await customer.rpc.orders.place.mutate({
    runId: run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: stock.id, quantity: 3 }],
  });
  const pool = (
    await a.rpc.driver.orders.query({ view: 'available', runId: run.id })
  ).items;
  const publicOrder = pool.find((o) => o.id === first.id)!;
  expect(publicOrder).toBeDefined();
  for (const key of [
    'customerName',
    'phone',
    'address',
    'street',
    'deliveryNotes',
    'customerId',
  ])
    expect(publicOrder).not.toHaveProperty(key);
  const claims = await Promise.allSettled([
    a.rpc.driver.claim.mutate({ id: first.id }),
    b.rpc.driver.claim.mutate({ id: first.id }),
  ]);
  expect(claims.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const winner = claims[0]!.status === 'fulfilled' ? a : b,
    other = winner === a ? b : a;
  await rejectCode(
    other.rpc.driver.detail.query({ id: first.id }),
    'NOT_FOUND',
  );
  await other.rpc.driver.claim.mutate({ id: second.id });
  // A released order returns to the pool and can be claimed without changing any sibling order.
  await other.rpc.driver.release.mutate({ id: second.id });
  expect(
    (
      await other.rpc.driver.orders.query({ view: 'available', runId: run.id })
    ).items.some((o) => o.id === second.id),
  ).toBe(true);
  await other.rpc.driver.claim.mutate({ id: second.id });
  await admin.rpc.admin.updateFarm.mutate({
    id: farm.id,
    name: 'Renamed farm',
    location: 'New farm location',
    active: false,
  });
  expect(
    (await customer.rpc.markets.inventory.query({ id: run.id })).some(
      (i) => i.id === stock.id,
    ),
  ).toBe(false);
  await rejectCode(
    customer.rpc.orders.place.mutate({
      runId: run.id,
      requestId: randomUUID(),
      items: [{ inventoryId: stock.id, quantity: 1 }],
    }),
    'BAD_REQUEST',
  );
  await rejectCode(
    customer.rpc.admin.createFarm.mutate({
      name: 'Unauthorized farm',
      location: 'Ojai',
    }),
    'FORBIDDEN',
  );
  await closeCutoff(run.id);
  await winner.rpc.driver.start.mutate({ id: first.id });
  await other.rpc.driver.start.mutate({ id: second.id });
  const one = await winner.rpc.driver.detail.query({ id: first.id }),
    two = await other.rpc.driver.detail.query({ id: second.id });
  expect(one.items[0]!.farmName).toBe('Test grower');
  await rejectCode(
    winner.rpc.driver.purchase.mutate({
      orderId: first.id,
      orderItemId: two.items[0]!.id,
      quantity: 1,
      totalCostCents: 100,
    }),
    'NOT_FOUND',
  );
  await rejectCode(
    winner.rpc.driver.purchase.mutate({
      orderId: first.id,
      orderItemId: one.items[0]!.id,
      quantity: 3,
      totalCostCents: 100,
    }),
    'BAD_REQUEST',
  );
  await winner.rpc.driver.purchase.mutate({
    orderId: first.id,
    orderItemId: one.items[0]!.id,
    quantity: 1,
    totalCostCents: 177,
  });
  await winner.rpc.driver.finish.mutate({ id: first.id });
  expect((await other.rpc.driver.detail.query({ id: second.id })).status).toBe(
    'shopping',
  );
  expect(await winner.rpc.driver.detail.query({ id: first.id })).toMatchObject({
    status: 'ready',
    actualTotalCents: 850,
  });
  await other.rpc.driver.purchase.mutate({
    orderId: second.id,
    orderItemId: two.items[0]!.id,
    quantity: 3,
    totalCostCents: 555,
  });
  await other.rpc.driver.finish.mutate({ id: second.id });
  expect(await other.rpc.driver.detail.query({ id: second.id })).toMatchObject({
    status: 'ready',
    actualTotalCents: 1550,
  });
  expect(
    (await winner.rpc.driver.detail.query({ id: first.id })).items[0]!
      .actualCostCents,
  ).toBe(177);
  // Updating a suspended driver's details never restores claiming privileges.
  await admin.rpc.admin.reviewDriver.mutate({
    userId: winner.id,
    status: 'suspended',
  });
  await winner.rpc.profile.saveDriver.mutate({
    phone: '8055550199',
    vehicle: 'New bike',
  });
  await rejectCode(
    winner.rpc.driver.orders.query({ view: 'available', runId: run.id }),
    'FORBIDDEN',
  );
  await rejectCode(
    admin.rpc.admin.updateProduce.mutate({
      id: produce.id,
      name: produce.name,
      description: 'Updated',
      category: 'Vegetables',
      unit: 'lb',
      farmId: farm.id,
    }),
    'CONFLICT',
  );
  for (const person of [customer, a, b, admin]) await person.request.dispose();
});

test('fresh migrations create no network or implicit business ownership and remain retryable', async () => {
  const { fileURLToPath } = await import('node:url');
  const { runMigrations } = await import('../../packages/db/src/migrations.js');
  const name = `market_migration_${randomUUID().replaceAll('-', '')}_e2e`;
  const url = new URL(databaseURL);
  url.pathname = '/' + name;
  await pool.query(`CREATE DATABASE "${name}"`);
  const fresh = createDatabase(url.href);
  try {
    const folder = fileURLToPath(
      new URL('../../packages/db/drizzle', import.meta.url),
    );
    await Promise.all([
      runMigrations(fresh.db, folder),
      runMigrations(fresh.db, folder),
    ]);
    expect(await fresh.db.select().from(networks)).toEqual([]);
    expect(await fresh.db.select().from(farms)).toEqual([]);
    expect(
      (
        await fresh.pool.query(
          "SELECT table_name FROM information_schema.columns WHERE column_name='network_id' AND column_default IS NOT NULL AND table_schema='public'",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await fresh.pool.query(
          'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
        )
      ).rows[0]!.count,
    ).toBe(8);
    const { createServer } = await import('../../packages/core/src/server.js');
    const { bootstrapGlobalAdmin } =
      await import('../../packages/core/src/bootstrap.js');
    await bootstrapGlobalAdmin(
      fresh.db,
      'empty-platform@example.test',
      password,
    );
    const adminOrigin = 'http://localhost:5190';
    const platform = await createServer(
      fresh.db,
      {
        adminSecret: 'empty-admin-test-secret-at-least-32-characters',
        secret: 'empty-business-test-secret-at-least-32-characters',
        adminOrigin,
      },
      registerMcp,
    );
    try {
      const login = await platform.inject({
        method: 'POST',
        url: '/admin/auth/sign-in/email',
        headers: { origin: adminOrigin },
        payload: { email: 'empty-platform@example.test', password },
      });
      expect(login.statusCode, login.body).toBe(200);
      const saved = login.headers['set-cookie'];
      const cookie = (Array.isArray(saved) ? saved : [saved || ''])
        .map((value) => value.split(';')[0])
        .join('; ');
      const me = await platform.inject({
        method: 'GET',
        url: '/admin/trpc/me',
        headers: { cookie },
      });
      expect(me.json().result.data).toMatchObject({ globalAdmin: true });
      const tools = await platform.inject({
        method: 'POST',
        url: '/mcp',
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      });
      expect(tools.statusCode).toBe(401);
      expect(await fresh.db.select().from(networks)).toEqual([]);
    } finally {
      await platform.close();
    }
    const [network] = await fresh.db
      .insert(networks)
      .values({ name: 'First operator', slug: 'first' })
      .returning();
    await expect(
      fresh.pool.query(
        "INSERT INTO farms(name,location) VALUES ('Missing owner','Somewhere')",
      ),
    ).rejects.toThrow('null value');
    const { resolveNetwork } =
      await import('../../packages/core/src/networks.js');
    await expect(resolveNetwork(fresh.db)).rejects.toThrow('Network not found');
    expect((await resolveNetwork(fresh.db, network!.id)).id).toBe(network!.id);
    await expect(resolveNetwork(fresh.db, 'ojai')).rejects.toThrow(
      'Network not found',
    );
  } finally {
    await fresh.pool.end();
    await pool.query(`DROP DATABASE "${name}"`);
  }
});

test('network migration and scoped operations work without role administration privileges', async () => {
  const { fileURLToPath } = await import('node:url');
  const { runMigrations } = await import('../../packages/db/src/migrations.js');
  const { operations } = await import('../../packages/core/src/operations.js');
  const role = `app_login_${randomUUID().replaceAll('-', '')}`;
  const name = `${role}_e2e`;
  const secret = randomBytes(24).toString('hex');
  const url = new URL(databaseURL);
  url.pathname = '/' + name;
  url.username = role;
  url.password = secret;
  await pool.query(
    `CREATE ROLE "${role}" LOGIN NOCREATEROLE PASSWORD '${secret}'`,
  );
  const fresh = createDatabase(url.href);
  try {
    await pool.query(`CREATE DATABASE "${name}" OWNER "${role}"`);
    const folder = fileURLToPath(
      new URL('../../packages/db/drizzle', import.meta.url),
    );
    await runMigrations(fresh.db, folder);
    await runMigrations(fresh.db, folder);
    expect(
      (
        await fresh.pool.query(
          'SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname=current_user',
        )
      ).rows,
    ).toEqual([{ rolsuper: false, rolcreaterole: false }]);
    expect(
      (
        await fresh.pool.query(
          "SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relrowsecurity",
        )
      ).rows,
    ).toEqual([]);
    expect(await fresh.db.select().from(networks)).toEqual([]);
    await fresh.db.insert(networks).values({
      id: TEST_NETWORK_ID,
      name: 'Local test operator',
      slug: 'local',
    });
    const [person] = await fresh.db
      .insert(user)
      .values({
        id: randomUUID(),
        name: 'Operator',
        email: 'operator@example.test',
      })
      .returning();
    const [other] = await fresh.db
      .insert(networks)
      .values({ name: 'Another network', slug: 'another' })
      .returning();
    const admin = {
      id: person!.id,
      email: person!.email,
      name: person!.name,
      admin: true,
    };
    const remote = await withNetwork(
      fresh.db,
      other!.id,
      admin.id,
      async (scoped) =>
        operations(scoped, admin).createFarm({
          name: 'Remote farm',
          location: 'Sonoma',
          contactPhone: '',
          notes: '',
          active: true,
        }),
    );
    await withNetwork(fresh.db, TEST_NETWORK_ID, admin.id, async (scoped) => {
      expect(
        await scoped.select().from(farms).where(networkWhere(scoped, farms)),
      ).toEqual([]);
      await expect(
        operations(scoped, admin).updateFarm(remote.id, {
          name: 'Intrusion',
          location: 'Ojai',
          contactPhone: '',
          notes: '',
          active: true,
        }),
      ).rejects.toThrow('Farm not found');
    });
    expect((await fresh.db.select().from(farms))[0]).toMatchObject({
      id: remote.id,
      networkId: other!.id,
      name: 'Remote farm',
    });
    expect(
      await withNetwork(fresh.db, other!.id, '', async (scoped) =>
        (await import('../../packages/db/src/jobs.js')).runCloseMarketsJob(
          scoped,
          'cron',
        ),
      ),
    ).toMatchObject({ status: 'succeeded', ordersCancelled: 0, runsClosed: 0 });
    expect(
      (await fresh.db.select().from(backgroundJobRuns))[0]!.networkId,
    ).toBe(other!.id);
  } finally {
    await fresh.pool.end();
    await pool.query(`DROP DATABASE IF EXISTS "${name}"`);
    await pool.query(`DROP ROLE "${role}"`);
  }
});

test('batch claim validates selections, returns individual outcomes, and retries do not duplicate events', async () => {
  const { run, stock, admin } = await setup(30),
    foreign = await setup(5);
  const customer = await actor(),
    driver = await actor('driver'),
    rival = await actor('driver');
  const placed: Awaited<ReturnType<typeof customer.rpc.orders.place.mutate>>[] =
    [];
  for (let i = 0; i < 5; i++)
    placed.push(
      await customer.rpc.orders.place.mutate({
        runId: run.id,
        requestId: randomUUID(),
        items: [{ inventoryId: stock.id, quantity: 1 }],
      }),
    );
  const foreignOrder = await customer.rpc.orders.place.mutate({
    runId: foreign.run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: foreign.stock.id, quantity: 1 }],
  });
  const own = await driver.rpc.orders.place.mutate({
    runId: run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: stock.id, quantity: 1 }],
  });
  const ownPool = await driver.rpc.driver.orders.query({
    view: 'available',
    runId: run.id,
  });
  expect(ownPool.items.find((order) => order.id === own.id)).toMatchObject({
    isOwnOrder: true,
  });
  expect(
    ownPool.items.find((order) => order.id === placed[0]!.id),
  ).toMatchObject({
    isOwnOrder: false,
  });
  await rival.rpc.driver.claim.mutate({ id: placed[2]!.id });
  await customer.rpc.orders.cancel.mutate({ id: placed[3]!.id });
  await rejectCode(
    customer.rpc.driver.claimBatch.mutate({
      runId: run.id,
      orderIds: [placed[0]!.id],
    }),
    'FORBIDDEN',
  );
  await rejectCode(
    driver.rpc.driver.claimBatch.mutate({ runId: run.id, orderIds: [] }),
    'BAD_REQUEST',
  );
  await rejectCode(
    driver.rpc.driver.claimBatch.mutate({
      runId: run.id,
      orderIds: [placed[0]!.id, placed[0]!.id],
    }),
    'BAD_REQUEST',
  );
  await rejectCode(
    driver.rpc.driver.claimBatch.mutate({
      runId: run.id,
      orderIds: Array.from({ length: 101 }, () => randomUUID()),
    }),
    'BAD_REQUEST',
  );
  const missing = randomUUID(),
    ids = [
      placed[0]!.id,
      placed[1]!.id,
      placed[2]!.id,
      placed[3]!.id,
      own.id,
      foreignOrder.id,
      missing,
    ];
  const batch = await driver.rpc.driver.claimBatch.mutate({
    runId: run.id,
    orderIds: ids,
  });
  expect(batch.results.map((result) => result.orderId)).toEqual(ids);
  expect(batch.results.slice(0, 2).map((result) => result.status)).toEqual([
    'claimed',
    'claimed',
  ]);
  expect(batch.results.slice(2)).toEqual([
    expect.objectContaining({
      orderId: placed[2]!.id,
      status: 'failed',
      code: 'CONFLICT',
    }),
    expect.objectContaining({
      orderId: placed[3]!.id,
      status: 'failed',
      code: 'CONFLICT',
    }),
    expect.objectContaining({
      orderId: own.id,
      status: 'claimed',
    }),
    {
      orderId: foreignOrder.id,
      status: 'failed',
      code: 'NOT_FOUND',
      message: 'Order not found for this market date',
    },
    {
      orderId: missing,
      status: 'failed',
      code: 'NOT_FOUND',
      message: 'Order not found for this market date',
    },
  ]);
  await closeCutoff(run.id);
  await driver.rpc.driver.start.mutate({ id: placed[0]!.id });
  await driver.rpc.driver.start.mutate({ id: own.id });
  const ownDetail = await driver.rpc.driver.detail.query({ id: own.id });
  expect(ownDetail.isOwnOrder).toBe(true);
  await driver.rpc.driver.purchase.mutate({
    orderId: own.id,
    orderItemId: ownDetail.items[0]!.id,
    quantity: 1,
    totalCostCents: 250,
  });
  await driver.rpc.driver.finish.mutate({ id: own.id });
  await driver.rpc.driver.deliver.mutate({
    orderId: own.id,
    status: 'out_for_delivery',
  });
  await driver.rpc.driver.deliver.mutate({
    orderId: own.id,
    status: 'delivered',
  });
  expect((await driver.rpc.driver.detail.query({ id: own.id })).status).toBe(
    'delivered',
  );
  const retry = await driver.rpc.driver.claimBatch.mutate({
    runId: run.id,
    orderIds: ids.slice(0, 2),
  });
  expect(retry.results.map((result) => result.status)).toEqual([
    'already_claimed',
    'already_claimed',
  ]);
  for (const orderId of ids.slice(0, 2)) {
    const counts = await db.execute<{ events: number; audits: number }>(
      sql`select (select count(*)::int from order_events where order_id=${orderId} and status='claimed') as events, (select count(*)::int from audit_events where target_id=${orderId} and action='order.claimed') as audits`,
    );
    expect(counts.rows[0]).toEqual({ events: 1, audits: 1 });
  }
  await db
    .update(marketRuns)
    .set({ endsAt: new Date(Date.now() - 1000) })
    .where(eq(marketRuns.id, run.id));
  expect(
    (
      await driver.rpc.driver.claimBatch.mutate({
        runId: run.id,
        orderIds: [placed[1]!.id, placed[4]!.id],
      })
    ).results,
  ).toEqual([
    { orderId: placed[1]!.id, status: 'already_claimed' },
    expect.objectContaining({
      orderId: placed[4]!.id,
      status: 'failed',
      code: 'CONFLICT',
    }),
  ]);
  await admin.rpc.admin.reviewDriver.mutate({
    userId: driver.id,
    status: 'suspended',
  });
  await rejectCode(
    driver.rpc.driver.claimBatch.mutate({
      runId: run.id,
      orderIds: [placed[1]!.id],
    }),
    'FORBIDDEN',
  );
  for (const person of [customer, driver, rival, admin, foreign.admin])
    await person.request.dispose();
});

test('overlapping batch claims avoid double assignment and shared market locks permit independent claims', async () => {
  const { run, stock } = await setup(10);
  const customer = await actor(),
    a = await actor('driver'),
    b = await actor('driver');
  const placed: Awaited<ReturnType<typeof customer.rpc.orders.place.mutate>>[] =
    [];
  for (let i = 0; i < 4; i++)
    placed.push(
      await customer.rpc.orders.place.mutate({
        runId: run.id,
        requestId: randomUUID(),
        items: [{ inventoryId: stock.id, quantity: 1 }],
      }),
    );
  const batches = await Promise.all([
    a.rpc.driver.claimBatch.mutate({
      runId: run.id,
      orderIds: [placed[0]!.id, placed[1]!.id],
    }),
    b.rpc.driver.claimBatch.mutate({
      runId: run.id,
      orderIds: [placed[1]!.id, placed[0]!.id, placed[2]!.id],
    }),
  ]);
  expect(
    batches
      .flatMap((batch) => batch.results)
      .filter((result) => result.status === 'claimed'),
  ).toHaveLength(3);
  expect(
    batches
      .flatMap((batch) => batch.results)
      .filter((result) => result.status === 'failed'),
  ).toHaveLength(2);
  for (const placedOrder of placed.slice(0, 3)) {
    const row = (await customer.rpc.orders.mine.query()).find(
      (order) => order.id === placedOrder.id,
    )!;
    expect([a.id, b.id]).toContain(row.driverId);
    expect(
      row.events.filter((event) => event.status === 'claimed'),
    ).toHaveLength(1);
  }
  const held = await pool.connect();
  let claim: ReturnType<typeof a.rpc.driver.claimBatch.mutate> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await held.query('BEGIN');
    await held.query('SELECT id FROM market_runs WHERE id=$1 FOR SHARE', [
      run.id,
    ]);
    claim = a.rpc.driver.claimBatch.mutate({
      runId: run.id,
      orderIds: [placed[3]!.id],
    });
    const result = await Promise.race([
      claim,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error('Claim blocked by a compatible shared market lock'),
            ),
          5000,
        );
      }),
    ]);
    expect(result.results).toEqual([
      { orderId: placed[3]!.id, status: 'claimed' },
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    await held.query('ROLLBACK');
    held.release();
    if (claim) await claim;
  }
  for (const person of [customer, a, b]) await person.request.dispose();
});

test('grouped driver API counts and paginates market dates and their orders independently without private customer data', async () => {
  const first = await setup(10),
    second = await setup(5);
  const customer = await actor(),
    driver = await actor('driver');
  const later = await first.admin.rpc.admin.scheduleRun.mutate({
    ...first.run,
    startsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    endsAt: new Date(Date.now() + 4 * 86400000).toISOString(),
    deliveryStartAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    deliveryEndAt: new Date(Date.now() + 4 * 86400000).toISOString(),
  });
  const laterStock = await first.admin.rpc.admin.saveInventory.mutate({
    runId: later.id,
    produceId: first.produce.id,
    priceCents: 350,
    quantity: 10,
  });
  const placed: Awaited<ReturnType<typeof customer.rpc.orders.place.mutate>>[] =
    [];
  for (let i = 0; i < 3; i++)
    placed.push(
      await customer.rpc.orders.place.mutate({
        runId: first.run.id,
        requestId: randomUUID(),
        items: [{ inventoryId: first.stock.id, quantity: 1 }],
      }),
    );
  await customer.rpc.orders.place.mutate({
    runId: later.id,
    requestId: randomUUID(),
    items: [{ inventoryId: laterStock.id, quantity: 2 }],
  });
  await customer.rpc.orders.place.mutate({
    runId: second.run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: second.stock.id, quantity: 1 }],
  });
  const groups = await driver.rpc.driver.orderGroups.query({
    view: 'available',
    marketId: first.market.id,
    limit: 1,
    orderLimit: 2,
  });
  expect(groups).toMatchObject({
    totalGroups: 2,
    hasMore: true,
    nextOffset: 1,
  });
  expect(groups.markets).toHaveLength(1);
  expect(groups.markets[0]).toMatchObject({
    market: { id: first.market.id },
    orderCount: 3,
  });
  const date = groups.markets[0]!.dates[0]!;
  expect(date).toMatchObject({
    run: { id: first.run.id },
    page: { total: 3, hasMore: true, nextOffset: 2 },
  });
  expect(date.page.items.map((order) => order.id)).toEqual(
    placed.slice(0, 2).map((order) => order.id),
  );
  for (const order of date.page.items)
    for (const key of [
      'customerName',
      'phone',
      'address',
      'street',
      'deliveryNotes',
      'customerId',
    ])
      expect(order).not.toHaveProperty(key);
  const rest = await driver.rpc.driver.orders.query({
    view: 'available',
    runId: first.run.id,
    limit: 2,
    offset: 2,
  });
  expect(rest).toMatchObject({ total: 3, hasMore: false, nextOffset: null });
  expect(rest.items.map((order) => order.id)).toEqual([placed[2]!.id]);
  const next = await driver.rpc.driver.orderGroups.query({
    view: 'available',
    marketId: first.market.id,
    limit: 1,
    orderLimit: 2,
    offset: groups.nextOffset!,
  });
  expect(next).toMatchObject({
    totalGroups: 2,
    hasMore: false,
    nextOffset: null,
  });
  expect(next.markets[0]!.dates[0]!.run.id).toBe(later.id);
  expect(
    (
      await driver.rpc.driver.orderGroups.query({
        view: 'available',
        marketId: first.market.id,
        offset: 10,
      })
    ).markets,
  ).toEqual([]);
  await driver.rpc.driver.claimBatch.mutate({
    runId: first.run.id,
    orderIds: [placed[0]!.id],
  });
  expect(
    (
      await driver.rpc.driver.orderGroups.query({
        view: 'mine',
        marketId: first.market.id,
      })
    ).markets[0]!.dates[0]!.page.total,
  ).toBe(1);
  expect(
    (
      await driver.rpc.driver.orderGroups.query({
        view: 'available',
        marketId: first.market.id,
      })
    ).markets[0]!.dates[0]!.page.total,
  ).toBe(2);
  await rejectCode(
    customer.rpc.driver.orderGroups.query({ view: 'available' }),
    'FORBIDDEN',
  );
  for (const person of [customer, driver, first.admin, second.admin])
    await person.request.dispose();
});

test('combined shopping shows every assigned order across pages, allocates exact cents, and finalizes shortages per customer', async () => {
  const { run, stock, market } = await setup(50),
    other = await setup(5);
  const customer = await actor(),
    driver = await actor('driver'),
    rival = await actor('driver');
  const placed: Awaited<ReturnType<typeof customer.rpc.orders.place.mutate>>[] =
    [];
  for (let i = 0; i < 27; i++)
    placed.push(
      await customer.rpc.orders.place.mutate({
        runId: run.id,
        requestId: randomUUID(),
        items: [{ inventoryId: stock.id, quantity: 1 }],
      }),
    );
  await driver.rpc.driver.claimBatch.mutate({
    runId: run.id,
    orderIds: placed.slice(0, 26).map((order) => order.id),
  });
  await rival.rpc.driver.claim.mutate({ id: placed[26]!.id });
  const elsewhere = await customer.rpc.orders.place.mutate({
    runId: other.run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: other.stock.id, quantity: 1 }],
  });
  await driver.rpc.driver.claim.mutate({ id: elsewhere.id });
  const trip = await driver.rpc.driver.shoppingList.query({ runId: run.id });
  expect(trip.market.id).toBe(market.id);
  expect(trip.orders).toHaveLength(26);
  expect(trip.orders.map((order) => order.id)).not.toContain(placed[26]!.id);
  expect(trip.orders.map((order) => order.id)).not.toContain(elsewhere.id);
  const product = trip.vendors[0]!.items[0]!;
  expect(product).toMatchObject({
    requestedQuantity: 26,
    purchasedQuantity: 0,
    remainingQuantity: 26,
  });
  expect(product.allocations).toHaveLength(26);
  await rejectCode(
    driver.rpc.driver.startShoppingBatch.mutate({ runId: run.id }),
    'CONFLICT',
  );
  await closeCutoff(run.id);
  expect(
    await driver.rpc.driver.startShoppingBatch.mutate({ runId: run.id }),
  ).toEqual({ ordersStarted: 26 });
  expect(
    await driver.rpc.driver.startShoppingBatch.mutate({ runId: run.id }),
  ).toEqual({ ordersStarted: 0 });
  const input = {
    runId: run.id,
    inventoryId: stock.id,
    quantity: 25,
    totalCostCents: 2501,
    allocations: product.allocations.map((line, index) => ({
      orderItemId: line.orderItemId,
      quantity: index < 25 ? 1 : 0,
      expectedPurchaseUpdatedAt: null,
    })),
  };
  const bought = await driver.rpc.driver.combinedPurchase.mutate(input);
  expect(
    bought.allocations.reduce((sum, line) => sum + line.totalCostCents, 0),
  ).toBe(2501);
  expect(bought.allocations.reduce((sum, line) => sum + line.quantity, 0)).toBe(
    25,
  );
  const saved = await driver.rpc.driver.shoppingList.query({ runId: run.id });
  expect(saved.vendors[0]!.items[0]).toMatchObject({
    requestedQuantity: 26,
    purchasedQuantity: 25,
    remainingQuantity: 0,
    shortageQuantity: 1,
    totalCostCents: 2501,
  });
  await rejectCode(
    driver.rpc.driver.combinedPurchase.mutate(input),
    'CONFLICT',
  );
  expect(
    await driver.rpc.driver.finishShoppingBatch.mutate({ runId: run.id }),
  ).toEqual({ ordersCompleted: 26 });
  expect(
    await driver.rpc.driver.finishShoppingBatch.mutate({ runId: run.id }),
  ).toEqual({ ordersCompleted: 0 });
  const final = await driver.rpc.driver.shoppingList.query({ runId: run.id });
  expect(final.orders.filter((order) => order.status === 'ready')).toHaveLength(
    25,
  );
  expect(
    final.orders.filter((order) => order.status === 'unavailable'),
  ).toHaveLength(1);
  expect(
    final.orders
      .filter((order) => order.status === 'ready')
      .every((order) => order.actualTotalCents === 850),
  ).toBe(true);
  expect(
    final.orders.find((order) => order.status === 'unavailable')!
      .actualTotalCents,
  ).toBe(0);
  expect(
    (await rival.rpc.driver.detail.query({ id: placed[26]!.id })).status,
  ).toBe('claimed');
  expect(
    (await driver.rpc.driver.detail.query({ id: elsewhere.id })).status,
  ).toBe('claimed');
  for (const person of [customer, driver, rival])
    await person.request.dispose();
});

test('combined purchases validate ownership, current allocations and saved versions; incomplete finalization rolls back', async () => {
  const { admin, run, stock, produce } = await setup(20);
  const customer = await actor(),
    driver = await actor('driver'),
    rival = await actor('driver');
  const farm = await admin.rpc.admin.createFarm.mutate({
    name: 'Second vendor',
    location: 'West stall',
  });
  const duplicate = await admin.rpc.admin.createProduce.mutate({
    name: produce.name,
    description: 'Different farm',
    category: 'Vegetables',
    unit: 'bunch',
    farmId: farm.id,
  });
  const extra = await admin.rpc.admin.saveInventory.mutate({
    runId: run.id,
    produceId: duplicate.id,
    quantity: 10,
    priceCents: 400,
  });
  const a = await customer.rpc.orders.place.mutate({
      runId: run.id,
      requestId: randomUUID(),
      items: [
        { inventoryId: stock.id, quantity: 2 },
        { inventoryId: extra.id, quantity: 1 },
      ],
    }),
    b = await customer.rpc.orders.place.mutate({
      runId: run.id,
      requestId: randomUUID(),
      items: [{ inventoryId: stock.id, quantity: 2 }],
    });
  await driver.rpc.driver.claimBatch.mutate({
    runId: run.id,
    orderIds: [a.id, b.id],
  });
  await rejectCode(
    customer.rpc.driver.shoppingList.query({ runId: run.id }),
    'FORBIDDEN',
  );
  await rejectCode(
    rival.rpc.driver.shoppingList.query({ runId: run.id }),
    'NOT_FOUND',
  );
  await closeCutoff(run.id);
  await driver.rpc.driver.startShoppingBatch.mutate({ runId: run.id });
  const trip = await driver.rpc.driver.shoppingList.query({ runId: run.id });
  expect(trip.vendors).toHaveLength(2);
  const product = trip.vendors
    .flatMap((vendor) => vendor.items)
    .find((item) => item.inventoryId === stock.id)!;
  expect(product.requestedQuantity).toBe(4);
  const input = {
    runId: run.id,
    inventoryId: stock.id,
    quantity: 3,
    totalCostCents: 501,
    allocations: product.allocations.map((line, index) => ({
      orderItemId: line.orderItemId,
      quantity: index ? 1 : 2,
      expectedPurchaseUpdatedAt: line.purchaseUpdatedAt,
    })),
  };
  await rejectCode(
    driver.rpc.driver.setPacked.mutate({
      orderId: a.id,
      orderItemId: product.allocations[0]!.orderItemId,
      packed: true,
    }),
    'CONFLICT',
  );
  await rejectCode(
    driver.rpc.driver.combinedPurchase.mutate({
      ...input,
      allocations: input.allocations.slice(0, 1),
    }),
    'CONFLICT',
  );
  await rejectCode(
    driver.rpc.driver.combinedPurchase.mutate({ ...input, quantity: 4 }),
    'BAD_REQUEST',
  );
  await rejectCode(
    driver.rpc.driver.combinedPurchase.mutate({
      ...input,
      allocations: [input.allocations[0]!, input.allocations[0]!],
    }),
    'BAD_REQUEST',
  );
  await rejectCode(
    rival.rpc.driver.combinedPurchase.mutate(input),
    'NOT_FOUND',
  );
  await driver.rpc.driver.purchase.mutate({
    orderId: a.id,
    orderItemId: product.allocations[0]!.orderItemId,
    quantity: 1,
    totalCostCents: 200,
  });
  await rejectCode(
    driver.rpc.driver.combinedPurchase.mutate(input),
    'CONFLICT',
  );
  const current = await driver.rpc.driver.shoppingList.query({ runId: run.id });
  const fresh = current.vendors
    .flatMap((vendor) => vendor.items)
    .find((item) => item.inventoryId === stock.id)!;
  input.allocations = fresh.allocations.map((line, index) => ({
    orderItemId: line.orderItemId,
    quantity: index ? 1 : 2,
    expectedPurchaseUpdatedAt: line.purchaseUpdatedAt,
  }));
  expect(
    (await driver.rpc.driver.combinedPurchase.mutate(input)).allocations.map(
      (line) => line.totalCostCents,
    ),
  ).toEqual([334, 167]);
  await rejectCode(
    driver.rpc.driver.finishShoppingBatch.mutate({ runId: run.id }),
    'BAD_REQUEST',
  );
  const still = await driver.rpc.driver.shoppingList.query({ runId: run.id });
  expect(still.orders.every((order) => order.status === 'shopping')).toBe(true);
  expect(
    still.orders
      .flatMap((order) => order.items)
      .every((item) => item.fulfilledQuantity === null),
  ).toBe(true);
  const missing = still.vendors
    .flatMap((vendor) => vendor.items)
    .find((item) => item.inventoryId === extra.id)!;
  await driver.rpc.driver.combinedPurchase.mutate({
    runId: run.id,
    inventoryId: extra.id,
    quantity: 0,
    totalCostCents: 0,
    allocations: missing.allocations.map((line) => ({
      orderItemId: line.orderItemId,
      quantity: 0,
      expectedPurchaseUpdatedAt: line.purchaseUpdatedAt,
    })),
  });
  await driver.rpc.driver.finishShoppingBatch.mutate({ runId: run.id });
  const finished = await driver.rpc.driver.shoppingList.query({
    runId: run.id,
  });
  const orderA = finished.orders.find((order) => order.id === a.id)!;
  expect(orderA.actualTotalCents).toBe(1200);
  expect(
    finished.orders.find((order) => order.id === b.id)!.actualTotalCents,
  ).toBe(850);
  const available = orderA.items.find((item) => item.inventoryId === stock.id)!,
    unavailable = orderA.items.find((item) => item.inventoryId === extra.id)!;
  await rejectCode(
    driver.rpc.driver.setPacked.mutate({
      orderId: a.id,
      orderItemId: unavailable.id,
      packed: true,
    }),
    'BAD_REQUEST',
  );
  await rejectCode(
    rival.rpc.driver.setPacked.mutate({
      orderId: a.id,
      orderItemId: available.id,
      packed: true,
    }),
    'FORBIDDEN',
  );
  await driver.rpc.driver.setPacked.mutate({
    orderId: a.id,
    orderItemId: available.id,
    packed: true,
  });
  expect(
    (await driver.rpc.driver.shoppingList.query({ runId: run.id })).orders
      .find((order) => order.id === a.id)!
      .items.find((item) => item.id === available.id)!.packedAt,
  ).not.toBeNull();
  await driver.rpc.driver.setPacked.mutate({
    orderId: a.id,
    orderItemId: available.id,
    packed: false,
  });
  expect(
    (await driver.rpc.driver.detail.query({ id: a.id })).items.find(
      (item) => item.id === available.id,
    )!.packedAt,
  ).toBeNull();
  await admin.rpc.admin.reviewDriver.mutate({
    userId: driver.id,
    status: 'suspended',
  });
  await rejectCode(
    driver.rpc.driver.shoppingList.query({ runId: run.id }),
    'FORBIDDEN',
  );
  await rejectCode(
    driver.rpc.driver.finishShoppingBatch.mutate({ runId: run.id }),
    'FORBIDDEN',
  );
  for (const person of [customer, driver, rival, admin])
    await person.request.dispose();
});

test('jobs count changed entities and filter empty history before the limit', async () => {
  const admin = await actor('admin');
  const networkId = randomUUID();
  await db.insert(networks).values({
    id: networkId,
    name: 'Job impact test',
    slug: 'job-impact-' + networkId,
    frontendOrigin: baseURL,
  });
  await db
    .insert(networkMemberships)
    .values({ networkId, userId: admin.id, role: 'network_admin' });
  const scoped = networkDatabase(db, networkId, admin.id);
  const rpc = api(admin.request, networkId);
  try {
    const login = await admin.request.post('/api/auth/sign-in/email', {
      headers: { Origin: baseURL, 'x-network-id': networkId },
      data: { email: admin.email, password },
    });
    expect(login.status(), await login.text()).toBe(200);
    const market = await rpc.admin.createMarket.mutate({
      name: 'Impact market',
      address: '100 Main Street, Ojai, CA',
      timezone: 'America/Los_Angeles',
    });
    await rpc.admin.saveSchedule.mutate({
      marketId: market.id,
      weekday: 0,
      opensMinute: 540,
      closesMinute: 780,
    });
    const created = await runMarketRunsJob(
      scoped,
      'cli',
      new Date('2031-01-01T12:00:00Z'),
    );
    expect(created).toMatchObject({ runsCreated: 4, impactedEntities: 4 });
    const repeated = await runMarketRunsJob(
      scoped,
      'cli',
      new Date('2031-01-01T12:00:00Z'),
    );
    expect(repeated).toMatchObject({
      schedulesProcessed: 1,
      runsCreated: 0,
      impactedEntities: 0,
    });
    const [record] = await db
      .select()
      .from(backgroundJobRuns)
      .where(eq(backgroundJobRuns.id, created.id!));
    expect(record!.impactedEntities).toBe(4);
    await db.insert(backgroundJobRuns).values(
      Array.from({ length: 21 }, (_, i) => ({
        networkId,
        name: 'Empty history test',
        source: 'cli',
        status: 'succeeded',
        startedAt: new Date(Date.now() + i),
        runsCreated: 100,
      })),
    );
    // Older/backfilled rows default to zero even if their legacy counters are nonzero.
    const useful = await rpc.admin.jobs.query();
    expect(useful.map((job) => job.id)).toEqual([created.id]);
    const all = await rpc.admin.jobs.query({ includeEmpty: true });
    expect(all).toHaveLength(20);
    expect(all.every((job) => job.impactedEntities === 0)).toBe(true);
    const run = (await rpc.admin.runs.query())[0]!.run;
    const farm = await rpc.admin.createFarm.mutate({
      name: 'Impact grower',
      location: 'Ojai',
    });
    const produce = await rpc.admin.createProduce.mutate({
      name: 'Impact carrots',
      farmId: farm.id,
      category: 'Vegetables',
      unit: 'bunch',
      description: '',
    });
    const stock = await rpc.admin.saveInventory.mutate({
      runId: run.id,
      produceId: produce.id,
      priceCents: 350,
      quantity: 10,
      repeat: false,
    });
    await rpc.profile.save.mutate({
      name: 'Impact shopper',
      phone: '8055550123',
      street: '10 Main Street',
      unit: '',
      city: 'Ojai',
      region: 'CA',
      postalCode: '93023',
      deliveryNotes: '',
    });
    const activeOrder = await rpc.orders.place.mutate({
      runId: run.id,
      requestId: randomUUID(),
      items: [{ inventoryId: stock.id, quantity: 1 }],
    });
    const cancelledOrder = await rpc.orders.place.mutate({
      runId: run.id,
      requestId: randomUUID(),
      items: [{ inventoryId: stock.id, quantity: 1 }],
    });
    await rpc.orders.cancel.mutate({ id: cancelledOrder.id });
    expect(await rpc.orders.list.query()).toHaveLength(2);
    expect(await rpc.orders.list.query({ statuses: [] })).toHaveLength(2);
    expect(await rpc.orders.list.query({ statuses: ['delivered'] })).toEqual(
      [],
    );
    expect(
      (
        await rpc.orders.list.query({
          scope: 'network',
          statuses: ['placed'],
          limit: 1,
        })
      )[0]!.id,
    ).toBe(activeOrder.id);
    expect(await rpc.orders.mine.query()).toHaveLength(2);
    expect(await rpc.orders.mine.query({ statuses: [] })).toHaveLength(2);
    expect(
      await rpc.orders.mine.query({ statuses: ['placed', 'cancelled'] }),
    ).toHaveLength(2);
    expect(await rpc.orders.mine.query({ statuses: ['delivered'] })).toEqual(
      [],
    );
    expect(
      (await rpc.admin.orders.query({ runId: run.id, limit: 1 }))[0]!.id,
    ).toBe(cancelledOrder.id);
    expect(
      await rpc.admin.orders.query({
        runId: run.id,
        statuses: ['placed', 'cancelled'],
      }),
    ).toHaveLength(2);
    expect(
      (
        await rpc.admin.orders.query({
          runId: run.id,
          limit: 1,
          statuses: ['placed'],
        })
      )[0]!.id,
    ).toBe(activeOrder.id);
    expect(
      (
        await rpc.admin.orders.query({
          runId: run.id,
          limit: 1,
          statuses: [],
        })
      )[0]!.id,
    ).toBe(cancelledOrder.id);
    const closed = await runCloseMarketsJob(
      scoped,
      'cli',
      new Date('2031-02-01T12:00:00Z'),
    );
    expect(closed).toMatchObject({
      runsClosed: 4,
      ordersCancelled: 1,
      impactedEntities: 5,
    });
    const [closing] = await db
      .select()
      .from(backgroundJobRuns)
      .where(eq(backgroundJobRuns.id, closed.id!));
    expect(closing!.impactedEntities).toBe(5);
    const closedAgain = await runCloseMarketsJob(
      scoped,
      'cli',
      new Date('2031-02-01T12:00:00Z'),
    );
    expect(closedAgain).toMatchObject({
      runsClosed: 0,
      ordersCancelled: 0,
      impactedEntities: 0,
    });
  } finally {
    await db
      .update(networks)
      .set({ deletedAt: new Date() })
      .where(eq(networks.id, networkId));
  }
});
