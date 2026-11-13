import { test, expect } from '@playwright/test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { join } from 'node:path';
import {
  createDatabase,
  invitations,
  driverProfiles,
  customerProfiles,
  markets,
  marketRuns,
  farms,
  produce,
  inventory,
  orders,
  orderItems,
  user as users,
  networkMemberships,
} from '@market/db';

const origin = 'http://localhost:4322';
const networkId = '00000000-0000-4000-8000-000000000002';
const databaseURL =
  process.env.E2E_DATABASE_URL ||
  'postgresql://market:market@localhost:5433/market_delivered_e2e';
if (!new URL(databaseURL).pathname.endsWith('_e2e'))
  throw new Error('An isolated E2E database is required');

for (const width of [402, 1440]) {
  for (const count of [0, 1, 3]) {
    test(`${width}px driver with ${count} orders`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: width === 402 ? 874 : 1000 });
      const { db, pool } = createDatabase(databaseURL);
      const email = `driver-${randomUUID()}@example.test`;
      const token = randomBytes(32).toString('hex');
      try {
        await db.insert(invitations).values({
          networkId,
          email,
          role: 'driver',
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 86400000),
        });
        const signup = await page.request.post(
          origin + '/api/auth/sign-up/email',
          {
            headers: { Origin: origin, 'X-Invite-Token': token },
            data: {
              email,
              password: 'Driver-layout-password-123!',
              name: 'Jamie Driver',
            },
          },
        );
        expect(signup.status(), await signup.text()).toBe(200);
        const { user } = await signup.json();
        await db
          .insert(driverProfiles)
          .values({
            networkId,
            userId: user.id,
            status: 'approved',
            phone: '8055550100',
            vehicle: 'Blue hatchback',
          })
          .onConflictDoUpdate({
            target: [driverProfiles.networkId, driverProfiles.userId],
            set: {
              status: 'approved',
              phone: '8055550100',
              vehicle: 'Blue hatchback',
            },
          });
        await db
          .insert(customerProfiles)
          .values({ networkId, userId: user.id })
          .onConflictDoNothing();
        const [market] = await db
          .insert(markets)
          .values({
            networkId,
            name: 'Ojai Farmers Market',
            address: '300 E Matilija Street, Ojai, CA',
          })
          .returning();
        const now = Date.now();
        const [run] = await db
          .insert(marketRuns)
          .values({
            networkId,
            marketId: market!.id,
            cutoffAt: new Date(now - 7200000),
            startsAt: new Date(now - 3600000),
            endsAt: new Date(now + 7200000),
            deliveryStartAt: new Date(now + 7200000),
            deliveryEndAt: new Date(now + 14400000),
            deliveryFeeCents: 500,
          })
          .returning();
        const [farm] = await db
          .insert(farms)
          .values({
            networkId,
            name: 'Sunrise Family Farm',
            location: 'Ojai, CA',
            contactPhone: '8055550123',
            notes: 'Look for the green canopy.',
          })
          .returning();
        const [product] = await db
          .insert(produce)
          .values({
            networkId,
            farmId: farm!.id,
            name: 'Rainbow carrots',
            description: 'Freshly harvested carrots',
            category: 'Vegetables',
            unit: 'bunch',
            priceCents: 350,
          })
          .returning();
        const [stock] = await db
          .insert(inventory)
          .values({
            networkId,
            runId: run!.id,
            produceId: product!.id,
            priceCents: 350,
            quantity: 30,
            reservedQuantity: count * 2,
          })
          .returning();
        for (let index = 0; index < count; index++) {
          const customerId = randomUUID();
          const customerName = ['Alex Rivera', 'Morgan Lee', 'Sam Taylor'][
            index
          ]!;
          await db.insert(users).values({
            id: customerId,
            name: customerName,
            email: `${customerId}@example.test`,
          });
          await db
            .insert(networkMemberships)
            .values({ networkId, userId: customerId });
          await db
            .insert(customerProfiles)
            .values({ networkId, userId: customerId });
          const [order] = await db
            .insert(orders)
            .values({
              networkId,
              customerId,
              runId: run!.id,
              requestId: randomUUID(),
              customerName,
              phone: '8055550142',
              address: `${120 + index * 10} Oak Street, Ojai, CA 93023`,
              city: 'Ojai',
              postalCode: '93023',
              deliveryNotes: 'Leave by the green front door.',
              deliveryFeeCents: 500,
              estimatedTotalCents: 1200,
            })
            .returning();
          await db.insert(orderItems).values({
            networkId,
            orderId: order!.id,
            inventoryId: stock!.id,
            farmId: farm!.id,
            farmName: farm!.name,
            farmLocation: farm!.location,
            name: product!.name,
            unit: 'bunch',
            quantity: 2,
            priceCents: 350,
          });
        }
        const dir = join(
          'artifacts/playwright/driver',
          testInfo.project.name,
          `${width}px`,
          `${count}-orders`,
        );
        await mkdir(dir, { recursive: true });
        async function capture(name: string) {
          await expect(page.locator('#driver-root')).not.toContainText(
            'Gathering your market details',
          );
          await expect(
            page.locator('#driver-root [role="alert"]:visible'),
          ).toHaveCount(0);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width);
          await page.evaluate(() => window.scrollTo(0, 0));
          const path = join(dir, `${name}.png`);
          await page.screenshot({
            path,
            fullPage: true,
            style: 'astro-dev-toolbar { display: none !important; }',
          });
          await testInfo.attach(name, { path, contentType: 'image/png' });
        }
        await page.goto(origin + '/account');
        const profile = page.getByRole('form', {
          name: 'Driver profile',
          exact: true,
        });
        await profile.getByLabel('Driver phone').fill('8055550100');
        await profile.getByLabel('Vehicle').fill('Green cargo van');
        await profile
          .getByRole('button', { name: 'Save driver profile' })
          .click();
        await expect(page.getByRole('status')).toContainText('saved');
        await page.goto(origin + '/');
        await page.locator('.profile-menu summary').click();
        await page.getByRole('link', { name: 'Driver', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'No active trip' }),
        ).toBeVisible();
        await capture('empty');
        await page
          .getByRole('button', { name: 'Find orders', exact: true })
          .click();
        await expect(
          page.getByRole('heading', { name: 'Find orders', exact: true }),
        ).toBeVisible();
        if (await page.getByLabel('Filter by market').count())
          await page.getByLabel('Filter by market').selectOption(market!.id);
        await expect(page.locator('.driver-order-row')).toHaveCount(count);
        await capture('available');
        if (!count) {
          await expect(
            page.getByRole('heading', { name: 'No orders available' }),
          ).toBeVisible();
          await db
            .update(driverProfiles)
            .set({ status: 'suspended' })
            .where(
              and(
                eq(driverProfiles.networkId, networkId),
                eq(driverProfiles.userId, user.id),
              ),
            );
          const denied = await page.goto(origin + '/driver');
          expect(denied!.status()).toBe(403);
          await expect(page.getByRole('alert')).toContainText(
            'approved driver profile',
          );
          expect(
            (
              await page.request.get(origin + '/trpc/driver.workspace')
            ).status(),
          ).toBe(403);
          return;
        }
        await page.getByLabel('Select all shown orders').check();
        await capture('selected');
        await page
          .getByRole('button', {
            name: `Claim selected (${count})`,
            exact: true,
          })
          .click();
        await expect(
          page.getByRole('button', { name: 'Start shopping', exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('navigation', { name: 'Trip progress' }),
        ).toBeVisible();
        await expect(page.getByLabel('Your trips')).toHaveCount(0);
        await capture('my-trip');
        if (count === 1) {
          await page.getByText('View orders (1)', { exact: true }).click();
          await page
            .getByRole('button', { name: 'Release order for Alex Rivera' })
            .click();
          await expect(
            page.getByRole('heading', { name: 'No active trip' }),
          ).toBeVisible();
          await page
            .getByRole('button', { name: 'Find orders', exact: true })
            .click();
          await page
            .getByRole('button', { name: 'Claim order', exact: true })
            .click();
        }
        await page
          .getByRole('button', { name: 'Start shopping', exact: true })
          .click();
        await expect(
          page.getByLabel('Combined cost for Rainbow carrots'),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Finish shopping', exact: true }),
        ).toBeDisabled();
        await page
          .getByLabel('Combined cost for Rainbow carrots')
          .fill(String(count * 5));
        await page
          .getByRole('button', { name: 'Record purchase', exact: true })
          .click();
        await expect(
          page.getByText('Saved · ' + count * 2 + ' bunch', { exact: false }),
        ).toBeVisible();
        await capture('shop');
        await page.reload();
        await expect(
          page.getByRole('button', { name: 'Finish shopping', exact: true }),
        ).toBeEnabled();
        await page
          .getByRole('button', { name: 'Finish shopping', exact: true })
          .click();
        await expect(
          page.getByRole('heading', { name: 'Pack Alex Rivera’s bag' }),
        ).toBeVisible();
        await capture('pack');
        for (let index = 0; index < count; index++) {
          const name = ['Alex Rivera', 'Morgan Lee', 'Sam Taylor'][index]!;
          await expect(
            page.getByRole('heading', { name: `Pack ${name}’s bag` }),
          ).toBeVisible();
          await page
            .getByRole('button', { name: 'Bag packed', exact: true })
            .click();
        }
        await expect(
          page.getByRole('button', {
            name: 'Collected $12.00 · Complete delivery',
            exact: true,
          }),
        ).toBeVisible();
        await capture('deliver');
        for (let index = 0; index < count; index++) {
          const name = ['Alex Rivera', 'Morgan Lee', 'Sam Taylor'][index]!;
          await expect(
            page.getByRole('heading', { name, exact: true }),
          ).toBeVisible();
          await page
            .getByRole('button', {
              name: 'Collected $12.00 · Complete delivery',
              exact: true,
            })
            .click();
        }
        await expect(
          page.getByRole('heading', { name: 'Trip complete' }),
        ).toBeVisible();
        await capture('complete');
      } finally {
        await pool.end();
      }
    });
  }
}

test('driver screen requires an approved account', async ({ page }) => {
  await page.goto(origin + '/driver');
  await expect(page).toHaveURL(origin + '/account');
});
