import { createRequire } from 'node:module';
import { registerMcp } from '../../apps/api/src/mcp.js';
import {
  addressInput,
  geocodeAddress,
  suggestAddresses,
  resolveAddress,
} from '../../apps/api/src/addresses.js';
import {
  test,
  expect,
  request as requestFactory,
  type APIRequestContext,
  type Browser,
  type Page,
} from '@playwright/test';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import type { AppRouter } from '../../apps/api/src/router.js';
import {
  createDatabase,
  customerProfiles,
  driverProfiles,
  invitations,
  networkMemberships,
  networks,
  farms,
  produce,
  OJAI_NETWORK_ID,
  withNetwork,
  userRoles,
  user,
  marketRuns,
  orders,
  inventory,
  orderItems,
  apiTokens,
  verification,
  marketSchedules,
  runMarketRunsJob,
  backgroundJobRuns,
  MARKET_RUNS_JOB,
  markets,
} from '../../packages/db/src/index.js';
import { and, eq, like, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createAuth } from '../../apps/api/src/auth.js';
import { parseEnvironment } from '../../apps/api/src/config.js';
import { checkRateLimit } from '../../apps/api/src/rate-limit.js';
import { rateLimit } from '../../packages/db/src/index.js';
const baseURL = 'http://localhost:5180';
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
function api(request: APIRequestContext, network?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseURL + '/trpc',
        headers: network ? { 'x-network-id': network } : undefined,
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
          eq(networkMemberships.networkId, OJAI_NETWORK_ID),
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
async function signupUi(
  page: Page,
  email: string,
  token: string,
  name: string,
) {
  await page.goto(`/?invite=${token}`);
  await page.getByLabel('Full name', { exact: true }).fill(name);
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email);
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
    'readonly',
    '',
  );
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your profile', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\?page=profile$/);
}
async function profileUi(page: Page) {
  await page.getByLabel('Phone', { exact: true }).fill('7075550123');
  await page
    .getByLabel('Street address', { exact: true })
    .fill('25 Main Street');
  await page.getByLabel('City', { exact: true }).fill('Ojai');
  await page.getByLabel('ZIP code', { exact: true }).fill('93023');
  await page
    .getByLabel('Delivery instructions', { exact: true })
    .fill('Ring the bell');
  await page
    .getByRole('button', { name: 'Save delivery profile', exact: true })
    .click();
  await expect(
    page.getByText('Delivery profile saved', { exact: true }),
  ).toBeVisible();
}
async function browserActor(
  browser: Browser,
  role: 'customer' | 'driver',
  name: string,
) {
  const email = `${unique(role)}@example.test`,
    inv = await invite(email, role),
    context = await browser.newContext({
      baseURL,
      timezoneId: 'America/Los_Angeles',
    }),
    page = await context.newPage();
  await signupUi(page, email, inv.token, name);
  if (role === 'customer') await profileUi(page);
  if (role === 'driver') {
    await expect(
      page.getByLabel('Street address', { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel('Phone', { exact: true }).fill('8055550123');
    await page
      .getByLabel('Vehicle', { exact: true })
      .fill('Small delivery van');
    await page
      .getByRole('button', { name: 'Save driver details', exact: true })
      .click();
    await expect(
      page.getByText('Driver details saved', { exact: true }),
    ).toBeVisible();
    const driver = await api(context.request).me.query();
    expect(driver!.driver!.phone).toBe('8055550123');
    expect(driver!.customer!.street).toBe('');
  }
  return { context, page, email, rpc: api(context.request) };
}
test('invite-only signup, profiles, sign-out, sign-in, and session isolation', async ({
  page,
}) => {
  const open = await page.request.post('/api/auth/sign-up/email', {
    data: {
      name: 'No Invite',
      email: `${unique('uninvited')}@example.test`,
      password,
    },
  });
  expect(open.status()).toBe(403);
  const email = `${unique('neighbor')}@example.test`,
    inv = await invite(email);
  const mismatch = await page.request.post('/api/auth/sign-up/email', {
    headers: { 'x-invite-token': inv.token },
    data: {
      name: 'Wrong Email',
      email: `${unique('wrong')}@example.test`,
      password,
    },
  });
  expect(mismatch.status()).toBe(403);
  await signupUi(page, email, inv.token, 'Test Neighbor');
  await profileUi(page);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your profile', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await expect(page).toHaveURL(/\?page=orders$/);
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Your profile', exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole('button', { name: 'Orders', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByLabel('Street address', { exact: true })).toHaveValue(
    '25 Main Street',
  );
  await expect(page.getByLabel('Vehicle', { exact: true })).toHaveCount(0);
  await rejectCode(
    api(page.request).profile.saveDriver.mutate({
      phone: '8055550101',
      vehicle: 'Delivery van',
    }),
    'FORBIDDEN',
  );
  expect((await api(page.request).me.query())!.driver).toBeNull();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  expect(await api(page.request).me.query()).toBeNull();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
  await page
    .getByRole('button', { name: 'Sign in', exact: true })
    .last()
    .click();
  await expect(page.getByRole('alert')).toContainText(/invalid|incorrect/i);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Sign in', exact: true })
    .last()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your profile', exact: true }),
  ).toBeVisible();
  const other = await actor();
  expect(await other.rpc.orders.mine.query()).toEqual([]);
  await other.request.dispose();
});
test('sign-out refreshes the home page and reports failures without losing the session', async ({
  page,
}) => {
  const email = `${unique('signout')}@example.test`;
  const invitation = await invite(email);
  await signupUi(page, email, invitation.token, 'Signout Neighbor');
  await page.goto('/');
  await page.route('**/api/auth/sign-out', (route) =>
    route.fulfill({ status: 500, json: { message: 'Unable to sign out' } }),
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to sign out');
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeEnabled();
  expect((await api(page.request).me.query())?.email).toBe(email);
  await page.unroute('**/api/auth/sign-out');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toHaveCount(0);
  expect(await api(page.request).me.query()).toBeNull();
});

test('signed-in invitation links offer a safe account switch and preserve the invitation', async ({
  page,
}) => {
  const email = `${unique('existing-invite')}@example.test`;
  const used = await invite(email);
  await signupUi(page, email, used.token, 'Existing Neighbor');
  // Reopening a consumed link should still let the current user continue.
  await page.goto(`/?invite=${used.token}`);
  await expect(page.getByText(`You’re signed in as ${email}.`)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create account', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue to your profile' }).click();
  await expect(page).toHaveURL(/\?page=profile$/);

  const nextEmail = `${unique('switch-invite')}@example.test`;
  const next = await invite(nextEmail);
  await page.goto(`/?invite=${next.token}&source=email#content`);
  await page
    .getByRole('button', { name: 'Sign out to use invitation', exact: true })
    .click();
  await expect(page).toHaveURL(`/?invite=${next.token}&source=email#content`);
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
    nextEmail,
  );
  expect(await api(page.request).me.query()).toBeNull();
  await page.getByLabel('Full name', { exact: true }).fill('Next Neighbor');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your profile', exact: true }),
  ).toBeVisible();
  expect((await api(page.request).me.query())?.email).toBe(nextEmail);

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto(`/?invite=${next.token}`);
  await expect(
    page.getByRole('alert').filter({ hasText: 'invalid or expired' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create account', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Back to sign in', exact: true })
    .click();
  await page.getByLabel('Email', { exact: true }).fill(nextEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your profile', exact: true }),
  ).toBeVisible();
});

test('accepted invitation URL clears without prompting for verification', async ({
  page,
}) => {
  const email = `${unique('verify-invite')}@example.test`;
  const invitation = await invite(email);
  // A successful signup without a session falls back to sign-in.
  await page.route('**/api/auth/sign-up/email', (route) =>
    route.fulfill({ json: { token: null, user: { email } } }),
  );
  await page.goto(`/?invite=${invitation.token}&source=email#content`);
  await page.getByLabel('Full name', { exact: true }).fill('New Neighbor');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page).toHaveURL(/\?source=email#content$/);
  await expect(
    page.getByRole('heading', { name: 'Welcome back' }),
  ).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email);
  await expect(
    page.getByRole('button', { name: 'Resend verification email' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Use invitation' }),
  ).toHaveCount(0);
});
test('email link errors and resets without a session recover to sign-in', async ({
  page,
}) => {
  await page.goto('/?reset=1&error=INVALID_TOKEN');
  await expect(
    page.getByRole('alert').filter({ hasText: 'invalid or expired' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Forgot password?', exact: true })
    .click();
  await expect(page).toHaveURL(baseURL + '/');
  await expect(
    page.getByRole('heading', { name: 'Reset your password', exact: true }),
  ).toBeVisible();

  // An unverified account can reset its password without receiving a session.
  await page.route('**/api/auth/reset-password', (route) =>
    route.fulfill({ json: { status: true } }),
  );
  await page.goto('/?reset=1&token=unverified-reset-token&source=email');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Reset password', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL('/?source=email');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByRole('status')).toContainText('Password reset.');
});

test('admin UI creates market, schedule, catalog, inventory, invitations, and MCP tokens', async ({
  browser,
}) => {
  const admin = await browserActor(browser, 'customer', 'Operations User');
  const current = await admin.rpc.me.query();
  await db
    .update(networkMemberships)
    .set({ role: 'network_admin' })
    .where(
      and(
        eq(networkMemberships.userId, current!.id),
        eq(networkMemberships.networkId, OJAI_NETWORK_ID),
      ),
    );
  await admin.page.reload();
  const page = admin.page;
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  const name = unique('UI market');
  await page.getByLabel('Market name', { exact: true }).fill(name);
  await page
    .getByLabel('Market address', { exact: true })
    .fill('45 Market Plaza, Sonoma');
  await page
    .getByRole('button', { name: 'Create market', exact: true })
    .click();
  await expect(page.getByText('Market created', { exact: true })).toBeVisible();
  await page
    .getByLabel('Market', { exact: true })
    .selectOption({ label: name });
  const date = (hours: number) => {
    const d = new Date(Date.now() + hours * 3600000);
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(d)
      .replace(' ', 'T');
  };
  for (const [label, hours] of [
    ['Order cutoff', 2],
    ['Market opens', 24],
    ['Market closes', 28],
    ['Delivery starts', 27],
    ['Delivery ends', 28],
  ] as const)
    await page.getByLabel(label, { exact: true }).fill(date(hours));
  await page.getByLabel('Delivery fee ($)', { exact: true }).fill('5');
  await page
    .getByRole('button', { name: 'Schedule market day', exact: true })
    .click();
  await expect(
    page.getByText('Market day scheduled', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Farms', exact: true }).click();
  await page.getByLabel('Farm name', { exact: true }).fill('Neighborhood farm');
  await page.getByLabel('Farm location', { exact: true }).fill('Sonoma');
  await page.getByRole('button', { name: 'Save farm', exact: true }).click();
  await expect(page.getByText('Farm saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  const produceName = unique('UI tomatoes');
  await page.getByLabel('Produce name', { exact: true }).fill(produceName);
  await page.getByLabel('Description', { exact: true }).fill('Sweet tomatoes');
  await page
    .getByLabel('Catalog farm', { exact: true })
    .selectOption({ label: 'Neighborhood farm' });
  await page.getByRole('button', { name: 'Save produce', exact: true }).click();
  await expect(page.getByText('Catalog saved', { exact: true })).toBeVisible();
  const option = page
    .getByLabel('Inventory market run')
    .locator('option')
    .filter({ hasText: name });
  await page
    .getByLabel('Inventory market run')
    .selectOption((await option.getAttribute('value')) ?? '');
  await page
    .getByLabel('Produce', { exact: true })
    .selectOption({ label: `${produceName} / lb` });
  await page.getByLabel('Offered quantity', { exact: true }).fill('20');
  await page.getByLabel('Unit price ($)', { exact: true }).fill('4.50');
  await page
    .getByRole('button', { name: 'Save inventory', exact: true })
    .click();
  await expect(
    page.getByText('Inventory saved', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await expect(page).toHaveURL(/\?page=operations&tab=people$/);
  await page.reload();
  await expect(
    page.getByLabel('Invitation email', { exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('Produce name', { exact: true })).toBeVisible();
  await page.goForward();
  await page
    .getByLabel('Invitation email', { exact: true })
    .fill(`${unique('driver-invite')}@example.test`);
  await page.getByLabel('Profile', { exact: true }).selectOption('driver');
  await page
    .getByRole('button', { name: 'Create invitation', exact: true })
    .click();
  await expect(page.getByLabel('Invitation link', { exact: true })).toHaveValue(
    /invite=/,
  );
  await page
    .getByRole('button', { name: 'Revoke invitation', exact: true })
    .first()
    .click();
  await expect(
    page.getByText('Invitation revoked', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'MCP access', exact: true }).click();
  await page.getByLabel('Token name', { exact: true }).fill('UI operations');
  await page
    .getByRole('button', { name: 'Create MCP token', exact: true })
    .click();
  await expect(page.getByLabel('New MCP token', { exact: true })).toHaveValue(
    /^md_/,
  );
  await page.getByRole('button', { name: 'Revoke token', exact: true }).click();
  await expect(page.getByText('Token revoked', { exact: true })).toBeVisible();
  await admin.context.close();
});
test('customer checkout and per-order driver shopping, shortages, cash and delivery retry in browsers', async ({
  browser,
}) => {
  const { run, produce } = await setup(10);
  const customer = await browserActor(browser, 'customer', 'Order Customer');
  const driver = await browserActor(browser, 'driver', 'Order Driver');
  await customer.page
    .getByRole('button', { name: 'Market', exact: true })
    .click();
  await customer.page.getByLabel('Market day', { exact: true }).click();
  await customer.page
    .locator(`input[name="market-day"][value="${run.id}"]`)
    .check();
  await customer.page
    .getByLabel(`Quantity for ${produce.name}`, { exact: true })
    .fill('3');
  await customer.page
    .getByRole('button', { name: 'Place order', exact: true })
    .click();
  await expect(
    customer.page.getByRole('heading', { name: 'Your orders', exact: true }),
  ).toBeVisible();
  const order = (await customer.rpc.orders.mine.query())[0]!;
  await expect(
    customer.page.getByRole('heading', {
      name: `Order ${order.id.slice(0, 8)}`,
      exact: true,
    }),
  ).toBeVisible();
  await driver.page
    .getByRole('button', { name: 'Driver', exact: true })
    .click();
  const card = driver.page
    .locator('.run-card')
    .filter({ hasText: `Order ${order.id.slice(0, 8)}` });
  await card.getByRole('button', { name: 'Claim order', exact: true }).click();
  await expect(
    driver.page.getByRole('button', { name: 'Start shopping', exact: true }),
  ).toBeDisabled();
  await closeCutoff(run.id);
  await driver.page.reload();
  await driver.page
    .getByRole('button', { name: 'Driver', exact: true })
    .click();
  await driver.page
    .getByRole('button', { name: 'My orders', exact: true })
    .click();
  await driver.page
    .locator('.run-card')
    .filter({ hasText: order.id.slice(0, 8) })
    .getByRole('button', { name: 'Open order', exact: true })
    .click();
  await driver.page
    .getByRole('button', { name: 'Start shopping', exact: true })
    .click();
  await driver.page
    .getByRole('button', { name: 'Finish shopping', exact: true })
    .click();
  await expect(
    driver.page
      .getByRole('alert')
      .filter({ hasText: 'Record every shopping item' }),
  ).toBeVisible();
  await driver.page
    .getByLabel(`Purchased quantity for ${produce.name}`, { exact: true })
    .fill('2');
  await driver.page
    .getByLabel(`Total cost for ${produce.name}`, { exact: true })
    .fill('4.01');
  await driver.page
    .getByRole('button', { name: 'Record purchase', exact: true })
    .click();
  await expect(
    driver.page.getByText('Purchase recorded', { exact: true }),
  ).toBeVisible();
  await driver.page
    .getByRole('button', { name: 'Finish shopping', exact: true })
    .click();
  await expect(
    driver.page.getByText('Shopping complete; order is ready', { exact: true }),
  ).toBeVisible();
  const detail = await driver.rpc.driver.detail.query({ id: order.id });
  expect(detail.items[0]).toMatchObject({
    fulfilledQuantity: 2,
    actualCostCents: 401,
  });
  expect(detail.actualTotalCents).toBe(1200);
  await driver.page
    .getByLabel('Cash collected ($)', { exact: true })
    .fill('12');
  await driver.page
    .getByRole('button', { name: 'Save cash record', exact: true })
    .click();
  await expect(
    driver.page.getByText('Cash record saved', { exact: true }),
  ).toBeVisible();
  await driver.page
    .getByRole('button', { name: 'Start delivery', exact: true })
    .click();
  await driver.page
    .getByLabel('Delivery note', { exact: true })
    .fill('No answer');
  await driver.page
    .getByRole('button', { name: 'Report failed delivery', exact: true })
    .click();
  await driver.page
    .getByRole('button', { name: 'Retry delivery', exact: true })
    .click();
  await driver.page
    .getByRole('button', { name: 'Mark delivered', exact: true })
    .click();
  await expect(
    driver.page.getByText('Delivery complete. Thank you!', { exact: true }),
  ).toBeVisible();
  expect((await customer.rpc.orders.mine.query())[0]).toMatchObject({
    status: 'delivered',
    cashCollectedCents: 1200,
    actualTotalCents: 1200,
  });
  await customer.context.close();
  await driver.context.close();
});
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
  expect((await customer.rpc.orders.mine.query())[0]!.status).toBe('cancelled');
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
  const { token } = await admin.rpc.admin.createToken.mutate({
    name: 'Invite users',
  });
  const config = {
    secret: randomBytes(32).toString('hex'),
    baseURL,
    webOrigin: baseURL,
    resendKey: 'local-stub-only',
    emailFrom: 'accounts@example.test',
  };
  const server = Fastify();
  registerMcp(server, db, baseURL, config);
  const unconfigured = Fastify();
  registerMcp(unconfigured, db, baseURL);
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
        params: { name: 'invite_user', arguments: arguments_ },
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
  const { token } = await admin.rpc.admin.createToken.mutate({
    name: 'E2E MCP',
  });
  const unauth = await fetch('http://127.0.0.1:3101/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(unauth.status).toBe(401);
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3101/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const tools = await client.listTools();
  expect(tools.tools.map((t) => t.name)).toContain('schedule_run');
  const marketResult = await client.callTool({
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
  const runResult = await client.callTool({
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
  const stock = await client.callTool({
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
    const response = await client.callTool({ name, arguments: args });
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
  const unitChange = await client.callTool({
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
      await client.callTool({
        name: 'get_order',
        arguments: { id: randomUUID() },
      })
    ).isError,
  ).toBe(true);
  expect(
    (
      await client.callTool({
        name: 'list_orders',
        arguments: {
          from: new Date(now + 86400000).toISOString(),
          to: new Date(now).toISOString(),
        },
      })
    ).isError,
  ).toBe(true);
  expect(await customer.rpc.orders.mine.query()).toEqual(beforeReads);
  const rejectedCancel = await client.callTool({
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

  const bookedEdit = await client.callTool({
    name: 'update_run',
    arguments: { id: run.id, ...runFields, deliveryFeeCents: 0 },
  });
  expect(bookedEdit.isError).toBe(true);
  const reduceStock = await client.callTool({
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
      await client.callTool({
        name: 'get_market',
        arguments: { id: randomUUID() },
      })
    ).isError,
  ).toBe(true);
  expect(
    (
      await client.callTool({
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
  const invalid = await client.callTool({
    name: 'schedule_run',
    arguments: { marketId: market.id, cutoffAt: 'invalid' },
  });
  expect(invalid.isError).toBe(true);
  await client.close();
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(
      eq(apiTokens.tokenHash, createHash('sha256').update(token).digest('hex')),
    );
  expect(row!.tokenHash).not.toBe(token);
  await admin.rpc.admin.revokeToken.mutate({ id: row!.id });
  const revoked = await fetch('http://127.0.0.1:3101/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  expect(revoked.status).toBe(401);
  const expired = await admin.rpc.admin.createToken.mutate({ name: 'Expired' });
  await db
    .update(apiTokens)
    .set({ expiresAt: new Date(0) })
    .where(
      eq(
        apiTokens.tokenHash,
        createHash('sha256').update(expired.token).digest('hex'),
      ),
    );
  expect(
    (
      await fetch('http://127.0.0.1:3101/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${expired.token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
    ).status,
  ).toBe(401);
  const demoted = await admin.rpc.admin.createToken.mutate({ name: 'Demoted' });
  await db
    .update(networkMemberships)
    .set({ role: 'member' })
    .where(
      and(
        eq(networkMemberships.userId, admin.id),
        eq(networkMemberships.networkId, OJAI_NETWORK_ID),
      ),
    );
  expect(
    (
      await fetch('http://127.0.0.1:3101/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${demoted.token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
    ).status,
  ).toBe(401);
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

test('password reset signs in automatically and invalidates old sessions and tokens', async ({
  page,
}) => {
  const customer = await actor();
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByRole('button', { name: 'Forgot password?', exact: true })
    .click();
  await page.getByLabel('Email', { exact: true }).fill(customer.email);
  await page
    .getByRole('button', { name: 'Send reset link', exact: true })
    .click();
  await expect(
    page.getByText('If that account exists, a reset link has been sent.', {
      exact: true,
    }),
  ).toBeVisible();
  // Read the local test challenge as the mail recipient; production reset URLs are delivered by email.
  const [challenge] = await db
    .select()
    .from(verification)
    .where(
      and(
        eq(verification.value, customer.id),
        like(verification.identifier, 'reset-password:%'),
      ),
    );
  expect(challenge).toBeDefined();
  const token = challenge!.identifier.slice('reset-password:'.length);
  await page.goto(
    `/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(baseURL + '/?reset=1')}`,
  );
  await expect(
    page.getByRole('heading', { name: 'Choose a new password', exact: true }),
  ).toBeVisible();
  const nextPassword = 'A-new-market-password-456!';
  await page.getByLabel('Password', { exact: true }).fill(nextPassword);
  await page
    .getByRole('button', { name: 'Reset password', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your profile', exact: true }),
  ).toBeVisible();
  expect((await api(page.request).me.query())?.id).toBe(customer.id);
  await expect(page).toHaveURL(baseURL + '/?page=profile');
  expect(await customer.rpc.me.query()).toBeNull();
  const reused = await customer.request.post('/api/auth/reset-password', {
    data: { token, newPassword: password },
    headers: { Origin: baseURL },
  });
  expect(reused.status()).toBeGreaterThanOrEqual(400);
  expect(await customer.rpc.me.query()).toBeNull();
  await customer.request.dispose();
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
      admin.request.get('http://127.0.0.1:3101/internal/jobs/market-runs', {
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

test('operations UI edits a weekly schedule and MCP exposes persisted recurrence', async ({
  browser,
}) => {
  const admin = await browserActor(browser, 'customer', 'Schedule Operator');
  const current = await admin.rpc.me.query();
  await db
    .update(networkMemberships)
    .set({ role: 'network_admin' })
    .where(
      and(
        eq(networkMemberships.userId, current!.id),
        eq(networkMemberships.networkId, OJAI_NETWORK_ID),
      ),
    );
  const market = await admin.rpc.admin.createMarket.mutate({
    name: unique('Weekly UI market'),
    address: '414 E Ojai Avenue, Ojai, CA',
    timezone: 'America/Los_Angeles',
  });
  await admin.page.reload();
  await admin.page
    .getByRole('button', { name: 'Operations', exact: true })
    .click();
  await admin.page
    .getByLabel('Schedule market', { exact: true })
    .selectOption(market.id);
  await admin.page.getByLabel('Day of week', { exact: true }).selectOption('4');
  await admin.page
    .getByLabel('Skip Thanksgiving Thursday', { exact: true })
    .check();
  await admin.page
    .getByRole('button', { name: 'Save weekly schedule', exact: true })
    .click();
  await expect(
    admin.page.getByText('Weekly schedule saved', { exact: true }),
  ).toBeVisible();
  const [schedule] = await db
    .select()
    .from(marketSchedules)
    .where(eq(marketSchedules.marketId, market.id));
  expect(schedule!.weekday).toBe(4);
  expect(schedule!.opensMinute).toBe(900);
  expect(schedule!.skipThanksgiving).toBe(true);
  const card = admin.page
    .locator('.run-card')
    .filter({ hasText: market.name })
    .filter({
      has: admin.page.getByRole('button', {
        name: 'Edit schedule',
        exact: true,
      }),
    });
  await card
    .getByRole('button', { name: 'Edit schedule', exact: true })
    .click();
  await admin.page
    .getByLabel('Weekly opening time', { exact: true })
    .fill('14:00');
  await admin.page
    .getByRole('button', { name: 'Save weekly schedule', exact: true })
    .click();
  await expect(card).toContainText('14:00');
  const schedulingJobs = admin.page.locator('details.scheduling-jobs');
  const schedulingSummary = schedulingJobs.locator('summary');
  await expect(schedulingJobs).not.toHaveAttribute('open', '');
  await expect(schedulingSummary).toContainText('Scheduling jobs');
  await expect(
    schedulingJobs.getByRole('button', {
      name: 'Run scheduling job now',
      exact: true,
    }),
  ).toBeHidden();
  await schedulingSummary.click();
  await expect(schedulingJobs).toHaveAttribute('open', '');
  await admin.page
    .getByRole('button', { name: 'Run scheduling job now', exact: true })
    .click();
  await expect(
    admin.page.getByText('Scheduling job finished', { exact: true }),
  ).toBeVisible();
  await expect(schedulingSummary).toContainText('succeeded');
  await schedulingSummary.click();
  await expect(schedulingJobs).not.toHaveAttribute('open', '');
  const { token } = await admin.rpc.admin.createToken.mutate({
    name: 'Weekly MCP',
  });
  const client = new Client({ name: 'weekly-e2e', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3101/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const tools = await client.listTools();
  expect(tools.tools.map((t) => t.name)).toEqual(
    expect.arrayContaining([
      'list_schedules',
      'save_schedule',
      'save_schedule_inventory',
    ]),
  );
  const result = await client.callTool({
    name: 'save_schedule',
    arguments: {
      marketId: market.id,
      weekday: 0,
      opensMinute: 540,
      closesMinute: 780,
      active: true,
    },
  });
  expect(result.isError).not.toBe(true);
  const stored = await db
    .select()
    .from(marketSchedules)
    .where(eq(marketSchedules.marketId, market.id));
  expect(stored).toHaveLength(2);
  await client.close();
  await admin.context.close();
});

test('cron job endpoint rejects unauthorized callers, records results, and skips overlapping jobs', async () => {
  const { admin } = await setup();
  const customer = await actor();
  const endpoint = 'http://127.0.0.1:3101/internal/jobs/market-runs';
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
      'http://127.0.0.1:3101/internal/jobs/market-runs',
      {
        headers: {
          Authorization:
            'Bearer e2e-only-cron-secret-not-for-production-123456789',
        },
      },
    );
    expect(response.status()).toBe(500);
    const history = await admin.rpc.admin.jobs.query();
    expect(history[0]!.status).toBe('failed');
    expect(history[0]!.runsCreated).toBe(0);
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

test('address autocomplete fills structured fields using a keyboard selection', async ({
  browser,
}) => {
  const customer = await browserActor(browser, 'customer', 'Address Customer');
  const { page } = customer;
  const tokens: string[] = [];
  await page.route('**/trpc/addresses.suggest*', async (route) => {
    const body = route.request().postDataJSON();
    tokens.push(body['0'].sessionToken);
    await route.fulfill({
      json: [
        {
          result: {
            data: [
              {
                placeId: 'ojai-place',
                label: '414 East Ojai Avenue, Ojai, CA, USA',
              },
            ],
          },
        },
      ],
    });
  });
  await page.route('**/trpc/addresses.resolve*', async (route) => {
    const body = route.request().postDataJSON();
    expect(body['0'].sessionToken).toBe(tokens[0]);
    await route.fulfill({
      json: [
        {
          result: {
            data: {
              street: '414 East Ojai Avenue',
              city: 'Ojai',
              region: 'CA',
              postalCode: '93023',
            },
          },
        },
      ],
    });
  });
  await page.getByLabel('Apartment / unit', { exact: true }).fill('Unit 3');
  const street = page.getByRole('combobox', { name: 'Street address' });
  await street.fill('414 East Ojai');
  await expect(
    page.getByRole('option', { name: '414 East Ojai Avenue, Ojai, CA, USA' }),
  ).toBeVisible();
  await street.press('ArrowDown');
  await street.press('Enter');
  await expect(street).toHaveValue('414 East Ojai Avenue');
  await expect(page.getByLabel('City', { exact: true })).toHaveValue('Ojai');
  await expect(page.getByLabel('ZIP code', { exact: true })).toHaveValue(
    '93023',
  );
  await expect(
    page.getByLabel('Apartment / unit', { exact: true }),
  ).toHaveValue('Unit 3');
  await page
    .getByRole('button', { name: 'Save delivery profile', exact: true })
    .click();
  await expect(
    page.getByText('Delivery profile saved', { exact: true }),
  ).toBeVisible();
  expect((await customer.rpc.me.query())!.customer!.street).toBe(
    '414 East Ojai Avenue',
  );
  await page.unroute('**/trpc/addresses.suggest*');
  await page.route('**/trpc/addresses.suggest*', (route) =>
    route.fulfill({
      status: 502,
      json: [
        {
          error: {
            message:
              'Address suggestions are unavailable. Enter your address manually.',
            code: -32603,
            data: {
              code: 'BAD_GATEWAY',
              httpStatus: 502,
              path: 'addresses.suggest',
            },
          },
        },
      ],
    }),
  );
  await street.fill('An unmatched address');
  await expect(
    page.getByText(
      'Address suggestions are unavailable. Enter your address manually.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(street).toBeEditable();
  await customer.context.close();
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

test('production config rejects missing origins, example secrets, and incomplete Vercel auth', () => {
  const source = {
    NODE_ENV: 'production',
    VERCEL: '1',
    DATABASE_URL: databaseURL,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    CRON_SECRET: randomBytes(32).toString('hex'),
    RESEND_API_KEY: 'local-stub-only',
    EMAIL_FROM: 'Market <accounts@example.test>',
    WEB_ORIGIN: 'https://market.example.test',
    BETTER_AUTH_URL: 'https://market.example.test',
  };
  expect(parseEnvironment(source).WEB_ORIGIN).toBe(source.WEB_ORIGIN);
  for (const override of [
    { WEB_ORIGIN: undefined },
    { WEB_ORIGIN: 'invalid' },
    { BETTER_AUTH_URL: 'http://localhost:5173' },
    { WEB_ORIGIN: 'https://market.example.test/profile' },
    { BETTER_AUTH_URL: 'https://api.example.test' },
    { RESEND_API_KEY: '' },
    { CRON_SECRET: undefined },
    {
      BETTER_AUTH_SECRET: 'replace-with-a-random-secret-at-least-32-characters',
    },
  ])
    expect(() => parseEnvironment({ ...source, ...override })).toThrow();
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

test('operations reassigns suspended-driver orders without losing shopping or delivery progress', async ({
  page,
}) => {
  const { admin, run, stock } = await setup();
  const customer = await actor();
  const first = await actor('driver');
  const replacement = await actor('driver');
  const order = await customer.rpc.orders.place.mutate({
    runId: run.id,
    requestId: randomUUID(),
    items: [{ inventoryId: stock.id, quantity: 1 }],
  });
  await rejectCode(
    customer.rpc.admin.assignDriver.mutate({
      orderId: order.id,
      driverId: first.id,
    }),
    'FORBIDDEN',
  );
  await rejectCode(
    admin.rpc.admin.assignDriver.mutate({
      orderId: order.id,
      driverId: customer.id,
    }),
    'FORBIDDEN',
  );
  await first.rpc.driver.claim.mutate({ id: order.id });
  await closeCutoff(run.id);
  await first.rpc.driver.start.mutate({ id: order.id });
  await first.rpc.driver.purchase.mutate({
    orderId: order.id,
    orderItemId: (await first.rpc.driver.detail.query({ id: order.id }))
      .items[0]!.id,
    quantity: 1,
    totalCostCents: 200,
  });
  await admin.rpc.admin.reviewDriver.mutate({
    userId: first.id,
    status: 'suspended',
  });
  await rejectCode(
    admin.rpc.admin.assignDriver.mutate({
      orderId: order.id,
      driverId: first.id,
    }),
    'FORBIDDEN',
  );
  await rejectCode(
    admin.rpc.admin.assignDriver.mutate({ orderId: order.id, driverId: null }),
    'CONFLICT',
  );
  // Exercise the same Operations form administrators use for recovery.
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Sign in', exact: true })
    .first()
    .click();
  await page.getByLabel('Email', { exact: true }).fill(admin.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Sign in', exact: true })
    .last()
    .click();
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  await page
    .getByRole('button', { name: 'Orders', exact: true })
    .last()
    .click();
  const card = page
    .locator('.delivery-card')
    .filter({ hasText: order.id.slice(0, 8) });
  await card
    .getByLabel('Assigned driver', { exact: true })
    .selectOption(replacement.id);
  await card
    .getByRole('button', { name: 'Save driver assignment', exact: true })
    .click();
  await expect(
    page.getByText('Driver assignment updated', { exact: true }),
  ).toBeVisible();
  await rejectCode(
    first.rpc.driver.detail.query({ id: order.id }),
    'FORBIDDEN',
  );
  const detail = await replacement.rpc.driver.detail.query({ id: order.id });
  expect(detail.status).toBe('shopping');
  expect(detail.items[0]!.purchase?.totalCostCents).toBe(200);
  await replacement.rpc.driver.finish.mutate({ id: order.id });
  await replacement.rpc.driver.deliver.mutate({
    orderId: order.id,
    status: 'out_for_delivery',
    note: '',
  });
  await admin.rpc.admin.reviewDriver.mutate({
    userId: first.id,
    status: 'approved',
  });
  await admin.rpc.admin.assignDriver.mutate({
    orderId: order.id,
    driverId: first.id,
  });
  await rejectCode(
    replacement.rpc.driver.deliver.mutate({
      orderId: order.id,
      status: 'delivered',
      note: '',
    }),
    'FORBIDDEN',
  );
  await first.rpc.driver.deliver.mutate({
    orderId: order.id,
    status: 'delivered',
    note: '',
  });
  await rejectCode(
    admin.rpc.admin.assignDriver.mutate({
      orderId: order.id,
      driverId: replacement.id,
    }),
    'CONFLICT',
  );
  const completed = (await customer.rpc.orders.mine.query()).find(
    (row) => row.id === order.id,
  )!;
  expect(completed.status).toBe('delivered');
  expect(completed.actualTotalCents).toBe(850);
});

test('loopback browser sign-in and profile writes work without trusting other origins', async ({
  page,
}) => {
  const customer = await actor();
  await page.goto('http://127.0.0.1:5180/');
  await page
    .getByRole('button', { name: 'Sign in', exact: true })
    .first()
    .click();
  await page.getByLabel('Email', { exact: true }).fill(customer.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Sign in', exact: true })
    .last()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your profile', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Full name', { exact: true }).fill('Loopback customer');
  await page
    .getByRole('button', { name: 'Save delivery profile', exact: true })
    .click();
  await expect(
    page.getByText('Delivery profile saved', { exact: true }),
  ).toBeVisible();
  const me = await page.request.get('http://127.0.0.1:5180/trpc/me');
  expect((await me.json()).result.data.name).toBe('Loopback customer');
  for (const origin of ['https://untrusted.example', 'http://127.0.0.1:5181']) {
    const denied = await page.request.post(
      'http://127.0.0.1:5180/api/auth/sign-in/email',
      {
        headers: { Origin: origin },
        data: { email: customer.email, password },
      },
    );
    expect(denied.status()).toBe(403);
    const mutation = await page.request.post(
      'http://127.0.0.1:5180/trpc/profile.locateAddress',
      {
        headers: { Origin: origin },
        data: {},
      },
    );
    expect(mutation.status()).toBe(403);
  }
});

test('market closing expires unshopped orders once and allows shopping completion, delivery and retry afterward', async ({
  page,
}) => {
  const { run, stock } = await setup(20);
  const customer = await actor();
  const driver = await actor('driver');
  const placed = [];
  for (let i = 0; i < 5; i++)
    placed.push(
      await customer.rpc.orders.place.mutate({
        runId: run.id,
        requestId: randomUUID(),
        items: [{ inventoryId: stock.id, quantity: 1 }],
      }),
    );
  const [waiting, claimed, shopping, ready, transit] = placed;
  for (const order of [claimed!, shopping!, ready!, transit!])
    await driver.rpc.driver.claim.mutate({ id: order.id });
  await closeCutoff(run.id);
  for (const order of [shopping!, ready!, transit!]) {
    await driver.rpc.driver.start.mutate({ id: order.id });
    const detail = await driver.rpc.driver.detail.query({ id: order.id });
    await driver.rpc.driver.purchase.mutate({
      orderId: order.id,
      orderItemId: detail.items[0]!.id,
      quantity: 1,
      totalCostCents: 250,
    });
    if (order.id !== shopping!.id)
      await driver.rpc.driver.finish.mutate({ id: order.id });
  }
  await driver.rpc.driver.deliver.mutate({
    orderId: transit!.id,
    status: 'out_for_delivery',
  });
  const closing = new Date();
  await db
    .update(marketRuns)
    .set({
      endsAt: closing,
      deliveryEndAt: new Date(+closing + 3600000),
      deliveryStartAt: new Date(+closing - 60000),
    })
    .where(eq(marketRuns.id, run.id));
  const url = 'http://127.0.0.1:3101/internal/jobs/close-markets';
  expect((await page.request.get(url)).status()).toBe(401);
  const headers = {
    Authorization: 'Bearer e2e-only-cron-secret-not-for-production-123456789',
  };
  const calls = await Promise.all(
    Array.from({ length: 3 }, () => page.request.get(url, { headers })),
  );
  expect(calls.every((r) => r.ok())).toBe(true);
  const after = await customer.rpc.orders.mine.query();
  for (const order of [waiting!, claimed!]) {
    const expired = after.find((o) => o.id === order.id)!;
    expect(expired.status).toBe('cancelled');
    expect(expired.events.filter((e) => e.status === 'cancelled')).toHaveLength(
      1,
    );
  }
  expect(after.find((o) => o.id === shopping!.id)!.status).toBe('shopping');
  expect(after.find((o) => o.id === ready!.id)!.status).toBe('ready');
  expect(after.find((o) => o.id === transit!.id)!.status).toBe(
    'out_for_delivery',
  );
  expect(
    (await db.select().from(inventory).where(eq(inventory.id, stock.id)))[0]!
      .reservedQuantity,
  ).toBe(3);
  await driver.rpc.driver.finish.mutate({ id: shopping!.id });
  await driver.rpc.driver.deliver.mutate({
    orderId: transit!.id,
    status: 'delivery_failed',
    note: 'No answer',
  });
  await driver.rpc.driver.deliver.mutate({
    orderId: transit!.id,
    status: 'out_for_delivery',
  });
  await driver.rpc.driver.deliver.mutate({
    orderId: transit!.id,
    status: 'delivered',
  });
  await driver.rpc.orders.recordCash.mutate({
    orderId: transit!.id,
    amountCents: 850,
  });
  expect(
    await driver.rpc.driver.detail.query({ id: transit!.id }),
  ).toMatchObject({ status: 'delivered', cashCollectedCents: 850 });
  const retry = await page.request.get(url, { headers });
  expect(await retry.json()).toMatchObject({
    ordersCancelled: 0,
    runsClosed: 0,
  });
  await customer.request.dispose();
  await driver.request.dispose();
});

test('driver registration requires an invitation and ignores self-selected signup roles', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Create account', exact: true }),
  ).toHaveCount(0);
  for (const role of ['customer', 'driver', 'admin']) {
    const response = await page.request.post('/api/auth/sign-up/email', {
      headers: { 'x-signup-role': role },
      data: {
        email: `${unique('uninvited')}@example.test`,
        name: 'Uninvited User',
        password,
      },
    });
    expect(response.status()).toBe(403);
  }
  const customerEmail = `${unique('invited-customer')}@example.test`;
  const customerInvitation = await invite(customerEmail, 'customer');
  const isolated = await requestFactory.newContext({ baseURL });
  try {
    const response = await isolated.post('/api/auth/sign-up/email', {
      headers: {
        'x-invite-token': customerInvitation.token,
        'x-signup-role': 'driver',
      },
      data: { email: customerEmail, name: 'Invited Customer', password },
    });
    expect(response.status()).toBe(200);
    expect((await api(isolated).me.query())!.driver).toBeNull();
  } finally {
    await isolated.dispose();
  }
  const email = `${unique('invited-driver')}@example.test`;
  const invitation = await invite(email, 'driver');
  await signupUi(page, email, invitation.token, 'Invited Driver');
  await expect(
    page.getByRole('heading', { name: 'Your driver details', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Phone', { exact: true }).fill('8055550112');
  await page.getByLabel('Vehicle', { exact: true }).fill('Cargo bike');
  await page
    .getByRole('button', { name: 'Save driver details', exact: true })
    .click();
  await expect(
    page.getByText('Driver details saved', { exact: true }),
  ).toBeVisible();
  const me = await api(page.request).me.query();
  expect(me!.driver).toMatchObject({
    status: 'approved',
    phone: '8055550112',
    vehicle: 'Cargo bike',
  });
  expect(me!.admin).toBe(false);
  await page.getByRole('button', { name: 'Driver', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Available orders', exact: true }),
  ).toBeVisible();
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

test('one network migration upgrades the committed schema and preserves existing operations on retries', async () => {
  const { readFile, mkdtemp, mkdir, writeFile, rm } =
    await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const temporary = await mkdtemp(
    join(tmpdir(), 'market-committed-migrations-'),
  );
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
    const journal = JSON.parse(
      await readFile(folder + '/meta/_journal.json', 'utf8'),
    ) as { entries: { tag: string }[] };
    expect(journal.entries.map((entry) => entry.tag)).toEqual([
      '0000_auth_and_basics',
      '0001_orders_and_fulfillment',
      '0002_shopping_packing',
      '0003_networks',
    ]);
    await mkdir(join(temporary, 'meta'));
    await writeFile(
      join(temporary, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 3) }),
    );
    for (const entry of journal.entries.slice(0, 3))
      await writeFile(
        join(temporary, entry.tag + '.sql'),
        await readFile(join(folder, entry.tag + '.sql')),
      );
    await runMigrations(fresh.db, temporary);
    await fresh.pool.query(`
      INSERT INTO users(id,name,email) VALUES ('baseline-user','Baseline User','baseline@example.test');
      INSERT INTO user_roles(user_id,role) VALUES ('baseline-user','admin');
      INSERT INTO customer_profiles(user_id,phone,address) VALUES ('baseline-user','8055550101','Original address');
      INSERT INTO driver_profiles(user_id,phone,vehicle,status) VALUES ('baseline-user','8055550101','Original vehicle','approved');
      INSERT INTO markets(name,address) VALUES ('Baseline Market','Ojai');
      INSERT INTO farms(name,location) VALUES ('Legacy farm','Ojai');
      INSERT INTO produce(farm_id,name,description,category,unit,price_cents,available_quantity) SELECT id,'Original carrots','','Vegetables','each',250,10 FROM farms;
      INSERT INTO market_runs(market_id,starts_at,ends_at,cutoff_at,delivery_start_at,delivery_end_at) SELECT id,now()+interval '1 day',now()+interval '2 days',now(),now()+interval '1 day',now()+interval '2 days' FROM markets;
      INSERT INTO inventory(run_id,produce_id,price_cents,quantity,reserved_quantity) SELECT r.id,p.id,250,10,1 FROM market_runs r CROSS JOIN produce p;
      INSERT INTO orders(customer_id,driver_id,run_id,request_id,status,customer_name,phone,address,delivery_notes,delivery_fee_cents,estimated_total_cents) SELECT 'baseline-user','baseline-user',id,gen_random_uuid(),'claimed','Original name','8055550101','Original address','Original note',500,750 FROM market_runs;
      INSERT INTO order_items(order_id,inventory_id,farm_id,farm_name,farm_location,name,unit,quantity,price_cents) SELECT o.id,i.id,f.id,f.name,f.location,p.name,p.unit,1,250 FROM orders o CROSS JOIN inventory i CROSS JOIN produce p CROSS JOIN farms f;
      INSERT INTO api_tokens(user_id,name,token_hash,last_four,expires_at) VALUES ('baseline-user','Original token','baseline-token-hash','hash',now()+interval '30 days');
    `);
    await Promise.all([
      runMigrations(fresh.db, folder),
      runMigrations(fresh.db, folder),
    ]);
    const tables = (
      await fresh.pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
      )
    ).rows.map((row) => row.table_name);
    for (const table of [
      'users',
      'auth_sessions',
      'customer_profiles',
      'driver_profiles',
      'farms',
      'produce',
      'markets',
      'market_runs',
      'inventory',
      'orders',
      'order_items',
      'purchases',
      'market_schedules',
      'schedule_inventory',
      'order_events',
      'background_job_runs',
      'api_tokens',
      'network_memberships',
      'networks',
    ])
      expect(tables).toContain(table);
    expect(tables).not.toContain('legacy_run_purchases');
    expect(
      (
        await fresh.pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='networks'",
        )
      ).rows.map((row) => row.column_name),
    ).toEqual(
      expect.arrayContaining([
        'branding',
        'deleted_at',
        'support_email',
        'support_phone',
        'contact_url',
        'location',
        'email_reply_to',
        'email_key_encrypted',
      ]),
    );
    expect(
      (
        await fresh.pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='order_items' AND column_name='packed_at'",
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await fresh.pool.query(
          "SELECT conname FROM pg_constraint WHERE conname='packed_item_valid'",
        )
      ).rows,
    ).toHaveLength(1);
    const { resolveNetwork } = await import('../../apps/api/src/networks.js');
    expect(await resolveNetwork(fresh.db)).toMatchObject({
      slug: 'ojai',
      location: {
        city: 'Ojai',
        region: 'CA',
        postalCode: '93023',
        autocompleteBias: {
          latitude: 34.448,
          longitude: -119.243,
          radiusMeters: 30000,
        },
      },
    });
    expect(
      (await fresh.pool.query('SELECT role FROM user_roles')).rows,
    ).toEqual([{ role: 'global_admin' }]);
    expect(
      (
        await fresh.pool.query(
          'SELECT network_id, role FROM network_memberships',
        )
      ).rows,
    ).toEqual([{ network_id: OJAI_NETWORK_ID, role: 'network_admin' }]);
    for (const table of [
      'customer_profiles',
      'driver_profiles',
      'markets',
      'farms',
      'produce',
      'market_runs',
      'inventory',
      'orders',
      'order_items',
      'api_tokens',
    ]) {
      expect(
        (await fresh.pool.query(`SELECT DISTINCT network_id FROM ${table}`))
          .rows,
      ).toEqual([{ network_id: OJAI_NETWORK_ID }]);
    }
    expect(
      (
        await fresh.pool.query(
          'SELECT address, estimated_total_cents, status FROM orders',
        )
      ).rows,
    ).toEqual([
      {
        address: 'Original address',
        estimated_total_cents: 750,
        status: 'claimed',
      },
    ]);
    expect(
      (await fresh.pool.query('SELECT quantity, price_cents FROM order_items'))
        .rows,
    ).toEqual([{ quantity: 1, price_cents: 250 }]);
    const farm = await withNetwork(
      fresh.db,
      OJAI_NETWORK_ID,
      'baseline-user',
      async (scoped) =>
        (
          await scoped
            .insert(farms)
            .values({ name: 'Local farm', location: 'Ojai' })
            .returning()
        )[0]!,
    );
    const [other] = await fresh.db
      .insert(networks)
      .values({ name: 'Another operator', slug: 'another' })
      .returning();
    await fresh.db
      .insert(farms)
      .values({ networkId: other!.id, name: 'Other farm', location: 'Sonoma' });
    expect(
      await withNetwork(
        fresh.db,
        OJAI_NETWORK_ID,
        'baseline-user',
        async (scoped) =>
          scoped.select().from(farms).where(eq(farms.id, farm.id)),
      ),
    ).toEqual([farm]);
    await fresh.pool.query(
      "INSERT INTO networks(name,slug,created_at,deleted_at) VALUES ('Retired','retired','2000-01-01',now())",
    );
    expect((await resolveNetwork(fresh.db)).slug).toBe('ojai');
    await fresh.pool.query(
      'UPDATE networks SET deleted_at=now() WHERE slug=$1',
      ['ojai'],
    );
    expect((await resolveNetwork(fresh.db)).slug).toBe('another');
    await expect(resolveNetwork(fresh.db, 'ojai')).rejects.toThrow(
      'Network not found',
    );
    await expect(resolveNetwork(fresh.db, 'retired')).rejects.toThrow(
      'Network not found',
    );
    await Promise.all([
      runMigrations(fresh.db, folder),
      runMigrations(fresh.db, folder),
    ]);
    expect(
      (
        await fresh.pool.query(
          'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
        )
      ).rows[0]!.count,
    ).toBe(4);
    expect((await fresh.pool.query('SELECT id FROM users')).rows).toEqual([
      { id: 'baseline-user' },
    ]);
    expect((await fresh.db.select().from(farms)).length).toBe(3);
  } finally {
    await fresh.pool.end();
    await pool.query(`DROP DATABASE "${name}"`);
    await rm(temporary, { recursive: true, force: true });
  }
});

test('driver orders group by market and date and can be claimed together', async ({
  browser,
}) => {
  const first = await setup(20),
    second = await setup(20);
  const customer = await actor();
  const driver = await browserActor(browser, 'driver', 'Grouped Orders Driver');
  await driver.rpc.profile.save.mutate({
    name: 'Grouped Orders Driver',
    phone: '7075550101',
    street: '10 Market Street',
    city: 'Ojai',
    region: 'CA',
    postalCode: '93023',
    deliveryNotes: '',
  });
  const now = Date.now();
  const nextDate = await first.admin.rpc.admin.scheduleRun.mutate({
    marketId: first.market.id,
    cutoffAt: new Date(now + 2 * 86400000).toISOString(),
    startsAt: new Date(now + 3 * 86400000).toISOString(),
    endsAt: new Date(now + 3 * 86400000 + 4 * 3600000).toISOString(),
    deliveryStartAt: new Date(now + 3 * 86400000 + 3600000).toISOString(),
    deliveryEndAt: new Date(now + 3 * 86400000 + 5 * 3600000).toISOString(),
    deliveryFeeCents: 500,
  });
  const nextStock = await first.admin.rpc.admin.saveInventory.mutate({
    runId: nextDate.id,
    produceId: first.produce.id,
    priceCents: 350,
    quantity: 20,
  });
  const placed: Awaited<ReturnType<typeof customer.rpc.orders.place.mutate>>[] =
    [];
  for (const [runId, inventoryId] of [
    [first.run.id, first.stock.id],
    [first.run.id, first.stock.id],
    [nextDate.id, nextStock.id],
    [second.run.id, second.stock.id],
  ]) {
    placed.push(
      await (
        placed.length === 0 ? driver.rpc : customer.rpc
      ).orders.place.mutate({
        runId: runId!,
        requestId: randomUUID(),
        items: [{ inventoryId: inventoryId!, quantity: 1 }],
      }),
    );
  }
  const page = driver.page;
  await page.getByRole('button', { name: 'Driver', exact: true }).click();
  await page
    .getByLabel('Filter by market', { exact: true })
    .selectOption(second.market.id);
  await expect(
    page.getByRole('region', { name: second.market.name, exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Filter by market', { exact: true })
    .selectOption(first.market.id);
  const market = page.getByRole('region', {
    name: first.market.name,
    exact: true,
  });
  await expect(market.locator('.driver-market-date')).toHaveCount(2);
  const date = market.locator('.driver-market-date').filter({
    has: page.getByRole('heading', {
      name: `Order ${placed[0]!.id.slice(0, 8)}`,
      exact: true,
    }),
  });
  await expect(date.getByText('Your order', { exact: true })).toBeVisible();
  await date
    .getByRole('checkbox', {
      name: 'Select all shown orders',
      exact: true,
    })
    .check();
  await expect(
    date.getByRole('button', { name: 'Claim selected (2)', exact: true }),
  ).toBeEnabled();
  await expect(date.getByText('2 selected', { exact: true })).toBeVisible();
  await expect(
    market.getByRole('checkbox', {
      name: `Select order ${placed[2]!.id.slice(0, 8)}`,
      exact: true,
    }),
  ).not.toBeChecked();
  const claimRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('driver.claim'))
      claimRequests.push(new URL(request.url()).pathname);
  });
  await date
    .getByRole('button', { name: 'Claim selected (2)', exact: true })
    .click();
  await expect(
    page.getByText('2 orders claimed. Open My orders to start shopping.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(claimRequests).toEqual(['/trpc/driver.claimBatch']);
  const me = await driver.rpc.me.query();
  const saved = [
    ...(await customer.rpc.orders.mine.query()),
    ...(await driver.rpc.orders.mine.query()),
  ];
  for (const order of placed.slice(0, 2))
    expect(saved.find((row) => row.id === order.id)).toMatchObject({
      status: 'claimed',
      driverId: me!.id,
    });
  for (const order of placed.slice(2))
    expect(saved.find((row) => row.id === order.id)).toMatchObject({
      status: 'placed',
      driverId: null,
    });
  await page.getByRole('button', { name: 'My orders', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: first.market.name, exact: true })
      .locator('.run-card'),
  ).toHaveCount(2);
  await expect(market.getByText('Your order', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: second.market.name, exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Open order', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Shopping list', exact: true }),
  ).toBeVisible();
  await driver.context.close();
  await customer.request.dispose();
});

test('bulk claims report a competing claim and retain successful orders', async ({
  browser,
}) => {
  const { run, stock, market } = await setup(20);
  const customer = await actor(),
    rival = await actor('driver');
  const driver = await browserActor(browser, 'driver', 'Bulk Claim Driver');
  const placed: Awaited<ReturnType<typeof customer.rpc.orders.place.mutate>>[] =
    [];
  for (let i = 0; i < 2; i++)
    placed.push(
      await customer.rpc.orders.place.mutate({
        runId: run.id,
        requestId: randomUUID(),
        items: [{ inventoryId: stock.id, quantity: 1 }],
      }),
    );
  const page = driver.page;
  await page.getByRole('button', { name: 'Driver', exact: true }).click();
  await page
    .getByLabel('Filter by market', { exact: true })
    .selectOption(market.id);
  const group = page.getByRole('region', { name: market.name, exact: true });
  await group
    .getByRole('checkbox', {
      name: 'Select all shown orders',
      exact: true,
    })
    .check();
  let taken = false;
  await page.route('**/trpc/**', async (route) => {
    if (
      !taken &&
      new URL(route.request().url()).pathname.includes('driver.claim')
    ) {
      taken = true;
      await rival.rpc.driver.claim.mutate({ id: placed[1]!.id });
    }
    await route.continue();
  });
  await group
    .getByRole('button', { name: 'Claim selected (2)', exact: true })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Claimed 1 of 2 orders.' }),
  ).toBeVisible();
  const me = await driver.rpc.me.query();
  const saved = await customer.rpc.orders.mine.query();
  expect(saved.find((order) => order.id === placed[0]!.id)!.driverId).toBe(
    me!.id,
  );
  expect(saved.find((order) => order.id === placed[1]!.id)!.driverId).toBe(
    rival.id,
  );
  await expect(group).toHaveCount(0);
  await page.getByRole('button', { name: 'My orders', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: market.name, exact: true })
      .locator('.run-card'),
  ).toHaveCount(1);
  await driver.context.close();
  await customer.request.dispose();
  await rival.request.dispose();
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

test('drivers browse more than 25 orders within a date without carrying hidden selections', async ({
  browser,
}) => {
  const { run, stock, market } = await setup(50);
  const customer = await actor();
  const driver = await browserActor(browser, 'driver', 'Paginated Driver');
  for (let i = 0; i < 26; i++)
    await customer.rpc.orders.place.mutate({
      runId: run.id,
      requestId: randomUUID(),
      items: [{ inventoryId: stock.id, quantity: 1 }],
    });
  const page = driver.page;
  await page.getByRole('button', { name: 'Driver', exact: true }).click();
  await page
    .getByLabel('Filter by market', { exact: true })
    .selectOption(market.id);
  const group = page.getByRole('region', { name: market.name, exact: true });
  await expect(group.locator('.run-card')).toHaveCount(25);
  await expect(
    group.getByText('26 orders across these dates', { exact: true }),
  ).toBeVisible();
  await group
    .getByRole('checkbox', { name: 'Select all shown orders', exact: true })
    .check();
  await expect(
    group.getByRole('button', { name: 'Claim selected (25)', exact: true }),
  ).toBeEnabled();
  await group.getByRole('button', { name: 'More orders', exact: true }).click();
  await expect(group.locator('.run-card')).toHaveCount(1);
  await expect(
    group.getByRole('button', { name: 'Claim selected (0)', exact: true }),
  ).toBeDisabled();
  await group
    .getByRole('checkbox', { name: 'Select all shown orders', exact: true })
    .check();
  await group
    .getByRole('button', { name: 'Claim selected (1)', exact: true })
    .click();
  await expect(
    page.getByText('1 order claimed. Open My orders to start shopping.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(group.locator('.run-card')).toHaveCount(25);
  expect(
    (
      await driver.rpc.driver.orderGroups.query({
        view: 'mine',
        marketId: market.id,
      })
    ).markets[0]!.orderCount,
  ).toBe(1);
  await customer.request.dispose();
  await driver.context.close();
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

test('driver shops combined quantities, reviews allocations and packs customer orders with saved checkboxes', async ({
  browser,
}) => {
  const { run, stock, market, produce } = await setup(20);
  const customer = await actor();
  const driver = await browserActor(browser, 'driver', 'Combined Shopper');
  const placed: Awaited<ReturnType<typeof customer.rpc.orders.place.mutate>>[] =
    [];
  for (let i = 0; i < 2; i++)
    placed.push(
      await customer.rpc.orders.place.mutate({
        runId: run.id,
        requestId: randomUUID(),
        items: [{ inventoryId: stock.id, quantity: 2 }],
      }),
    );
  await driver.rpc.driver.claimBatch.mutate({
    runId: run.id,
    orderIds: placed.map((order) => order.id),
  });
  await closeCutoff(run.id);
  const page = driver.page;
  async function openTrip() {
    await page.getByRole('button', { name: 'Driver', exact: true }).click();
    await page.getByRole('button', { name: 'My orders', exact: true }).click();
    await page
      .getByLabel('Filter by market', { exact: true })
      .selectOption(market.id);
    await page
      .getByRole('button', { name: 'Combined shopping list', exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        name: 'Combined shopping list',
        exact: true,
      }),
    ).toBeVisible();
  }
  await openTrip();
  await page
    .getByRole('button', {
      name: 'Start shopping for all claimed orders (2)',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('Shopping started for your claimed orders', { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(`Combined quantity for ${produce.name}`, { exact: true })
    .fill('3');
  await page
    .getByLabel(`Combined cost for ${produce.name}`, { exact: true })
    .fill('5.01');
  await page
    .getByText('Review allocations to 2 customer orders', { exact: true })
    .click();
  const first = page.getByLabel(
      `Allocate ${produce.name} to order ${placed[0]!.id.slice(0, 8)}`,
      { exact: true },
    ),
    second = page.getByLabel(
      `Allocate ${produce.name} to order ${placed[1]!.id.slice(0, 8)}`,
      { exact: true },
    );
  await expect(first).toHaveValue('2');
  await expect(second).toHaveValue('1');
  await first.fill('1');
  await second.fill('2');
  await page
    .getByRole('button', { name: 'Save combined purchase', exact: true })
    .click();
  await expect(
    page.getByText('Combined purchase saved', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Finish shopping (2 orders)', exact: true })
    .click();
  await expect(
    page.getByText('Shopping finalized; pack each customer’s order below', {
      exact: true,
    }),
  ).toBeVisible();
  const check = page.getByRole('checkbox', {
    name: `Packed ${produce.name} for order ${placed[0]!.id.slice(0, 8)}`,
    exact: true,
  });
  await check.check();
  await expect(
    page.getByText('Packing checklist saved', { exact: true }),
  ).toBeVisible();
  await expect(check).toBeChecked();
  await page.reload();
  await openTrip();
  await expect(
    page.getByRole('checkbox', {
      name: `Packed ${produce.name} for order ${placed[0]!.id.slice(0, 8)}`,
      exact: true,
    }),
  ).toBeChecked();
  const trip = await driver.rpc.driver.shoppingList.query({ runId: run.id });
  expect(trip.orders.find((order) => order.id === placed[0]!.id)).toMatchObject(
    {
      actualTotalCents: 850,
      items: [
        expect.objectContaining({ fulfilledQuantity: 1, actualCostCents: 167 }),
      ],
    },
  );
  expect(trip.orders.find((order) => order.id === placed[1]!.id)).toMatchObject(
    {
      actualTotalCents: 1200,
      items: [
        expect.objectContaining({ fulfilledQuantity: 2, actualCostCents: 334 }),
      ],
    },
  );
  await customer.request.dispose();
  await driver.context.close();
});

test('networks isolate records, memberships, profiles, and MCP tokens while global admins retain platform access', async () => {
  const admin = await actor('admin');
  await rejectCode(
    admin.rpc.networks.create.mutate({
      name: 'Forbidden',
      slug: unique('forbidden'),
    }),
    'FORBIDDEN',
  );
  await rejectCode(
    admin.rpc.networks.createToken.mutate({ name: 'Forbidden global' }),
    'FORBIDDEN',
  );
  const [other] = await db
    .insert(networks)
    .values({ name: 'Independent Sonoma', slug: unique('sonoma') })
    .returning();
  const otherRpc = api(admin.request, other!.slug);
  await rejectCode(
    otherRpc.admin.createFarm.mutate({
      name: 'Forbidden farm',
      location: 'Sonoma',
    }),
    'FORBIDDEN',
  );
  await rejectCode(otherRpc.networks.current.query(), 'FORBIDDEN');
  await db.insert(userRoles).values({ userId: admin.id, role: 'global_admin' });
  const globalMe = await otherRpc.me.query();
  expect(globalMe).toMatchObject({
    globalAdmin: true,
    admin: true,
    networkAdmin: false,
    customer: null,
  });
  const created = await admin.rpc.networks.create.mutate({
    name: 'New York',
    slug: unique('ny'),
  });
  expect((await admin.rpc.networks.list.query()).map((n) => n.id)).toContain(
    created.id,
  );
  const localFarm = await admin.rpc.admin.createFarm.mutate({
    name: 'Shared farm name',
    location: 'Ojai',
  });
  const remoteFarm = await otherRpc.admin.createFarm.mutate({
    name: 'Shared farm name',
    location: 'Sonoma',
  });
  expect((await admin.rpc.farms.list.query()).map((f) => f.id)).not.toContain(
    remoteFarm.id,
  );
  expect((await otherRpc.farms.list.query()).map((f) => f.id)).toEqual([
    remoteFarm.id,
  ]);
  await rejectCode(
    admin.rpc.admin.updateFarm.mutate({
      id: remoteFarm.id,
      name: 'Intrusion',
      location: 'Ojai',
    }),
    'NOT_FOUND',
  );
  expect((await otherRpc.farms.list.query())[0]!.name).toBe('Shared farm name');
  // Foreign keys enforce network ownership even if application validation is bypassed.
  await expect(
    withNetwork(db, OJAI_NETWORK_ID, admin.id, async (scoped) => {
      await scoped.insert(produce).values({
        farmId: remoteFarm.id,
        name: 'Bad link',
        description: '',
        category: 'Vegetables',
        unit: 'each',
        priceCents: 1,
        availableQuantity: 1,
      });
    }),
  ).rejects.toThrow();
  await expect(
    withNetwork(db, OJAI_NETWORK_ID, admin.id, async (scoped) => {
      await scoped.insert(farms).values({
        networkId: other!.id,
        name: 'Bad owner',
        location: 'Sonoma',
      });
    }),
  ).rejects.toThrow();
  await otherRpc.profile.save.mutate({
    name: 'Local Customer',
    phone: '7075550101',
    street: '99 Sonoma Road',
    city: 'Sonoma',
    region: 'CA',
    postalCode: '95476',
    deliveryNotes: '',
  });
  expect((await admin.rpc.me.query())!.customer!.city).toBe('Ojai');
  expect((await otherRpc.me.query())!.customer!.city).toBe('Sonoma');
  const localToken = await admin.rpc.admin.createToken.mutate({
    name: 'Network only',
  });
  const globalToken = await admin.rpc.networks.createToken.mutate({
    name: 'Platform access',
  });
  const client = new Client({ name: 'network-isolation', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3101/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${localToken.token}` } },
    }),
  );
  expect((await client.listTools()).tools.map((t) => t.name)).not.toContain(
    'create_network',
  );
  const data = await client.callTool({ name: 'list_farms', arguments: {} });
  expect(JSON.stringify(data.content)).toContain(localFarm.id);
  expect(JSON.stringify(data.content)).not.toContain(remoteFarm.id);
  await client.close();
  const forbidden = await admin.request.post(
    `http://127.0.0.1:3101/mcp?network=${other!.slug}`,
    { headers: { Authorization: `Bearer ${localToken.token}` }, data: {} },
  );
  expect(forbidden.status()).toBe(403);
  const platformClient = new Client({ name: 'global-isolation', version: '1' });
  await platformClient.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:3101/mcp?network=${other!.slug}`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${globalToken.token}` },
        },
      },
    ),
  );
  expect((await platformClient.listTools()).tools.map((t) => t.name)).toContain(
    'create_network',
  );
  const remote = await platformClient.callTool({
    name: 'list_farms',
    arguments: {},
  });
  expect(JSON.stringify(remote.content)).toContain(remoteFarm.id);
  expect(JSON.stringify(remote.content)).not.toContain(localFarm.id);
  await platformClient.close();
  // Losing the global role immediately invalidates platform tokens.
  await db.delete(userRoles).where(eq(userRoles.userId, admin.id));
  expect(
    (
      await admin.request.post('http://127.0.0.1:3101/mcp', {
        headers: { Authorization: `Bearer ${globalToken.token}` },
        data: {},
      })
    ).status(),
  ).toBe(401);
  expect((await admin.rpc.me.query())!.networkAdmin).toBe(true);
  await admin.request.dispose();
});

test('network invitations enroll existing accounts without sharing driver approval or administrator roles', async () => {
  const admin = await actor('admin'),
    driver = await actor('driver');
  const [other] = await db
    .insert(networks)
    .values({ name: 'Independent network', slug: unique('independent') })
    .returning();
  await db.insert(userRoles).values({ userId: admin.id, role: 'global_admin' });
  const otherAdmin = api(admin.request, other!.slug),
    otherDriver = api(driver.request, other!.slug);
  const invitation = await otherAdmin.admin.invite.mutate({
    email: driver.email,
    role: 'network_admin',
  });
  await otherDriver.acceptInvitation.mutate({ token: invitation.token });
  expect(await otherDriver.me.query()).toMatchObject({
    networkAdmin: true,
    globalAdmin: false,
    driver: null,
  });
  expect((await driver.rpc.me.query())!.driver!.status).toBe('approved');
  expect((await driver.rpc.me.query())!.networkAdmin).toBe(false);
  await rejectCode(
    otherDriver.networks.setMember.mutate({
      email: driver.email,
      role: 'member',
    }),
    'CONFLICT',
  );
  await rejectCode(
    driver.rpc.acceptInvitation.mutate({ token: invitation.token }),
    'NOT_FOUND',
  );
  // New-account invitations bind signup to the selected network.
  const email = `${unique('network-signup')}@example.test`;
  const signupInvite = await otherAdmin.admin.invite.mutate({
    email,
    role: 'driver',
  });
  const request = await requestFactory.newContext({ baseURL });
  expect(
    (
      await request.post('/api/auth/sign-up/email', {
        headers: { 'x-invite-token': signupInvite.token },
        data: { name: 'Network Driver', email, password },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/auth/sign-up/email', {
        headers: {
          'x-invite-token': signupInvite.token,
          'x-network-id': other!.slug,
        },
        data: { name: 'Network Driver', email, password },
      })
    ).status(),
  ).toBe(200);
  expect(await api(request, other!.slug).me.query()).toMatchObject({
    driver: { status: 'approved' },
    networkAdmin: false,
  });
  expect((await api(request).me.query())!.driver).toBeNull();
  await rejectCode(api(request).orders.mine.query(), 'FORBIDDEN');
  await request.dispose();
  await driver.request.dispose();
  await admin.request.dispose();
});

test('MCP edits every Configure setting and administrator role with encrypted, isolated email overrides', async () => {
  const { networkEmailConfig } = await import('../../apps/api/src/networks.js');
  const admin = await actor('admin'),
    member = await actor();
  const [other] = await db
    .insert(networks)
    .values({
      name: 'Other sender',
      slug: unique('sender'),
      location: {
        autocompleteBias: {
          postalCode: '10001',
          latitude: 40.71,
          longitude: -74.01,
          radiusMeters: 10000,
        },
      },
    })
    .returning();
  await db.insert(networkMemberships).values([
    { networkId: other!.id, userId: admin.id, role: 'network_admin' },
    { networkId: other!.id, userId: member.id, role: 'member' },
  ]);
  const settings = api(admin.request, other!.slug);
  const { token } = await settings.admin.createToken.mutate({
    name: 'Configure app',
  });
  const client = new Client({ name: 'configure-e2e', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3101/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    return JSON.parse((result.content as { text: string }[])[0]!.text);
  };
  try {
    const key = 'network-resend-secret-example';
    const defaults = {
      secret: 'e2e-only-secret-never-use-in-production-123456789',
      resendKey: 'platform-key',
      emailFrom: 'platform@example.test',
    };
    const branding = {
      primaryColor: '#123456',
      accentColor: '#654321',
      backgroundColor: '#eef3fa',
      textColor: '#152030',
      font: 'rounded',
      logoUrl: 'https://example.test/logo.png',
      headerDisplay: 'logo-text',
    };
    const response = await call('update_network', {
      name: 'Configured app',
      supportEmail: 'help@example.test',
      supportPhone: '+1 212 555 0101',
      contactUrl: 'https://example.test/contact',
      emailReplyTo: 'replies@example.test',
      location: {
        city: 'New York',
        region: 'NY',
        postalCode: '10001',
        timezone: 'America/New_York',
        autocompleteBias: {
          postalCode: '10001',
          radiusMeters: 10000,
        },
      },
      emailKey: key,
      emailFrom: 'app@example.test',
      branding,
    });
    expect(response).toMatchObject({
      name: 'Configured app',
      hasEmailKey: true,
      branding,
    });
    const read = await call('get_network');
    expect(read).toMatchObject({
      name: 'Configured app',
      emailFrom: 'app@example.test',
      supportEmail: 'help@example.test',
      supportPhone: '+1 212 555 0101',
      contactUrl: 'https://example.test/contact',
      emailReplyTo: 'replies@example.test',
      location: {
        city: 'New York',
        region: 'NY',
        postalCode: '10001',
        timezone: 'America/New_York',
      },
      hasEmailKey: true,
      branding,
    });
    expect(JSON.stringify(read)).not.toContain(key);
    expect(read).not.toHaveProperty('emailKeyEncrypted');
    expect(await settings.networks.current.query()).toMatchObject({
      name: 'Configured app',
      branding,
    });
    const [stored] = await db
      .select()
      .from(networks)
      .where(eq(networks.id, other!.id));
    expect(stored!.emailKeyEncrypted).not.toContain(key);
    expect(await networkEmailConfig(db, other!.id, defaults)).toMatchObject({
      resendKey: key,
      emailFrom: 'app@example.test',
    });
    expect(
      await networkEmailConfig(db, OJAI_NETWORK_ID, defaults),
    ).toMatchObject({
      resendKey: 'platform-key',
      emailFrom: 'platform@example.test',
    });
    await call('set_network_member', {
      email: member.email,
      role: 'network_admin',
    });
    expect(await call('list_network_members')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: member.email, role: 'network_admin' }),
      ]),
    );
    expect(
      (await api(member.request, other!.slug).me.query())!.networkAdmin,
    ).toBe(true);
    await call('set_network_member', { email: member.email, role: 'member' });
    expect(
      (await api(member.request, other!.slug).me.query())!.networkAdmin,
    ).toBe(false);
    await call('update_network', { branding: { headerDisplay: 'text' } });
    expect((await call('get_network')).branding).toEqual({
      ...branding,
      headerDisplay: 'text',
    });
    await call('update_network', {
      branding: null,
      emailKey: null,
      emailFrom: null,
    });
    expect(await call('get_network')).toMatchObject({
      branding: {},
      hasEmailKey: false,
      emailFrom: null,
    });
    expect(await networkEmailConfig(db, other!.id, defaults)).toMatchObject({
      resendKey: 'platform-key',
      emailFrom: 'platform@example.test',
    });
  } finally {
    await client.close();
    await admin.request.dispose();
    await member.request.dispose();
  }
});

test('global and network dashboards create independent networks and manage local settings', async ({
  browser,
}) => {
  const admin = await actor('admin');
  await db.insert(userRoles).values({ userId: admin.id, role: 'global_admin' });
  const context = await browser.newContext({
    storageState: await admin.request.storageState(),
  });
  const page = await context.newPage();
  await page.goto('/?page=global-administration');
  await expect(
    page.getByRole('heading', { name: 'Global administration', exact: true }),
  ).toBeVisible();
  const slug = unique('dashboard');
  await page
    .getByLabel('Network name', { exact: true })
    .fill('Dashboard Network');
  await page.getByLabel('Network slug').fill(slug);
  await page
    .getByRole('button', { name: 'Create network', exact: true })
    .click();
  const row = page.locator('.list-row').filter({ hasText: slug });
  await row.getByRole('button', { name: 'Open network' }).click();
  await expect(page).toHaveURL(new RegExp('network=' + slug));
  await expect(page.getByLabel('Network', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  await page.getByRole('button', { name: 'Configure', exact: true }).click();
  await page
    .getByLabel('App name', { exact: true })
    .fill('Updated Local Network');
  await page.getByLabel('Sender email override').fill('local@example.test');
  await page.getByLabel('Resend API key override').fill('write-only-test-key');
  await page.getByRole('button', { name: 'Save app settings' }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  // Saving must leave both settings cards together below the full-width notice.
  const grid = page.locator('.configure-layout');
  await expect
    .poll(async () => {
      const [noticeBox, gridBox, settingsBox, brandingBox] = await Promise.all([
        page.getByRole('status').boundingBox(),
        grid.boundingBox(),
        page
          .getByRole('heading', { name: 'App settings', exact: true })
          .locator('..')
          .boundingBox(),
        page
          .getByRole('heading', { name: 'Branding', exact: true })
          .locator('..')
          .boundingBox(),
      ]);
      return (
        !!noticeBox &&
        !!gridBox &&
        !!settingsBox &&
        !!brandingBox &&
        Math.abs(noticeBox.width - gridBox.width) < 1 &&
        settingsBox.y >= noticeBox.y + noticeBox.height &&
        Math.abs(settingsBox.y - brandingBox.y) < 1
      );
    })
    .toBe(true);
  const appCard = page
    .getByRole('heading', { name: 'App settings', exact: true })
    .locator('..');
  const supportCard = page
    .getByRole('heading', { name: 'Support contact', exact: true })
    .locator('..');
  const brandingCard = page
    .getByRole('heading', { name: 'Branding', exact: true })
    .locator('..');
  const [appBox, supportBox, brandBox] = await Promise.all([
    appCard.boundingBox(),
    supportCard.boundingBox(),
    brandingCard.boundingBox(),
  ]);
  expect(supportBox!.y - (appBox!.y + appBox!.height)).toBeCloseTo(24, 0);
  expect(supportBox!.y).toBeLessThan(brandBox!.y + brandBox!.height);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const [app, support, brand] = await Promise.all([
        appCard.boundingBox(),
        supportCard.boundingBox(),
        brandingCard.boundingBox(),
      ]);
      return (
        !!app &&
        !!support &&
        !!brand &&
        Math.abs(app.x - support.x) < 1 &&
        Math.abs(app.x - brand.x) < 1 &&
        Math.abs(app.width - brand.width) < 1
      );
    })
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByLabel('Resend API key override')).toHaveValue('');
  expect((await api(admin.request, slug).networks.current.query()).name).toBe(
    'Updated Local Network',
  );
  await context.close();
  await admin.request.dispose();
});

test('network branding persists through dashboard and MCP, applies before sign-in, and stays isolated', async ({
  browser,
}) => {
  const admin = await actor('admin');
  const [network] = await db
    .insert(networks)
    .values({ name: 'Branded Market', slug: unique('branded') })
    .returning();
  await db.insert(networkMemberships).values({
    networkId: network!.id,
    userId: admin.id,
    role: 'network_admin',
  });
  const rpc = api(admin.request, network!.slug);
  await db.insert(driverProfiles).values({
    networkId: network!.id,
    userId: admin.id,
    phone: '8055550101',
    vehicle: 'Local van',
    status: 'approved',
  });
  const context = await browser.newContext({
    storageState: await admin.request.storageState(),
  });
  const page = await context.newPage();
  await page.goto(`/?network=${network!.slug}&page=operations&tab=configure`);
  await page.getByLabel('Primary color', { exact: true }).fill('#123456');
  await page.getByLabel('Accent color', { exact: true }).fill('#bc7612');
  await page.getByLabel('Background color', { exact: true }).fill('#eef3fa');
  await page.getByLabel('Text color', { exact: true }).fill('#152030');
  await page.getByLabel('Font', { exact: true }).selectOption('editorial');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN/0AAAAASUVORK5CYII=',
    'base64',
  );
  await page
    .getByLabel('Upload logo')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(238, 243, 250)',
  );
  await expect(page.locator('html')).toHaveCSS('font-family', 'Georgia, serif');
  await expect(page.locator('.brand .network-logo')).toHaveAttribute(
    'src',
    /^data:image\/png;base64,/,
  );
  expect((await rpc.networks.current.query()).branding).toEqual({});
  await page
    .getByRole('button', { name: 'Save branding', exact: true })
    .click();
  await expect(page.getByText('Branding saved', { exact: true })).toBeVisible();
  const logo = page.locator('.brand .network-logo');
  await expect(logo).toHaveAttribute('src', /^data:image\/png;base64,/);
  for (const mode of ['text', 'logo-text', 'logo'] as const) {
    await page.getByLabel('Header display', { exact: true }).selectOption(mode);
    await page
      .getByRole('button', { name: 'Save branding', exact: true })
      .click();
    await expect(
      page.getByText('Branding saved', { exact: true }),
    ).toBeVisible();
    await expect(logo).toHaveCount(mode === 'text' ? 0 : 1);
    await expect(page.locator('.brand')).toHaveText(
      mode === 'logo' ? '' : 'Branded Market',
    );
    const savedBranding = (await rpc.networks.current.query()).branding;
    expect(savedBranding.headerDisplay).toBe(mode);
    expect(savedBranding.logoUrl).toMatch(/^data:image\/png;base64,/);
  }

  expect((await rpc.networks.current.query()).branding).toMatchObject({
    primaryColor: '#123456',
    font: 'editorial',
  });
  await page.reload();
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(238, 243, 250)',
  );
  await expect(page.locator('html')).toHaveCSS('font-family', 'Georgia, serif');
  const activeNavigation = page
    .getByRole('navigation', { name: 'Main navigation' })
    .locator('[aria-current="page"]');
  await expect(activeNavigation).toHaveCSS(
    'background-color',
    'rgb(18, 52, 86)',
  );
  await expect(activeNavigation).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.locator('.brand')).toHaveCSS(
    'font-family',
    'Georgia, serif',
  );
  await expect(
    page.getByRole('button', { name: 'Save branding', exact: true }),
  ).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  const panelBackground = await page
    .locator('.panel')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const destination of [
    'Orders',
    'Profile',
    'Driver',
    'Market',
    'Operations',
  ]) {
    await nav.getByRole('button', { name: destination, exact: true }).click();
    await expect(
      nav.getByRole('button', { name: destination, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('html')).toHaveCSS(
      'background-color',
      'rgb(238, 243, 250)',
    );
    await expect(page.locator('html')).toHaveCSS('color', 'rgb(21, 32, 48)');
    await expect(page.locator('h1').first()).toHaveCSS(
      'font-family',
      'Georgia, serif',
    );
    if (destination !== 'Market')
      await expect(page.locator('.panel').first()).toHaveCSS(
        'background-color',
        panelBackground,
      );
    if (destination === 'Profile') {
      await expect(page.getByLabel('Phone', { exact: true }).first()).toHaveCSS(
        'font-family',
        'Georgia, serif',
      );
      await expect(page.getByLabel('Phone', { exact: true }).first()).toHaveCSS(
        'color',
        'rgb(21, 32, 48)',
      );
    }
  }
  await page.getByRole('button', { name: 'Configure', exact: true }).click();
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(`/?network=${network!.slug}`);
  await expect(publicPage.locator('.brand .network-logo')).toHaveAttribute(
    'alt',
    'Branded Market',
  );
  await expect(publicPage.locator('html')).toHaveCSS(
    'background-color',
    'rgb(238, 243, 250)',
  );
  await publicPage.goto('/');
  await expect(publicPage.locator('html')).toHaveCSS(
    'background-color',
    'rgb(251, 250, 246)',
  );
  await expect(publicPage.locator('.brand .network-logo')).toHaveCount(0);
  const token = await rpc.admin.createToken.mutate({ name: 'Brand editor' });
  const client = new Client({ name: 'branding-e2e', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3101/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${token.token}` } },
    }),
  );
  const result = await client.callTool({
    name: 'update_network',
    arguments: {
      branding: { accentColor: '#654321', headerDisplay: 'logo-text' },
    },
  });
  expect(result.isError).not.toBe(true);
  expect((await rpc.networks.current.query()).branding).toMatchObject({
    primaryColor: '#123456',
    accentColor: '#654321',
    font: 'editorial',
  });
  await rejectCode(
    admin.rpc.networks.update.mutate({
      branding: { logoUrl: 'javascript:alert(1)' },
    }),
    'BAD_REQUEST',
  );
  await rejectCode(
    rpc.networks.update.mutate({
      branding: { primaryColor: 'red;display:none' },
    }),
    'BAD_REQUEST',
  );
  const outsider = await actor();
  await rejectCode(
    api(outsider.request, network!.slug).networks.update.mutate({
      branding: null,
    }),
    'FORBIDDEN',
  );
  await page
    .getByRole('button', { name: 'Reset branding', exact: true })
    .click();
  expect((await rpc.networks.current.query()).branding).not.toEqual({});
  await page
    .getByRole('button', { name: 'Save branding', exact: true })
    .click();
  await expect(
    page.getByText('Default branding restored', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(251, 250, 246)',
  );
  await expect(page.locator('.brand .network-logo')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Branded Market home', exact: true }),
  ).toHaveText('Branded Market');
  expect((await rpc.networks.current.query()).branding).toEqual({});
  await client.close();
  await context.close();
  await publicContext.close();
  await outsider.request.dispose();
  await admin.request.dispose();
});

test('branding previews stay local, cancel restores saved controls, and leaving Configure discards changes', async ({
  browser,
}) => {
  const admin = await actor('admin');
  const [network] = await db
    .insert(networks)
    .values({ name: 'Preview app', slug: unique('preview') })
    .returning();
  await db.insert(networkMemberships).values({
    networkId: network!.id,
    userId: admin.id,
    role: 'network_admin',
  });
  const settings = api(admin.request, network!.slug);
  const context = await browser.newContext({
    storageState: await admin.request.storageState(),
  });
  const page = await context.newPage();
  const publicContext = await browser.newContext(),
    publicPage = await publicContext.newPage();
  try {
    await page.goto(`/?network=${network!.slug}&page=operations&tab=configure`);
    await page.getByLabel('Background color', { exact: true }).fill('#102030');
    await page.getByLabel('Font', { exact: true }).selectOption('editorial');
    await expect(page.locator('html')).toHaveCSS(
      'background-color',
      'rgb(16, 32, 48)',
    );
    await expect(page.locator('.brand')).toHaveCSS(
      'font-family',
      'Georgia, serif',
    );
    await expect(
      page.getByText('Previewing unsaved branding changes', { exact: true }),
    ).toBeVisible();
    expect((await settings.networks.current.query()).branding).toEqual({});
    await publicPage.goto(`/?network=${network!.slug}`);
    await expect(publicPage.locator('html')).toHaveCSS(
      'background-color',
      'rgb(251, 250, 246)',
    );
    await page
      .getByRole('button', { name: 'Cancel changes', exact: true })
      .click();
    await expect(page.locator('html')).toHaveCSS(
      'background-color',
      'rgb(251, 250, 246)',
    );
    await expect(
      page.getByLabel('Background color', { exact: true }),
    ).toHaveValue('#fbfaf6');
    await expect(page.getByLabel('Font', { exact: true })).toHaveValue(
      'default',
    );
    await expect(
      page.getByText('Previewing unsaved branding changes', { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel('Background color', { exact: true }).fill('#102030');
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Orders', exact: true })
      .click();
    await expect(page.locator('html')).toHaveCSS(
      'background-color',
      'rgb(251, 250, 246)',
    );
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Operations', exact: true })
      .click();
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await expect(
      page.getByLabel('Background color', { exact: true }),
    ).toHaveValue('#fbfaf6');
    await page.getByLabel('Background color', { exact: true }).fill('#dceeff');
    await page
      .getByRole('button', { name: 'Save branding', exact: true })
      .click();
    await expect(
      page.getByText('Branding saved', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Previewing unsaved branding changes', { exact: true }),
    ).toHaveCount(0);
    expect(
      (await settings.networks.current.query()).branding.backgroundColor,
    ).toBe('#dceeff');
    await publicPage.reload();
    await expect(publicPage.locator('html')).toHaveCSS(
      'background-color',
      'rgb(220, 238, 255)',
    );
    await page.getByLabel('Background color', { exact: true }).fill('#102030');
    await page
      .getByRole('button', { name: 'Cancel changes', exact: true })
      .click();
    await expect(page.locator('html')).toHaveCSS(
      'background-color',
      'rgb(220, 238, 255)',
    );
    await expect(
      page.getByLabel('Background color', { exact: true }),
    ).toHaveValue('#dceeff');
  } finally {
    await context.close();
    await publicContext.close();
    await admin.request.dispose();
  }
});

test('Configure support and location defaults appear on customer pages without replacing saved addresses', async ({
  browser,
}) => {
  const admin = await actor('admin'),
    customer = await actor();
  const [n] = await db
    .insert(networks)
    .values({
      name: 'New York Basket',
      slug: unique('ny-settings'),
      location: {
        autocompleteBias: {
          postalCode: '10001',
          latitude: 40.71,
          longitude: -74.01,
          radiusMeters: 10000,
        },
      },
    })
    .returning();
  await db.insert(networkMemberships).values([
    { networkId: n!.id, userId: admin.id, role: 'network_admin' },
    { networkId: n!.id, userId: customer.id, role: 'member' },
  ]);
  await db
    .insert(customerProfiles)
    .values({ networkId: n!.id, userId: customer.id });
  const adminContext = await browser.newContext({
    storageState: await admin.request.storageState(),
  });
  const page = await adminContext.newPage();
  const customerContext = await browser.newContext({
    storageState: await customer.request.storageState(),
  });
  const profile = await customerContext.newPage();
  const anonymous = await browser.newContext(),
    publicPage = await anonymous.newPage();
  try {
    await page.goto(`/?network=${n!.slug}&page=operations&tab=configure`);
    await page
      .getByLabel('Support email', { exact: true })
      .fill('help@example.test');
    await page
      .getByLabel('Support phone', { exact: true })
      .fill('+1 212 555 0101');
    await page
      .getByLabel('Contact link', { exact: true })
      .fill('https://example.test/contact');
    await page
      .getByRole('button', { name: 'Save support contact', exact: true })
      .click();
    await expect(
      page.getByText('Support contact saved', { exact: true }),
    ).toBeVisible();
    await page.getByLabel('Default city', { exact: true }).fill('New York');
    await page.getByLabel('Default state', { exact: true }).selectOption('NY');
    await page.getByLabel('Default ZIP code', { exact: true }).fill('10001');
    await page
      .getByLabel('Default timezone', { exact: true })
      .fill('America/New_York');
    await page
      .getByLabel('Search center ZIP code', { exact: true })
      .fill('10001');
    await expect(
      page.getByLabel('Search center latitude', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel('Search center longitude', { exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel('Search radius (meters)', { exact: true })
      .fill('10000');
    await page
      .getByRole('button', { name: 'Save location defaults', exact: true })
      .click();
    await expect(
      page.getByText('Location defaults saved', { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel('Email reply-to address', { exact: true })
      .fill('replies@example.test');
    await page
      .getByRole('button', { name: 'Save app settings', exact: true })
      .click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    expect(
      (await api(admin.request, n!.slug).networks.current.query()).emailReplyTo,
    ).toBe('replies@example.test');
    await profile.goto(`/?network=${n!.slug}&page=profile`);
    await expect(profile.getByLabel('City', { exact: true })).toHaveValue(
      'New York',
    );
    await expect(profile.getByLabel('State', { exact: true })).toHaveValue(
      'NY',
    );
    await expect(profile.getByLabel('ZIP code', { exact: true })).toHaveValue(
      '10001',
    );
    await expect(
      profile
        .locator('main')
        .getByRole('link', { name: 'Email support', exact: true }),
    ).toHaveAttribute('href', 'mailto:help@example.test');
    await profile
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Orders', exact: true })
      .click();
    await expect(
      profile
        .locator('main')
        .getByRole('link', { name: 'Contact us', exact: true }),
    ).toHaveAttribute('href', 'https://example.test/contact');
    await page.getByLabel('Default city', { exact: true }).fill('Brooklyn');
    await page
      .getByRole('button', { name: 'Save location defaults', exact: true })
      .click();
    await expect(
      page.getByText('Location defaults saved', { exact: true }),
    ).toBeVisible();
    expect((await customer.rpc.me.query())!.customer!.city).toBe('Ojai');
    await page.getByRole('button', { name: 'Markets', exact: true }).click();
    await expect(page.getByLabel('IANA timezone', { exact: true })).toHaveValue(
      'America/New_York',
    );
    await publicPage.goto(`/?network=${n!.slug}`);
    await expect(
      publicPage
        .locator('footer')
        .getByRole('link', { name: 'Email support', exact: true }),
    ).toHaveAttribute('href', 'mailto:help@example.test');
    await expect(
      publicPage
        .locator('footer')
        .getByRole('link', { name: '+1 212 555 0101', exact: true }),
    ).toHaveAttribute('href', 'tel:+12125550101');
    const exposed = await api(
      publicPage.request,
      n!.slug,
    ).networks.branding.query();
    expect(exposed).not.toHaveProperty('emailReplyTo');
    expect(exposed).not.toHaveProperty('emailFrom');
    expect(exposed).not.toHaveProperty('emailKeyEncrypted');
    await publicPage.goto('/');
    await expect(
      publicPage.getByRole('link', { name: 'Email support', exact: true }),
    ).toHaveCount(0);
    await rejectCode(
      api(admin.request, n!.slug).networks.update.mutate({
        contactUrl: 'javascript:alert(1)',
      }),
      'BAD_REQUEST',
    );
    await rejectCode(
      api(admin.request, n!.slug).networks.update.mutate({
        contactUrl: 'invalid-url',
      }),
      'BAD_REQUEST',
    );
    await rejectCode(
      api(admin.request, n!.slug).networks.update.mutate({
        location: { timezone: 'Fake/Zone' },
      }),
      'BAD_REQUEST',
    );
    await rejectCode(
      api(customer.request, n!.slug).networks.update.mutate({
        supportEmail: 'bad@example.test',
      }),
      'FORBIDDEN',
    );
  } finally {
    await adminContext.close();
    await customerContext.close();
    await anonymous.close();
    await admin.request.dispose();
    await customer.request.dispose();
  }
});

test('account email identity uses the app name, verified sender and reply-to while Places bias is operator-specific', async () => {
  const { networkEmailConfig } = await import('../../apps/api/src/networks.js');
  const admin = await actor('admin');
  const [n] = await db
    .insert(networks)
    .values({
      name: 'Sonoma Basket',
      slug: unique('identity'),
      supportEmail: 'support@example.test',
      emailReplyTo: 'reply@example.test',
      emailFrom: 'sender@example.test',
    })
    .returning();
  const config = await networkEmailConfig(db, n!.id, {
    secret: randomBytes(32).toString('hex'),
    resendKey: 'mock-key',
    emailFrom: 'platform@example.test',
  });
  const messages: {
    from: string;
    reply_to: string;
    subject: string;
    text: string;
  }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    expect(String(url)).toBe('https://api.resend.com/emails');
    messages.push(JSON.parse(String(options?.body)));
    return Response.json({ id: 'mock' });
  };
  try {
    const auth = createAuth(db, {
      secret: randomBytes(32).toString('hex'),
      baseURL,
      webOrigin: baseURL,
      ...config,
    });
    await db
      .update(user)
      .set({ emailVerified: false })
      .where(eq(user.id, admin.id));
    await auth.api.requestPasswordReset({
      body: {
        email: admin.email,
        redirectTo: baseURL + '/?network=' + n!.slug + '&reset=1',
      },
    });
    await auth.api.sendVerificationEmail({
      body: {
        email: admin.email,
        callbackURL: baseURL + '/?network=' + n!.slug,
      },
    });
    expect(messages.map((m) => m.subject)).toEqual([
      'Reset your Sonoma Basket password',
      'Verify your Sonoma Basket email',
    ]);
    for (const message of messages) {
      expect(message.from).toBe('"Sonoma Basket" <sender@example.test>');
      expect(message.reply_to).toBe('reply@example.test');
      expect(message.text).toContain('Sonoma Basket');
    }
    await db
      .update(networks)
      .set({ emailReplyTo: null })
      .where(eq(networks.id, n!.id));
    expect(
      (await networkEmailConfig(db, n!.id, { secret: 'test' })).emailReplyTo,
    ).toBe('support@example.test');
  } finally {
    globalThis.fetch = originalFetch;
    await db
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.id, admin.id));
    await admin.request.dispose();
  }
  const bias = { latitude: 38.29, longitude: -122.46, radiusMeters: 15000 };
  await suggestAddresses(
    '10 Main',
    randomUUID(),
    'mock',
    async (_url, options) => {
      expect(JSON.parse(String(options?.body)).locationBias).toEqual({
        circle: {
          center: { latitude: bias.latitude, longitude: bias.longitude },
          radius: 15000,
        },
      });
      return Response.json({ suggestions: [] });
    },
    { autocompleteBias: bias },
  );
});

test('MCP resolves search ZIPs on the backend, reuses saved coordinates, and preserves settings when lookup fails', async () => {
  const Fastify: typeof import('fastify').default = createRequire(
    import.meta.url,
  )('fastify');
  const admin = await actor('admin');
  const [n] = await db
    .insert(networks)
    .values({ name: 'ZIP search app', slug: unique('zip-search') })
    .returning();
  await db
    .insert(networkMemberships)
    .values({ networkId: n!.id, userId: admin.id, role: 'network_admin' });
  const settings = api(admin.request, n!.slug);
  const { token } = await settings.admin.createToken.mutate({
    name: 'ZIP configuration',
  });
  const server = Fastify();
  registerMcp(server, db, baseURL);
  const previousFetch = globalThis.fetch;
  const requested: string[] = [];
  let mode: 'ok' | 'missing' | 'invalid' | 'outage' = 'ok';
  globalThis.fetch = async (url, options) => {
    requested.push(String(url));
    expect(String(url)).toMatch(/^https:\/\/api\.zippopotam\.us\/us\/\d{5}$/);
    expect(options?.signal).toBeDefined();
    if (mode === 'outage') throw new Error('Provider unavailable');
    if (mode === 'missing') return Response.json({}, { status: 404 });
    const zip = new URL(String(url)).pathname.split('/').at(-1);
    return Response.json({
      'post code': zip,
      'country abbreviation': 'US',
      places: [
        {
          latitude: mode === 'invalid' ? 'invalid' : '34.448',
          longitude: '-119.243',
        },
      ],
    });
  };
  const call = async (arguments_: object) => {
    const response = await server.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'update_network', arguments: arguments_ },
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().result;
  };
  try {
    const result = await call({
      location: {
        autocompleteBias: { postalCode: '93023', radiusMeters: 30000 },
      },
    });
    expect(result.isError).not.toBe(true);
    expect(requested).toEqual(['https://api.zippopotam.us/us/93023']);
    expect(
      (await settings.networks.current.query()).location.autocompleteBias,
    ).toEqual({
      postalCode: '93023',
      latitude: 34.448,
      longitude: -119.243,
      radiusMeters: 30000,
    });
    await call({
      location: {
        autocompleteBias: { postalCode: '93023', radiusMeters: 12000 },
      },
    });
    expect(requested).toHaveLength(1);
    expect(
      (await settings.networks.current.query()).location.autocompleteBias
        ?.radiusMeters,
    ).toBe(12000);
    for (const failure of ['missing', 'invalid', 'outage'] as const) {
      mode = failure;
      const failed = await call({
        name: 'Must not save',
        location: {
          autocompleteBias: { postalCode: '10001', radiusMeters: 10000 },
        },
      });
      expect(failed.isError).toBe(true);
      expect(JSON.parse(failed.content[0].text).code).toBe(
        failure === 'missing' ? 'BAD_REQUEST' : 'BAD_GATEWAY',
      );
      expect(await settings.networks.current.query()).toMatchObject({
        name: 'ZIP search app',
        location: {
          autocompleteBias: {
            postalCode: '93023',
            latitude: 34.448,
            longitude: -119.243,
            radiusMeters: 12000,
          },
        },
      });
    }
    const count = requested.length;
    expect(
      (
        await call({
          location: {
            autocompleteBias: { latitude: 0, longitude: 0, radiusMeters: 5000 },
          },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await call({
          location: {
            autocompleteBias: { postalCode: 'bad', radiusMeters: 5000 },
          },
        })
      ).isError,
    ).toBe(true);
    expect(requested).toHaveLength(count);
    expect(
      (await call({ location: { autocompleteBias: null } })).isError,
    ).not.toBe(true);
    expect(
      (await settings.networks.current.query()).location.autocompleteBias,
    ).toBeNull();
    expect(requested).toHaveLength(count);
  } finally {
    globalThis.fetch = previousFetch;
    await server.close();
    await admin.request.dispose();
  }
});
