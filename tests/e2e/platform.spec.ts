import {
  test,
  expect,
  request as requests,
  type APIRequestContext,
} from '@playwright/test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  createDatabase,
  invitations,
  userRoles,
  networkMemberships,
  networks,
  farms,
  produce,
  orders,
  oauthAccessToken,
  oauthRefreshToken,
  driverProfiles,
} from '@market/db';
import { bootstrapGlobalAdmin } from '@market/core/bootstrap';
import { operations } from '@market/core/operations';
import { networkOperations } from '@market/core/networks';
import { networkDatabase } from '@market/db';
import { parseEnvironment } from '@market/core/config';
import {
  listProviders,
  listInterfaces,
  getSetupInstructions,
  getTokenSaveCommand,
} from '@market/mcp-instructions';

const adminOrigin = 'http://localhost:5190';
const businessOrigin = 'http://localhost:5180';
const silverOrigin = 'http://localhost:4322';
const silverId = '00000000-0000-4000-8000-000000000002';
const partnerId = '00000000-0000-4000-8000-000000000003';
const password = 'A-new-platform-password-123!';
const databaseURL =
  process.env.E2E_DATABASE_URL ||
  'postgresql://market:market@localhost:5433/market_delivered_e2e';
if (!new URL(databaseURL).pathname.endsWith('_e2e'))
  throw new Error('An isolated E2E database is required');
const { db, pool } = createDatabase(databaseURL);
const email = `platform-${randomUUID()}@example.test`;
let admin: APIRequestContext;
let owner: { id: string; email: string };
async function query(
  context: APIRequestContext,
  path: string,
  input?: unknown,
  adminSurface = true,
) {
  return context.get((adminSurface ? '/admin/trpc/' : '/trpc/') + path, {
    params: input === undefined ? {} : { input: JSON.stringify(input) },
  });
}
async function mutation(
  context: APIRequestContext,
  path: string,
  input: unknown,
) {
  return context.post('/admin/trpc/' + path, {
    data: input,
    headers: { Origin: adminOrigin },
  });
}
async function mcp(
  context: APIRequestContext,
  token: string,
  method: string,
  params?: unknown,
) {
  return context.post(context === admin ? '/admin/mcp' : '/mcp', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) },
  });
}
async function invitation(email: string, networkId = silverId) {
  const token = randomBytes(32).toString('hex');
  await db.insert(invitations).values({
    networkId,
    email,
    role: 'customer',
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 86400000),
  });
  return token;
}
test.beforeAll(async () => {
  owner = await bootstrapGlobalAdmin(db, email, password);
  admin = await requests.newContext({ baseURL: adminOrigin });
  const response = await admin.post('/admin/auth/sign-in/email', {
    headers: { Origin: adminOrigin },
    data: { email, password },
  });
  expect(response.status(), await response.text()).toBe(200);
});
test.afterAll(async () => {
  await admin?.dispose();
  await pool.end();
});

test('public and administrator APIs expose different routers and require explicit business context', async () => {
  const publicApi = await requests.newContext({ baseURL: businessOrigin });
  try {
    expect((await query(publicApi, 'me', undefined, false)).status()).toBe(400);
    for (const path of [
      'networks.list',
      'networks.create',
      'networks.update',
      'tokens.list',
    ])
      expect(
        (
          await publicApi.get('/trpc/' + path, {
            headers: { 'X-Network-Id': silverId },
          })
        ).status(),
      ).toBe(404);
    expect((await query(admin, 'markets.list')).status()).toBe(404);
    const me = (await (await query(admin, 'me')).json()).result.data;
    expect(me).toMatchObject({ email, globalAdmin: true });
    expect(me).not.toHaveProperty('network');
    const missing = await publicApi.get('/trpc/me', {
      headers: { 'X-Network-Id': randomUUID() },
    });
    expect(missing.status()).toBe(404);
    const shared = await requests.newContext({
      baseURL: businessOrigin,
      storageState: await admin.storageState(),
    });
    try {
      const platform = await shared.get('/admin/trpc/me', {
        headers: { Origin: adminOrigin },
      });
      expect(platform.status()).toBe(200);
      expect((await platform.json()).result.data).toMatchObject({
        email,
        globalAdmin: true,
      });
      const foreign = await shared.get('/admin/trpc/networks.list', {
        headers: { Origin: silverOrigin },
      });
      expect(foreign.status()).toBe(403);
    } finally {
      await shared.dispose();
    }
  } finally {
    await publicApi.dispose();
  }
});

test('administrator auth is independent of networks and rejects public signup and ordinary accounts', async () => {
  const anonymous = await requests.newContext({ baseURL: adminOrigin });
  try {
    expect((await query(anonymous, 'networks.list')).status()).toBe(401);
    const nonAdminEmail = `ordinary-${randomUUID()}@example.test`;
    const ordinary = await bootstrapGlobalAdmin(db, nonAdminEmail, password);
    await db.delete(userRoles).where(eq(userRoles.userId, ordinary.id));
    const denied = await anonymous.post('/admin/auth/sign-in/email', {
      headers: { Origin: adminOrigin },
      data: { email: nonAdminEmail, password },
    });
    expect(denied.status()).toBe(403);
    const signup = await anonymous.post('/admin/auth/sign-up/email', {
      headers: { Origin: adminOrigin },
      data: { email: nonAdminEmail, password, name: 'Ordinary' },
    });
    expect(signup.status()).not.toBe(200);
    expect((await query(anonymous, 'tokens.list')).status()).toBe(401);
    const publicApi = await requests.newContext({
      baseURL: businessOrigin,
      storageState: await admin.storageState(),
    });
    try {
      const response = await publicApi.get('/trpc/me', {
        headers: { 'X-Network-Id': silverId },
      });
      expect((await response.json()).result.data).toBeNull();
    } finally {
      await publicApi.dispose();
    }
  } finally {
    await anonymous.dispose();
  }
});

test('network statistics are global-only and count each network independently', async () => {
  const populatedId = randomUUID(),
    emptyId = randomUUID(),
    deletedId = randomUUID();
  await db.insert(networks).values([
    {
      id: populatedId,
      name: 'Statistics populated',
      slug: 'stats-' + populatedId,
    },
    { id: emptyId, name: 'Statistics empty', slug: 'stats-' + emptyId },
    {
      id: deletedId,
      name: 'Statistics deleted',
      slug: 'stats-' + deletedId,
      deletedAt: new Date(),
    },
  ]);
  const farmId = randomUUID();
  await db.insert(farms).values([
    {
      id: farmId,
      networkId: populatedId,
      name: 'Active vendor',
      location: 'Ojai',
    },
    {
      networkId: populatedId,
      name: 'Inactive vendor',
      location: 'Ojai',
      active: false,
    },
    { networkId: deletedId, name: 'Deleted network vendor', location: 'Ojai' },
  ]);
  await db.insert(produce).values(
    ['Carrots', 'Apples'].map((name) => ({
      networkId: populatedId,
      farmId,
      name,
      description: 'Statistics check',
      category: 'Vegetables' as const,
      unit: 'lb' as const,
      priceCents: 350,
    })),
  );
  await db
    .insert(networkMemberships)
    .values({ networkId: populatedId, userId: owner.id });
  const result = await query(admin, 'networks.statistics');
  expect(result.status(), await result.text()).toBe(200);
  const rows = (await result.json()).result.data;
  expect(
    rows.find((row: { id: string }) => row.id === populatedId),
  ).toMatchObject({
    members: 1,
    vendors: 1,
    products: 2,
    markets: 0,
    upcomingRuns: 0,
    orders: 0,
    delivered: 0,
    orderValueCents: 0,
  });
  expect(rows.find((row: { id: string }) => row.id === emptyId)).toMatchObject({
    members: 0,
    vendors: 0,
    products: 0,
    orders: 0,
    orderValueCents: 0,
  });
  expect(rows.some((row: { id: string }) => row.id === deletedId)).toBe(false);
  const anonymous = await requests.newContext({ baseURL: adminOrigin });
  const publicApi = await requests.newContext({
    baseURL: businessOrigin,
    extraHTTPHeaders: { 'X-Network-Id': silverId },
  });
  try {
    expect((await query(anonymous, 'networks.statistics')).status()).toBe(401);
    expect(
      (
        await query(publicApi, 'networks.statistics', undefined, false)
      ).status(),
    ).toBe(404);
  } finally {
    await anonymous.dispose();
    await publicApi.dispose();
  }
});

test('platform management and MCP are isolated from business tokens and tool catalogs', async () => {
  const created = await mutation(admin, 'tokens.create', {
    name: 'Platform boundary check',
  });
  expect(created.status(), await created.text()).toBe(200);
  const globalToken = (await created.json()).result.data.token;
  const publicApi = await requests.newContext({ baseURL: businessOrigin });
  const actor = { ...owner, name: 'Owner', admin: true, globalAdmin: true };
  const scopedToken = await operations(
    networkDatabase(db, silverId, owner.id),
    actor,
  ).createApiToken('Silverstreak boundary check');
  try {
    const publicTools = await mcp(publicApi, scopedToken.token, 'tools/list');
    expect(publicTools.status(), await publicTools.text()).toBe(200);
    const names = (await publicTools.json()).result.tools.map(
      (tool: { name: string }) => tool.name,
    );
    expect(names).toContain('list_markets');
    for (const name of [
      'create_network',
      'list_networks',
      'get_network',
      'update_network',
      'set_network_member',
    ])
      expect(names).not.toContain(name);
    expect((await mcp(publicApi, globalToken, 'tools/list')).status()).toBe(
      401,
    );
    expect((await mcp(admin, scopedToken.token, 'tools/list')).status()).toBe(
      401,
    );
    const adminTools = (
      await (await mcp(admin, globalToken, 'tools/list')).json()
    ).result.tools.map((tool: { name: string }) => tool.name);
    expect(adminTools).toContain('create_network');
    expect(adminTools).not.toContain('create_market');
    const network = await mutation(admin, 'networks.create', {
      name: 'Independent business',
      slug: 'business-' + randomUUID(),
      frontendOrigin: 'http://localhost:4334',
    });
    expect(network.status(), await network.text()).toBe(200);
    const record = (await network.json()).result.data;
    expect(record.frontendOrigin).toBe('http://localhost:4334');
    const updated = await mutation(admin, 'networks.update', {
      networkId: record.id,
      settings: { supportEmail: 'support@example.test' },
    });
    expect(updated.status()).toBe(200);
    expect((await updated.json()).result.data.supportEmail).toBe(
      'support@example.test',
    );
  } finally {
    await publicApi.dispose();
  }
});

test('only global administrators can update a network slug', async () => {
  const [network] = await db
    .insert(networks)
    .values({ name: 'Slug permissions', slug: 'slug-' + randomUUID() })
    .returning();
  const local = networkOperations(
    db,
    { id: owner.id, globalAdmin: false, networkAdmin: true },
    network!.id,
    '',
  );
  const newSlug = 'renamed-' + randomUUID();
  await expect(
    local.update({ slug: newSlug, name: 'Unauthorized rename' }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await local.get()).toMatchObject({
    slug: network!.slug,
    name: 'Slug permissions',
  });
  expect(await local.update({ name: 'Allowed rename' })).toMatchObject({
    slug: network!.slug,
    name: 'Allowed rename',
  });
  const updated = await mutation(admin, 'networks.update', {
    networkId: network!.id,
    settings: { slug: newSlug },
  });
  expect(updated.status(), await updated.text()).toBe(200);
  expect((await updated.json()).result.data.slug).toBe(newSlug);
  expect((await local.get()).slug).toBe(newSlug);
});

test('Silverstreak forwards a fixed context and keeps business cookies separate from partner and administrator sessions', async () => {
  const customer = await requests.newContext({ baseURL: silverOrigin });
  const customerEmail = `silver-${randomUUID()}@example.test`;
  const token = await invitation(customerEmail);
  try {
    const response = await customer.post('/api/auth/sign-up/email', {
      headers: {
        Origin: silverOrigin,
        'X-Network-Id': partnerId,
        'X-Invite-Token': token,
      },
      data: { email: customerEmail, password, name: 'Silver Customer' },
    });
    expect(response.status(), await response.text()).toBe(200);
    const me = (
      await (
        await customer.get('/trpc/me?network=partner', {
          headers: { 'X-Network-Id': partnerId },
        })
      ).json()
    ).result.data;
    expect(me.email).toBe(customerEmail);
    expect(me).not.toHaveProperty('network');
    expect(
      await db
        .select()
        .from(networkMemberships)
        .where(eq(networkMemberships.userId, me.id)),
    ).toMatchObject([{ networkId: silverId }]);
    const cookies = (await customer.storageState()).cookies;
    expect(
      cookies.some((cookie) =>
        cookie.name.startsWith('md-business-' + silverId),
      ),
    ).toBe(true);
    expect((await customer.get('/trpc/networks.list')).status()).toBe(404);
    expect(
      (
        await customer.post('/trpc/orders.place', {
          headers: { Origin: 'https://foreign.example' },
          data: {},
        })
      ).status(),
    ).toBe(403);
    const direct = await requests.newContext({
      baseURL: businessOrigin,
      storageState: await customer.storageState(),
    });
    try {
      const partner = await direct.get('/trpc/me', {
        headers: { 'X-Network-Id': partnerId, Origin: 'http://localhost:4333' },
      });
      expect((await partner.json()).result.data).toBeNull();
      const platform = await direct.get('/admin/trpc/me', {
        headers: { Origin: adminOrigin },
      });
      expect(platform.status()).toBe(200);
      expect((await platform.json()).result.data).toBeNull();
      const wrongOrigin = await direct.get('/trpc/me', {
        headers: { 'X-Network-Id': partnerId, Origin: silverOrigin },
      });
      expect(wrongOrigin.status()).toBe(403);
    } finally {
      await direct.dispose();
    }
  } finally {
    await customer.dispose();
  }
});

test('administrator dashboard has no retired network or business controls', async ({
  page,
}) => {
  await page.goto('/?network=partner&page=operations');
  await expect(
    page.getByRole('heading', { name: 'Administrator sign in' }),
  ).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Global administration' }),
  ).toBeVisible();
  await expect(page.getByLabel('How do you use it?')).toHaveValue('desktop');
  await expect(
    page.getByRole('button', { name: 'Create global token', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('How would you like to connect?').selectOption('token');
  await expect(
    page.getByRole('button', { name: 'Create global token', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /Create network|Save branding|Open network/,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: 'Global administration' }),
  ).toBeVisible();
  await page
    .getByLabel('Global token name', { exact: true })
    .fill('Dashboard credential');
  await page
    .getByRole('button', { name: 'Create global token', exact: true })
    .click();
  const setupProvider = page.getByLabel('Which assistant do you use?');
  await expect(setupProvider).toHaveValue('chatgpt');
  await expect(
    page.getByRole('button', { name: 'Copy Codex setup', exact: true }),
  ).toBeVisible();
  await setupProvider.selectOption('claude');
  await expect(
    page.getByRole('button', { name: 'Copy Claude Code setup', exact: true }),
  ).toBeVisible();
  const secret = page.getByLabel('Global token (shown once)', { exact: true });
  await expect(secret).toHaveValue(/^md_[a-f0-9]{64}$/);
  const credential = page
    .locator('.list-row')
    .filter({ hasText: 'Dashboard credential' });
  await credential
    .getByRole('button', { name: 'Revoke global token', exact: true })
    .click();
  await expect(credential).toContainText('Revoked');
  await expect(secret).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Administrator sign in' }),
  ).toBeVisible();
});

test('Silverstreak renders real routes and a supplied photo without network configuration', async ({
  page,
}) => {
  await page.goto(silverOrigin);
  await expect(
    page.getByRole('heading', { name: 'Fresh produce. Delivered.' }),
  ).toBeVisible();
  await expect(page.locator('.hero-image')).toHaveAttribute(
    'src',
    '/images/silverstreak-landscape.jpg',
  );
  await page
    .locator('.hero-actions')
    .getByRole('link', { name: 'Order now' })
    .click();
  await expect(page).toHaveURL(silverOrigin + '/order');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(silverOrigin + '/account');
  await expect(
    page.getByRole('heading', { name: 'Welcome back.' }),
  ).toBeVisible();
  await expect(page.getByLabel(/network/i)).toHaveCount(0);
  await page.goto(silverOrigin + '/about');
  await expect(
    page.getByRole('heading', { name: 'A market morning. Without the rush.' }),
  ).toBeVisible();
  expect((await page.goto(silverOrigin + '/missing-page'))?.status()).toBe(404);
});

test('production configuration requires independent secrets and secure administrator origins', () => {
  const values = {
    DATABASE_URL: databaseURL,
    NODE_ENV: 'production',
    BETTER_AUTH_SECRET: 'a'.repeat(40),
    ADMIN_AUTH_SECRET: 'b'.repeat(40),
    ADMIN_ORIGIN: 'https://admin.example.test',
    RESEND_API_KEY: 'configured',
    EMAIL_FROM: 'accounts@example.test',
    CRON_SECRET: 'c'.repeat(40),
    VERCEL: '1',
  };
  expect(() => parseEnvironment(values)).not.toThrow();
  expect(() =>
    parseEnvironment({
      ...values,
      ADMIN_AUTH_SECRET: values.BETTER_AUTH_SECRET,
    }),
  ).toThrow();
  expect(() =>
    parseEnvironment({ ...values, ADMIN_ORIGIN: 'http://localhost:5173' }),
  ).toThrow();
  expect(() =>
    parseEnvironment({ ...values, CRON_SECRET: undefined }),
  ).toThrow();
});

test('Silverstreak invitation, delivery details, order placement, cancellation, and sign-out work through SSR', async ({
  page,
}) => {
  const actor = { ...owner, name: 'Owner', admin: true, globalAdmin: true };
  const ops = operations(networkDatabase(db, silverId, owner.id), actor);
  const market = await ops.createMarket({
    name: 'Silverstreak test market',
    address: '100 Market Street, Ojai, CA',
    timezone: 'America/Los_Angeles',
  });
  const farm = await ops.createFarm({
    name: 'Test grower',
    location: 'Ojai',
    contactPhone: '',
    notes: '',
    active: true,
  });
  const produce = await ops.createProduce({
    name: 'Fresh Silverstreak carrots',
    description: 'Market carrots',
    category: 'Vegetables',
    farmId: farm.id,
    unit: 'bunch',
  });
  const now = Date.now();
  const run = await ops.scheduleRun({
    marketId: market.id,
    startsAt: new Date(now + 86400000).toISOString(),
    endsAt: new Date(now + 90000000).toISOString(),
    cutoffAt: new Date(now + 3600000).toISOString(),
    deliveryStartAt: new Date(now + 86400000).toISOString(),
    deliveryEndAt: new Date(now + 90000000).toISOString(),
    deliveryFeeCents: 500,
  });
  await ops.saveInventory({
    runId: run.id,
    produceId: produce.id,
    priceCents: 350,
    quantity: 10,
    active: true,
    repeat: false,
  });
  const customerEmail = `shopper-${randomUUID()}@example.test`;
  const token = await invitation(customerEmail);
  await page.goto(silverOrigin + '/account?invite=' + token);
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    customerEmail,
  );
  await page.getByLabel('Name', { exact: true }).fill('Silverstreak Shopper');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page).toHaveURL(silverOrigin + '/order');
  await page.locator('.profile-menu summary').click();
  await page.getByRole('link', { name: 'Manage account', exact: true }).click();
  await page.getByLabel('Phone', { exact: true }).fill('8055550123');
  await page
    .getByLabel('Street address', { exact: true })
    .fill('25 Main Street');
  await page.getByLabel('City', { exact: true }).fill('Ojai');
  await page.getByLabel('ZIP code', { exact: true }).fill('93023');
  await page
    .getByRole('button', { name: 'Save delivery details', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText(
    'Your delivery details have been saved.',
  );
  await page.goto(silverOrigin + '/order?market=' + run.id);
  await page.getByLabel('Quantity for Fresh Silverstreak carrots').fill('2');
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review your order.' }),
  ).toBeVisible();
  await expect(page.locator('.review-items')).toContainText(
    'Fresh Silverstreak carrots',
  );
  await expect(page.locator('.review-items')).toContainText(
    '2 × $3.50 / bunch',
  );
  await expect(page.locator('.review-totals')).toContainText(
    'Produce subtotal$7.00',
  );
  await expect(page.locator('.review-totals')).toContainText(
    'Delivery fee$5.00',
  );
  await expect(page.locator('.review-total')).toContainText('$12.00');
  await expect(page.locator('.order-review')).toContainText('25 Main Street');
  expect(
    await db.select().from(orders).where(eq(orders.runId, run.id)),
  ).toHaveLength(0);
  await page.getByRole('button', { name: 'Edit order', exact: true }).click();
  await expect(
    page.getByLabel('Quantity for Fresh Silverstreak carrots'),
  ).toHaveValue('2');
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  await page
    .getByRole('button', { name: 'Confirm and place order', exact: true })
    .click();
  await expect(page).toHaveURL(silverOrigin + '/orders?placed=1');
  await expect(page.getByRole('status')).toHaveText(
    'Your order is placed. We’ll take it from here.',
  );
  await page.locator('.order-card > summary').click();
  await expect(
    page.getByText('Estimated total: $12.00', { exact: true }),
  ).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Your order has been cancelled.',
  );
  await expect(page.locator('.order-card')).toHaveCount(0);
  await page.getByLabel('Show cancelled orders').check();
  await expect(page.locator('.order-card')).toHaveCount(1);
  await expect(page.locator('.order-card')).toContainText('cancelled');
  await page.getByLabel('Show cancelled orders').uncheck();
  await expect(page.locator('.order-card')).toHaveCount(0);
  const [cancelledOrder] = await db
    .select()
    .from(orders)
    .where(eq(orders.runId, run.id));
  const membership = and(
    eq(networkMemberships.networkId, silverId),
    eq(networkMemberships.userId, cancelledOrder!.customerId),
  );
  await db
    .update(networkMemberships)
    .set({ role: 'network_admin' })
    .where(membership);
  await page.goto(silverOrigin + '/admin/orders');
  const adminOrder = page
    .locator('.admin-record')
    .filter({ hasText: cancelledOrder!.id.slice(0, 8) });
  await expect(adminOrder).toHaveCount(0);
  await page.getByLabel('Show cancelled orders').check();
  await expect(adminOrder).toHaveCount(1);
  await page.getByLabel('Show cancelled orders').uncheck();
  await expect(adminOrder).toHaveCount(0);
  await db.update(networkMemberships).set({ role: 'member' }).where(membership);
  await page.goto(silverOrigin + '/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(silverOrigin + '/');
  await page.goto(silverOrigin + '/account');
  await expect(
    page.getByRole('heading', { name: 'Welcome back.' }),
  ).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(customerEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(silverOrigin + '/order');
  const forged = await page.request.post(silverOrigin + '/account', {
    headers: { Origin: 'https://untrusted.example' },
    form: { intent: 'signout' },
  });
  expect(forged.status()).toBe(403);
});

test('an existing account joins Silverstreak without copying another business’s delivery profile', async ({
  page,
}) => {
  const customerEmail = `partner-shopper-${randomUUID()}@example.test`;
  const partner = await requests.newContext({
    baseURL: businessOrigin,
    extraHTTPHeaders: {
      'X-Network-Id': partnerId,
      Origin: 'http://localhost:4333',
    },
  });
  try {
    const token = await invitation(customerEmail, partnerId);
    const signup = await partner.post('/api/auth/sign-up/email', {
      headers: { 'X-Invite-Token': token },
      data: { email: customerEmail, name: 'Partner Shopper', password },
    });
    expect(signup.status(), await signup.text()).toBe(200);
    const saved = await partner.post('/trpc/profile.save', {
      data: {
        name: 'Partner Shopper',
        phone: '7075550123',
        street: '55 Other Street',
        city: 'Sonoma',
        region: 'CA',
        postalCode: '95476',
        deliveryNotes: 'Partner only',
      },
    });
    expect(saved.status(), await saved.text()).toBe(200);
    await page.goto(silverOrigin + '/account');
    await page.getByLabel('Email', { exact: true }).fill(customerEmail);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'This account does not have access to Silverstreak yet. Use your invitation to join.',
    );
    const silverInvite = await invitation(customerEmail);
    await page.goto(silverOrigin + '/account?invite=' + silverInvite);
    await page
      .getByRole('button', { name: 'Accept invitation', exact: true })
      .click();
    await expect(page).toHaveURL(silverOrigin + '/order');
    await page.goto(silverOrigin + '/account');
    await expect(
      page.getByLabel('Street address', { exact: true }),
    ).toHaveValue('');
    await expect(
      page.getByLabel('Delivery notes', { exact: true }),
    ).toHaveValue('');
    const original = (await (await partner.get('/trpc/me')).json()).result.data;
    expect(original.customer.street).toBe('55 Other Street');
    expect(original.customer.deliveryNotes).toBe('Partner only');
  } finally {
    await partner.dispose();
  }
});

test('administrator email settings remain encrypted and produce business-specific account links', async () => {
  const { networks } = await import('@market/db');
  const { networkEmailConfig } = await import('@market/core/networks');
  const businessSecret = 'e2e-only-secret-never-use-in-production-123456789';
  const records: { id: string; origin: string; key: string }[] = [];
  for (const label of ['a', 'b']) {
    const origin = `https://business-${label}.example.test`;
    const result = await mutation(admin, 'networks.create', {
      name: `Email business ${label}`,
      slug: `email-${label}-${randomUUID()}`,
      frontendOrigin: origin,
    });
    expect(result.status()).toBe(200);
    const record = (await result.json()).result.data;
    const key = `isolated-provider-key-${label}`;
    const response = await mutation(admin, 'networks.update', {
      networkId: record.id,
      settings: {
        emailKey: key,
        emailFrom: `accounts-${label}@example.test`,
        emailReplyTo: `replies-${label}@example.test`,
      },
    });
    expect(response.status()).toBe(200);
    const settings = (await response.json()).result.data;
    expect(settings.hasEmailKey).toBe(true);
    expect(settings).not.toHaveProperty('emailKeyEncrypted');
    expect(settings).not.toHaveProperty('branding');
    expect(JSON.stringify(settings)).not.toContain(key);
    const [stored] = await db
      .select({ encrypted: networks.emailKeyEncrypted })
      .from(networks)
      .where(eq(networks.id, record.id));
    expect(stored!.encrypted).toBeTruthy();
    expect(stored!.encrypted).not.toContain(key);
    const decoded = await networkEmailConfig(db, record.id, {
      secret: businessSecret,
    });
    expect(decoded.resendKey).toBe(key);
    records.push({ id: record.id, origin, key });
  }
  const { createRequire } = await import('node:module');
  createRequire(new URL('../../packages/core/package.json', import.meta.url))(
    'fastify',
  );
  const { createServer } = await import('@market/core/server');
  const server = await createServer(db, {
    secret: businessSecret,
    adminSecret: 'e2e-admin-only-secret-not-for-production-123456789',
    adminOrigin,
    resendKey: 'platform-provider-key',
    emailFrom: 'platform@example.test',
  });
  const originalFetch = globalThis.fetch;
  const messages: { from: string; reply_to: string; text: string }[] = [];
  const keys: string[] = [];
  globalThis.fetch = async (url, options) => {
    expect(String(url)).toBe('https://api.resend.com/emails');
    messages.push(JSON.parse(String(options?.body)));
    keys.push(new Headers(options?.headers).get('authorization') || '');
    return Response.json({ id: randomUUID() });
  };
  try {
    for (const record of records) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/auth/request-password-reset',
        headers: { origin: record.origin, 'x-network-id': record.id },
        payload: { email, redirectTo: record.origin + '/account' },
      });
      expect(response.statusCode, response.body).toBe(200);
      const link = new URL(messages.at(-1)!.text.split('\n\n')[1]!);
      expect(link.origin).toBe(record.origin);
      expect(link.searchParams.has('network')).toBe(false);
      expect(keys.at(-1)).toBe('Bearer ' + record.key);
    }
    expect(messages[0]!.from).toContain('accounts-a@example.test');
    expect(messages[1]!.from).toContain('accounts-b@example.test');
    expect(messages[0]!.reply_to).toBe('replies-a@example.test');
    expect(messages[1]!.reply_to).toBe('replies-b@example.test');
    const reset = await server.inject({
      method: 'POST',
      url: '/admin/auth/request-password-reset',
      headers: { origin: adminOrigin },
      payload: { email, redirectTo: adminOrigin + '/' },
    });
    expect(reset.statusCode, reset.body).toBe(200);
    const adminLink = new URL(messages.at(-1)!.text.split('\n\n')[1]!);
    expect(adminLink.origin).toBe(adminOrigin);
    expect(adminLink.pathname).toMatch(/^\/admin\/auth\/reset-password\//);
    expect(keys.at(-1)).toBe('Bearer platform-provider-key');
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
  }
});

test('administrator frontend forwards only admin routes to its configured backend', async () => {
  const { default: proxy } = await import('../../apps/admin/proxy');
  const previous = process.env.MARKET_API_ORIGIN;
  try {
    process.env.MARKET_API_ORIGIN = 'https://api.example.test';
    for (const path of [
      '/admin/trpc/me?batch=1',
      '/admin/auth/sign-in/email',
      '/admin/mcp',
    ]) {
      const response = proxy(new Request('https://admin.example.test' + path));
      expect(response.headers.get('x-middleware-rewrite')).toBe(
        'https://api.example.test' + path,
      );
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    const unrelated = proxy(
      new Request('https://admin.example.test/trpc/networks.list'),
    );
    expect(unrelated.headers.get('x-middleware-next')).toBe('1');
    for (const invalid of [
      '',
      'https://admin.example.test',
      'https://api.example.test/nested',
      'file:///tmp/backend',
      'https://user:password@api.example.test',
    ]) {
      process.env.MARKET_API_ORIGIN = invalid;
      expect(
        proxy(new Request('https://admin.example.test/admin/trpc/me')).status,
      ).toBe(503);
    }
  } finally {
    if (previous === undefined) delete process.env.MARKET_API_ORIGIN;
    else process.env.MARKET_API_ORIGIN = previous;
  }
});

test('Silverstreak administrators manage business pages and OAuth setup', async ({
  page,
}) => {
  await page.goto(silverOrigin + '/mcp');
  await expect(page).toHaveURL(silverOrigin + '/account');
  const customer = await requests.newContext({ baseURL: silverOrigin });
  const business = await requests.newContext({ baseURL: businessOrigin });
  try {
    const customerEmail = `mcp-admin-${randomUUID()}@example.test`;
    const invite = await invitation(customerEmail);
    const signup = await customer.post('/api/auth/sign-up/email', {
      headers: { Origin: silverOrigin, 'x-invite-token': invite },
      data: { name: 'MCP Operator', email: customerEmail, password },
    });
    expect(signup.status(), await signup.text()).toBe(200);
    const person = (await signup.json()).user;
    await page.context().addCookies((await customer.storageState()).cookies);
    for (const section of [
      'orders',
      'drivers',
      'users',
      'farms',
      'produce',
      'markets',
      'inventory',
      'jobs',
    ]) {
      expect((await customer.get('/admin/' + section)).status()).toBe(403);
    }
    const forbiddenUsers = await page.request.get(
      businessOrigin + '/trpc/admin.users',
      { headers: { 'X-Network-Id': silverId, Origin: silverOrigin } },
    );
    expect(forbiddenUsers.status()).toBe(403);
    const networkOrders = await page.request.get(
      businessOrigin + '/trpc/orders.list',
      {
        headers: { 'X-Network-Id': silverId, Origin: silverOrigin },
        params: { input: JSON.stringify({ scope: 'network' }) },
      },
    );
    expect(networkOrders.status()).toBe(403);
    const personalOrders = await page.request.get(
      businessOrigin + '/trpc/orders.list',
      { headers: { 'X-Network-Id': silverId, Origin: silverOrigin } },
    );
    expect(personalOrders.status()).toBe(200);
    expect((await personalOrders.json()).result.data).toEqual([]);

    expect((await customer.get('/mcp')).status()).toBe(403);
    expect(
      (
        await customer.post('/mcp', {
          headers: { Origin: silverOrigin },
          form: { intent: 'create', name: 'Denied token' },
        })
      ).status(),
    ).toBe(403);
    await db
      .update(networkMemberships)
      .set({ role: 'network_admin' })
      .where(
        and(
          eq(networkMemberships.networkId, silverId),
          eq(networkMemberships.userId, person.id),
        ),
      );
    await page.goto(silverOrigin + '/account');
    await page.locator('.profile-menu summary').click();
    await page.getByRole('link', { name: 'Admin', exact: true }).click();
    await expect(page).toHaveURL(silverOrigin + '/admin/orders');
    const tabs = page.getByRole('navigation', {
      name: 'Business administration',
    });
    await expect(tabs.getByRole('link')).toHaveCount(9);
    await tabs.getByRole('link', { name: 'Farms', exact: true }).click();
    const forgedFarm = await customer.post('/admin/farms', {
      headers: { Origin: 'https://untrusted.example' },
      form: {
        intent: 'farm',
        name: 'Forged farm',
        location: 'Ojai',
        active: 'on',
      },
    });
    expect(forgedFarm.status()).toBe(403);
    await page.getByText('Add a farm', { exact: true }).click();
    const addFarm = page.getByRole('form', { name: 'Add farm', exact: true });
    await addFarm.getByLabel('Farm name', { exact: true }).fill('UI grower');
    await addFarm.getByLabel('Location', { exact: true }).fill('Ojai');
    await addFarm
      .getByRole('button', { name: 'Add farm', exact: true })
      .click();
    await expect(page.getByRole('status')).toHaveText('Changes saved.');
    await page.getByText('UI grower · Ojai', { exact: true }).click();
    const editFarm = page.getByRole('form', {
      name: 'Edit UI grower',
      exact: true,
    });
    await editFarm.getByLabel('Location', { exact: true }).fill('Ojai Valley');
    await editFarm
      .getByRole('button', { name: 'Save farm', exact: true })
      .click();
    await expect(
      page.getByText('UI grower · Ojai Valley', { exact: true }),
    ).toBeVisible();
    await tabs.getByRole('link', { name: 'Produce', exact: true }).click();
    await page.getByText('Add produce', { exact: true }).first().click();
    const addProduce = page.getByRole('form', {
      name: 'Add produce',
      exact: true,
    });
    await addProduce
      .getByLabel('Produce name', { exact: true })
      .fill('UI carrots');
    await addProduce
      .getByLabel('Farm', { exact: true })
      .selectOption({ label: 'UI grower' });
    await addProduce
      .getByRole('button', { name: 'Add produce', exact: true })
      .click();
    await expect(
      page.getByText('UI carrots · UI grower · Vegetables', { exact: true }),
    ).toBeVisible();
    await tabs.getByRole('link', { name: 'Markets', exact: true }).click();
    await page.getByText('Add a market', { exact: true }).click();
    const addMarket = page.getByRole('form', {
      name: 'Add market',
      exact: true,
    });
    await addMarket
      .getByLabel('Market name', { exact: true })
      .fill('Admin UI market');
    await addMarket
      .getByLabel('Market address', { exact: true })
      .fill('100 Main Street, Ojai, CA');
    await addMarket
      .getByRole('button', { name: 'Add market', exact: true })
      .click();
    await page.getByText('Add or update weekly hours', { exact: true }).click();
    const hours = page.getByRole('form', {
      name: 'Weekly market hours',
      exact: true,
    });
    await hours
      .getByLabel('Market', { exact: true })
      .selectOption({ label: 'Admin UI market' });
    await hours
      .getByRole('button', { name: 'Save weekly hours', exact: true })
      .click();
    await expect(page.getByRole('status')).toHaveText('Changes saved.');
    await tabs.getByRole('link', { name: 'Inventory', exact: true }).click();
    const runOption = await page
      .locator('select[name="run"] option')
      .filter({ hasText: 'Admin UI market' })
      .first()
      .getAttribute('value');
    await page
      .getByLabel('Market date', { exact: true })
      .selectOption(runOption!);
    await page
      .getByRole('button', { name: 'View inventory', exact: true })
      .click();
    await page.getByText('Add an item to this date', { exact: true }).click();
    const inventory = page.getByRole('form', {
      name: 'Add inventory',
      exact: true,
    });
    await inventory
      .getByLabel('Produce', { exact: true })
      .selectOption({ label: 'UI carrots · UI grower' });
    await inventory
      .getByLabel('Price per sale unit ($)', { exact: true })
      .fill('3.50');
    await inventory.getByLabel('Total quantity', { exact: true }).fill('10');
    await inventory
      .getByRole('button', { name: 'Add inventory', exact: true })
      .click();
    await expect(
      page.getByText('UI carrots · $3.50 / lb · 10 available', { exact: true }),
    ).toBeVisible();
    await db
      .insert(networkMemberships)
      .values({ networkId: partnerId, userId: owner.id })
      .onConflictDoNothing();
    await tabs.getByRole('link', { name: 'Users', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Users', exact: true }),
    ).toContainText(customerEmail);
    await expect(
      page.getByRole('region', { name: 'Users', exact: true }),
    ).not.toContainText(owner.email);
    await page.getByText('Create an invitation', { exact: true }).click();
    const inviteForm = page.getByRole('form', {
      name: 'Create invitation',
      exact: true,
    });
    await inviteForm
      .getByLabel('Email', { exact: true })
      .fill(`invited-${randomUUID()}@example.test`);
    await inviteForm
      .getByRole('button', { name: 'Create invitation', exact: true })
      .click();
    await expect(
      page.getByLabel('Invitation link', { exact: true }),
    ).toHaveValue(new RegExp(silverOrigin + '/account\\?invite='));
    await db.insert(driverProfiles).values({
      networkId: silverId,
      userId: person.id,
      phone: '8055550123',
      vehicle: 'Van',
    });
    await tabs.getByRole('link', { name: 'Drivers', exact: true }).click();
    await page
      .getByRole('button', { name: 'Approve MCP Operator', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Suspend MCP Operator', exact: true }),
    ).toBeVisible();
    await tabs.getByRole('link', { name: 'Jobs', exact: true }).click();
    await page
      .getByRole('button', { name: 'Run scheduling job', exact: true })
      .click();
    await expect(page.getByRole('status')).toHaveText('Changes saved.');
    const historyRows = page
      .getByRole('table', { name: 'Job runs', exact: true })
      .locator('tbody tr');
    const usefulCount = await historyRows.count();
    expect(usefulCount).toBeGreaterThan(0);
    await expect(
      page.getByRole('columnheader', {
        name: 'Impacted entities',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel('Include empty runs').check();
    await expect.poll(() => historyRows.count()).toBeGreaterThan(usefulCount);
    await expect(historyRows.first().locator('td').nth(2)).toHaveText('0');
    await page.getByLabel('Include empty runs').uncheck();
    await expect(historyRows).toHaveCount(usefulCount);
    await tabs.getByRole('link', { name: 'MCP setup', exact: true }).click();
    const providerChoice = page.getByLabel('How would you like to connect?');
    const surfaceChoice = page.locator('#setup-surface');
    const chatgptDesktop = page.getByRole('region', {
      name: 'ChatGPT desktop setup',
      exact: true,
    });
    const claudeDesktop = page.getByRole('region', {
      name: 'Claude desktop setup',
      exact: true,
    });
    await expect(providerChoice).toHaveValue('chatgpt');
    await expect(surfaceChoice).toHaveValue('desktop');
    await expect(chatgptDesktop).toBeVisible();
    await expect(chatgptDesktop.getByLabel('Connection address')).toHaveValue(
      silverOrigin + '/networks/silverstreak/mcp',
    );
    await expect(
      page.getByRole('button', { name: 'Copy Codex setup', exact: true }),
    ).toBeHidden();
    await providerChoice.selectOption('claude');
    await expect(claudeDesktop).toBeVisible();
    await expect(chatgptDesktop).toBeHidden();
    await expect(
      claudeDesktop.getByRole('button', { name: 'Copy address', exact: true }),
    ).toBeVisible();
    await surfaceChoice.selectOption('terminal');
    await expect(claudeDesktop).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Copy Claude Code setup', exact: true }),
    ).toBeVisible();
    await providerChoice.selectOption('chatgpt');
    await expect(
      page.getByRole('button', { name: 'Copy Codex setup', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Copy Claude Code setup', exact: true }),
    ).toBeHidden();
    await surfaceChoice.selectOption('desktop');
    await expect(chatgptDesktop).toBeVisible();
    await expect(page.locator('[data-setup-panel]:visible')).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Create token', exact: true }),
    ).toBeHidden();
    const forged = await customer.post('/mcp', {
      headers: { Origin: 'https://untrusted.example' },
      form: { intent: 'create', name: 'Forged token' },
    });
    expect(forged.status()).toBe(403);
    await providerChoice.selectOption('token');
    await expect(surfaceChoice).toHaveValue('chatgpt');
    await expect(
      page.getByRole('button', { name: 'Create token', exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-setup-panel]:visible')).toHaveCount(1);
    await page
      .getByLabel('Token name', { exact: true })
      .fill('Business automation');
    await page
      .getByRole('button', { name: 'Create token', exact: true })
      .click();
    await expect(page.getByLabel('New token', { exact: true })).toHaveValue(
      /^md_[a-f0-9]{64}$/,
    );
    await expect(providerChoice).toHaveValue('token');
    await surfaceChoice.selectOption('claude');
    await expect(
      page.getByRole('button', { name: 'Copy Claude Code setup', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Revoke Business automation', exact: true })
      .click();
    await expect(
      page.getByText('Business automation', { exact: false }),
    ).toContainText('Revoked');
    await providerChoice.selectOption('claude');
    await expect(surfaceChoice).toHaveValue('desktop');
    await expect(claudeDesktop).toBeVisible();
    await db
      .update(networkMemberships)
      .set({ role: 'member' })
      .where(
        and(
          eq(networkMemberships.networkId, silverId),
          eq(networkMemberships.userId, person.id),
        ),
      );
    expect((await customer.get('/mcp')).status()).toBe(403);
    await page.goto(silverOrigin + '/account');
    await page.locator('.profile-menu summary').click();
    await expect(
      page.getByRole('link', { name: 'Admin', exact: true }),
    ).toHaveCount(0);
  } finally {
    await customer.dispose();
    await business.dispose();
  }
});

test('business OAuth connects through sign-in and keeps grants, refresh, and revocation network scoped', async ({
  page,
}) => {
  const path = '/networks/silverstreak';
  const resource = silverOrigin + path + '/mcp';
  const oauth = silverOrigin + path + '/auth';
  const callback = silverOrigin + '/account';
  const client = await requests.newContext();
  const operator = await bootstrapGlobalAdmin(
    db,
    `oauth-${randomUUID()}@example.test`,
    password,
  );
  await db.delete(userRoles).where(eq(userRoles.userId, operator.id));
  await db.insert(networkMemberships).values({
    networkId: silverId,
    userId: operator.id,
    role: 'network_admin',
  });
  try {
    const challenge = await client.post(resource, { data: {} });
    expect(challenge.status()).toBe(401);
    const metadataUrl = challenge
      .headers()
      ['www-authenticate']!.match(/resource_metadata="([^"]+)"/)![1]!;
    const metadata = await client.get(metadataUrl);
    expect(metadata.status(), await metadata.text()).toBe(200);
    expect(await metadata.json()).toMatchObject({
      resource,
      authorization_servers: [oauth],
    });
    const discovery = await client.get(
      silverOrigin + '/.well-known/oauth-authorization-server' + path + '/auth',
    );
    expect(discovery.status(), await discovery.text()).toBe(200);
    const endpoints = await discovery.json();
    expect(endpoints.issuer).toBe(oauth);
    expect(endpoints.scopes_supported).toEqual([
      'mcp:business',
      'offline_access',
    ]);
    expect(endpoints.dpop_signing_alg_values_supported).toEqual([]);
    const dpopRegistration = await client.post(
      endpoints.registration_endpoint,
      {
        data: {
          client_name: 'Unsupported DPoP client',
          redirect_uris: [callback],
          token_endpoint_auth_method: 'none',
          dpop_bound_access_tokens: true,
        },
      },
    );
    expect(dpopRegistration.status()).toBe(400);
    const registration = await client.post(endpoints.registration_endpoint, {
      data: {
        client_name: 'Test assistant',
        redirect_uris: [callback],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'mcp:business offline_access',
      },
    });
    expect(registration.status(), await registration.text()).toBe(201);
    const { client_id: clientId, scope: clientScopes } =
      await registration.json();
    expect(clientScopes.split(' ')).toEqual(
      expect.arrayContaining([
        'mcp:business',
        'mcp:platform',
        'offline_access',
      ]),
    );
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callback,
      response_type: 'code',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      scope: 'mcp:business offline_access',
      resource,
      state: randomUUID(),
    });
    const foreignScope = new URLSearchParams(query);
    foreignScope.set('scope', 'mcp:platform offline_access');
    expect(
      (
        await client.get(endpoints.authorization_endpoint + '?' + foreignScope)
      ).status(),
    ).toBe(400);
    const dpopQuery = new URLSearchParams(query);
    dpopQuery.set('dpop_jkt', 'A'.repeat(43));
    const dpopAuthorization = await client.get(
      endpoints.authorization_endpoint + '?' + dpopQuery,
    );
    expect(dpopAuthorization.status()).toBe(400);
    expect(await dpopAuthorization.json()).toMatchObject({
      error: 'invalid_request',
    });
    await page.goto(endpoints.authorization_endpoint + '?' + query);
    await expect(page).toHaveURL(/\/account\?.*returnTo=/);
    await page.getByLabel('Email', { exact: true }).fill(operator.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Connect your assistant.' }),
    ).toBeVisible();
    await expect(
      page.getByText('Test assistant', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Allow access to Silverstreak' })
      .click();
    await expect(page).toHaveURL(
      (url) => url.pathname === '/account' && url.searchParams.has('code'),
    );
    const result = new URL(page.url());
    expect(result.searchParams.get('state')).toBe(query.get('state'));
    expect(result.searchParams.get('iss')).toBe(oauth);
    const code = result.searchParams.get('code')!;
    const exchange = {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: callback,
      code_verifier: verifier,
      resource,
    };
    const tokensResponse = await client.post(endpoints.token_endpoint, {
      form: exchange,
    });
    expect(tokensResponse.status(), await tokensResponse.text()).toBe(200);
    const tokens = await tokensResponse.json();
    expect(tokens.access_token).toMatch(/^md_oauth_/);
    expect(tokens.refresh_token).toMatch(/^md_refresh_/);
    const [stored] = await db
      .select({
        networkId: oauthAccessToken.referenceId,
        resources: oauthAccessToken.resources,
      })
      .from(oauthAccessToken)
      .where(
        eq(
          oauthAccessToken.token,
          createHash('sha256')
            .update(tokens.access_token.slice('md_oauth_'.length))
            .digest('hex'),
        ),
      );
    expect(stored).toEqual({ networkId: silverId, resources: [resource] });
    expect(
      (
        await client.post(silverOrigin + '/networks/partner/mcp', { data: {} })
      ).status(),
    ).toBe(403);
    expect(
      (
        await client.get(
          silverOrigin +
            '/.well-known/oauth-protected-resource/networks/partner/mcp',
        )
      ).status(),
    ).toBe(403);

    const call = (url: string, token = tokens.access_token) =>
      client.post(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json, text/event-stream',
        },
        data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      });
    expect((await call(resource)).status()).toBe(200);
    expect(
      (await call(businessOrigin + '/networks/partner/mcp')).status(),
    ).toBe(401);
    expect((await call(businessOrigin + '/mcp')).status()).toBe(401);
    expect((await call(businessOrigin + '/admin/mcp')).status()).toBe(401);
    const foreignRefresh = await client.post(
      businessOrigin + '/networks/partner/auth/oauth2/token',
      {
        form: {
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: tokens.refresh_token,
        },
      },
    );
    expect(foreignRefresh.status()).toBe(400);
    const dpopRefresh = await client.post(endpoints.token_endpoint, {
      headers: { DPoP: 'unsupported-proof' },
      form: {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: tokens.refresh_token,
        resource,
      },
    });
    expect(dpopRefresh.status()).toBe(400);
    expect(await dpopRefresh.json()).toMatchObject({
      error: 'invalid_request',
    });
    const refresh = await client.post(endpoints.token_endpoint, {
      form: {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: tokens.refresh_token,
        resource,
      },
    });
    expect(refresh.status(), await refresh.text()).toBe(200);
    let renewed = await refresh.json();
    expect((await call(resource, renewed.access_token)).status()).toBe(200);
    const widened = await client.post(endpoints.token_endpoint, {
      form: {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: renewed.refresh_token,
        resource: 'http://localhost:4333/networks/partner/mcp',
      },
    });
    expect(widened.status()).toBe(400);
    // A replay must revoke this client's replacement tokens, while preserving
    // tokens belonging to the same user/client on another authorization surface.
    const [refreshRow] = await db
      .select()
      .from(oauthRefreshToken)
      .where(
        eq(
          oauthRefreshToken.token,
          createHash('sha256')
            .update(renewed.refresh_token.slice('md_refresh_'.length))
            .digest('hex'),
        ),
      );
    const foreignId = randomUUID();
    await db.insert(oauthRefreshToken).values({
      ...refreshRow!,
      id: foreignId,
      token: randomUUID(),
      referenceId: partnerId,
      resources: ['http://localhost:4333/networks/partner/mcp'],
    });
    const [accessRow] = await db
      .select()
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.refreshId, refreshRow!.id));
    const foreignAccessId = randomUUID();
    await db.insert(oauthAccessToken).values({
      ...accessRow!,
      id: foreignAccessId,
      token: randomUUID(),
      referenceId: partnerId,
      refreshId: foreignId,
      resources: ['http://localhost:4333/networks/partner/mcp'],
    });
    const replayForm = {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: tokens.refresh_token,
      resource,
    };
    // An unauthenticated client cannot trigger family revocation.
    expect(
      (
        await client.post(endpoints.token_endpoint, {
          form: { ...replayForm, client_id: randomUUID() },
        })
      ).status(),
    ).toBe(400);
    expect((await call(resource, renewed.access_token)).status()).toBe(200);
    expect(
      (
        await client.post(endpoints.token_endpoint, { form: replayForm })
      ).status(),
    ).toBe(400);
    expect((await call(resource, renewed.access_token)).status()).toBe(401);
    expect(
      (
        await client.post(endpoints.token_endpoint, {
          form: { ...replayForm, refresh_token: renewed.refresh_token },
        })
      ).status(),
    ).toBe(400);
    expect(
      await db
        .select({ revoked: oauthRefreshToken.revoked })
        .from(oauthRefreshToken)
        .where(eq(oauthRefreshToken.id, foreignId)),
    ).toEqual([{ revoked: null }]);
    expect(
      await db
        .select({ revoked: oauthAccessToken.revoked })
        .from(oauthAccessToken)
        .where(eq(oauthAccessToken.id, foreignAccessId)),
    ).toEqual([{ revoked: null }]);
    await db
      .delete(oauthAccessToken)
      .where(eq(oauthAccessToken.id, foreignAccessId));
    await db
      .delete(oauthRefreshToken)
      .where(eq(oauthRefreshToken.id, foreignId));

    // Reconnect so permission changes and explicit disconnection still exercise
    // a live token family below.
    query.set('prompt', 'consent');
    await page.goto(endpoints.authorization_endpoint + '?' + query);
    await page
      .getByRole('button', { name: 'Allow access to Silverstreak' })
      .click();
    await expect(page).toHaveURL(
      (url) => url.pathname === '/account' && url.searchParams.has('code'),
    );
    const reconnected = await client.post(endpoints.token_endpoint, {
      form: {
        ...exchange,
        code: new URL(page.url()).searchParams.get('code')!,
      },
    });
    expect(reconnected.status(), await reconnected.text()).toBe(200);
    renewed = await reconnected.json();
    expect((await call(resource, renewed.access_token)).status()).toBe(200);
    await db
      .update(networkMemberships)
      .set({ role: 'member' })
      .where(
        and(
          eq(networkMemberships.networkId, silverId),
          eq(networkMemberships.userId, operator.id),
        ),
      );
    expect((await call(resource, renewed.access_token)).status()).toBe(401);
    await db
      .update(networkMemberships)
      .set({ role: 'network_admin' })
      .where(
        and(
          eq(networkMemberships.networkId, silverId),
          eq(networkMemberships.userId, operator.id),
        ),
      );
    // An additional consent prompt can be declined without issuing a code.
    query.set('prompt', 'consent');
    await page.goto(endpoints.authorization_endpoint + '?' + query);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(/error=access_denied/);
    await page.goto(silverOrigin + '/mcp');
    await page.getByText('Connected assistants (1)', { exact: true }).click();
    await page
      .getByRole('button', { name: 'Disconnect Test assistant', exact: true })
      .click();
    await expect(page.getByRole('status')).toHaveText(
      'Assistant disconnected. Its access has been revoked.',
    );
    expect((await call(resource, renewed.access_token)).status()).toBe(401);
    expect(
      (
        await client.post(endpoints.token_endpoint, {
          form: {
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: renewed.refresh_token,
            resource,
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await client.post(endpoints.token_endpoint, { form: exchange })
      ).status(),
    ).toBe(400);
    // A new code requires the matching PKCE secret, including after reconnecting.
    await page.goto(endpoints.authorization_endpoint + '?' + query);
    await page
      .getByRole('button', { name: 'Allow access to Silverstreak' })
      .click();
    await expect(page).toHaveURL(
      (url) => url.pathname === '/account' && url.searchParams.has('code'),
    );
    const anotherCode = new URL(page.url()).searchParams.get('code')!;
    const wrongVerifier = await client.post(endpoints.token_endpoint, {
      form: {
        ...exchange,
        code: anotherCode,
        code_verifier: randomBytes(32).toString('base64url'),
      },
    });
    expect(wrongVerifier.status()).toBe(400);
  } finally {
    await client.dispose();
  }
});

test('shared MCP setup catalog offers OAuth providers and token assistant choices', () => {
  const server = {
    serverName: 'test-server',
    displayName: 'Test Server',
    serverUrl: 'https://example.test/mcp',
  };
  expect(listProviders().map((provider) => provider.id)).toEqual([
    'chatgpt',
    'claude',
    'token',
  ]);
  expect(listInterfaces('token').map((item) => item.id)).toEqual([
    'chatgpt',
    'claude',
  ]);
  for (const provider of ['chatgpt', 'claude'] as const) {
    expect(listInterfaces(provider).map((item) => item.id)).toEqual([
      'desktop',
      'terminal',
    ]);
    const desktop = getSetupInstructions({
      ...server,
      provider,
      interface: 'desktop',
    });
    expect(desktop.auth).toBe('oauth');
    if (provider === 'claude') {
      const terminal = getSetupInstructions({
        ...server,
        provider,
        interface: 'terminal',
      });
      expect(JSON.stringify(terminal.blocks)).not.toContain('claude mcp login');
      expect(terminal.blocks).toContainEqual({
        type: 'paragraph',
        text: 'Start Claude Code, run /mcp, select test-server, and choose Authenticate. Sign in to Test Server and choose “Allow access to Test Server”.',
      });
    }
    expect(desktop.blocks.filter((block) => block.type === 'copy')).toEqual([
      {
        type: 'copy',
        label: 'Connection address',
        copyLabel: 'Copy address',
        value: server.serverUrl,
        kind: 'address',
      },
    ]);
    const token = getSetupInstructions({
      ...server,
      provider: 'token',
      interface: provider,
      tokenFile: '.config/test.headers',
    });
    expect(token.auth).toBe('token');
    const commands = token.blocks
      .filter((block) => block.type === 'copy')
      .map((block) => block.value)
      .join('\n');
    expect(commands).toContain('--header-file "$HOME/.config/test.headers"');
    expect(commands).toContain(
      provider === 'chatgpt' ? 'codex mcp add' : 'claude mcp add',
    );
    expect(commands).not.toContain('mcp login');
  }
  expect(() =>
    getSetupInstructions({
      ...server,
      provider: 'token',
      interface: 'desktop',
      tokenFile: '.config/test.headers',
    } as unknown as Parameters<typeof getSetupInstructions>[0]),
  ).toThrow('Unsupported MCP setup');
  for (const tokenFile of ['../outside', '/absolute', '.config/$(whoami)']) {
    expect(() =>
      getTokenSaveCommand({ token: 'example-token', tokenFile }),
    ).toThrow('relative path');
  }
  expect(() =>
    getTokenSaveCommand({
      token: 'first\nsecond',
      tokenFile: '.config/test.headers',
    }),
  ).toThrow('single-line token');
});

test('global administrator OAuth signs in, scopes platform access, refreshes, and disconnects', async ({
  page,
}) => {
  const resource = adminOrigin + '/admin/mcp';
  const issuer = adminOrigin + '/admin/auth';
  const client = await requests.newContext();
  const operator = await bootstrapGlobalAdmin(
    db,
    `global-oauth-${randomUUID()}@example.test`,
    password,
  );
  try {
    const unauthenticated = await client.post(resource, { data: {} });
    expect(unauthenticated.status()).toBe(401);
    const metadataUrl = unauthenticated
      .headers()
      ['www-authenticate']!.match(/resource_metadata="([^"]+)"/)![1]!;
    expect(await (await client.get(metadataUrl)).json()).toMatchObject({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ['mcp:platform'],
    });
    const discovery = await client.get(
      adminOrigin + '/.well-known/oauth-authorization-server/admin/auth',
    );
    expect(discovery.status(), await discovery.text()).toBe(200);
    const endpoints = await discovery.json();
    expect(endpoints.issuer).toBe(issuer);
    expect(endpoints.scopes_supported).toEqual([
      'mcp:platform',
      'offline_access',
    ]);
    expect(endpoints.dpop_signing_alg_values_supported).toEqual([]);
    const callback = adminOrigin + '/';
    const registration = await client.post(endpoints.registration_endpoint, {
      data: {
        client_name: 'Platform assistant',
        redirect_uris: [callback],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'mcp:platform offline_access',
      },
    });
    expect(registration.status(), await registration.text()).toBe(201);
    const { client_id: clientId, scope: clientScopes } =
      await registration.json();
    expect(clientScopes.split(' ')).toEqual(
      expect.arrayContaining([
        'mcp:business',
        'mcp:platform',
        'offline_access',
      ]),
    );
    const verifier = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callback,
      response_type: 'code',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      scope: 'mcp:platform offline_access',
      resource,
      state: randomUUID(),
    });
    const foreignScope = new URLSearchParams(params);
    foreignScope.set('scope', 'mcp:business offline_access');
    expect(
      (
        await client.get(endpoints.authorization_endpoint + '?' + foreignScope)
      ).status(),
    ).toBe(400);
    await page.goto(endpoints.authorization_endpoint + '?' + params);
    await expect(
      page.getByRole('heading', { name: 'Administrator sign in' }),
    ).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(operator.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByText('Platform assistant', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Allow global administrator access' })
      .click();
    await expect(page).toHaveURL(
      (url) => url.pathname === '/' && url.searchParams.has('code'),
    );
    const result = new URL(page.url());
    expect(result.searchParams.get('iss')).toBe(issuer);
    expect(result.searchParams.get('state')).toBe(params.get('state'));
    const exchange = {
      grant_type: 'authorization_code',
      code: result.searchParams.get('code')!,
      client_id: clientId,
      redirect_uri: callback,
      code_verifier: verifier,
      resource,
    };
    const response = await client.post(endpoints.token_endpoint, {
      form: exchange,
    });
    expect(response.status(), await response.text()).toBe(200);
    const tokens = await response.json();
    const call = (url: string, token = tokens.access_token) =>
      client.post(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json, text/event-stream',
        },
        data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      });
    const tools = await call(resource);
    expect(tools.status(), await tools.text()).toBe(200);
    expect(await tools.text()).toContain('list_networks');
    expect(
      (await call(silverOrigin + '/networks/silverstreak/mcp')).status(),
    ).toBe(401);
    const [stored] = await db
      .select()
      .from(oauthAccessToken)
      .where(
        eq(
          oauthAccessToken.token,
          createHash('sha256')
            .update(tokens.access_token.slice('md_oauth_'.length))
            .digest('hex'),
        ),
      );
    expect(stored?.referenceId).toBe('platform');
    expect(stored?.resources).toEqual([resource]);
    const refreshForm = {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: tokens.refresh_token,
      resource,
    };
    expect(
      (
        await client.post(
          silverOrigin + '/networks/silverstreak/auth/oauth2/token',
          { form: refreshForm },
        )
      ).status(),
    ).toBe(400);
    const refresh = await client.post(endpoints.token_endpoint, {
      form: refreshForm,
    });
    expect(refresh.status(), await refresh.text()).toBe(200);
    const renewed = await refresh.json();
    expect((await call(resource, renewed.access_token)).status()).toBe(200);
    await db.delete(userRoles).where(eq(userRoles.userId, operator.id));
    expect((await call(resource, renewed.access_token)).status()).toBe(401);
    expect(
      (
        await client.post(endpoints.token_endpoint, {
          form: { ...refreshForm, refresh_token: renewed.refresh_token },
        })
      ).ok(),
    ).toBe(false);
    await db
      .insert(userRoles)
      .values({ userId: operator.id, role: 'global_admin' });
    expect((await call(resource, renewed.access_token)).status()).toBe(200);
    await page.goto('/');
    await page.getByText('Connected assistants (1)', { exact: true }).click();
    await page
      .getByRole('button', {
        name: 'Disconnect Platform assistant',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Assistant disconnected.' }),
    ).toHaveText('Assistant disconnected. Its access has been revoked.');
    expect((await call(resource, renewed.access_token)).status()).toBe(401);
    expect(
      (
        await client.post(endpoints.token_endpoint, {
          form: { ...refreshForm, refresh_token: renewed.refresh_token },
        })
      ).status(),
    ).toBe(400);
    params.set('prompt', 'consent');
    await page.goto(endpoints.authorization_endpoint + '?' + params);
    await page
      .getByRole('button', { name: 'Allow global administrator access' })
      .click();
    await expect(page).toHaveURL(
      (url) => url.pathname === '/' && url.searchParams.has('code'),
    );
    expect(
      (
        await client.post(endpoints.token_endpoint, {
          form: {
            ...exchange,
            code: new URL(page.url()).searchParams.get('code')!,
            code_verifier: randomBytes(32).toString('base64url'),
          },
        })
      ).status(),
    ).toBe(400);
  } finally {
    await client.dispose();
  }
});
