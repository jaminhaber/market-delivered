import { test, expect, type Locator } from '@playwright/test';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createDatabase, invitations } from '@market/db';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const origin = 'http://localhost:4322';
const databaseURL =
  process.env.E2E_DATABASE_URL ||
  'postgresql://market:market@localhost:5433/market_delivered_e2e';
if (!new URL(databaseURL).pathname.endsWith('_e2e'))
  throw new Error('An isolated E2E database is required');

async function insideViewport(locator: Locator, width: number) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
}

for (const viewport of [
  { width: 320, height: 740 },
  { width: 402, height: 874 },
  { width: 1440, height: 900 },
]) {
  for (const signedIn of [false, true]) {
    test(`${viewport.width}px homepage layout ${signedIn ? 'with profile' : 'signed out'}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      if (signedIn) {
        const { db, pool } = createDatabase(databaseURL);
        const email = `layout-${randomUUID()}@example.test`;
        const token = randomBytes(32).toString('hex');
        try {
          await db.insert(invitations).values({
            networkId: '00000000-0000-4000-8000-000000000002',
            email,
            role: 'customer',
            tokenHash: createHash('sha256').update(token).digest('hex'),
            expiresAt: new Date(Date.now() + 86400000),
          });
          const response = await page.request.post(
            origin + '/api/auth/sign-up/email',
            {
              headers: { Origin: origin, 'X-Invite-Token': token },
              data: {
                email,
                password: 'Layout-test-password-123!',
                name: 'Benjamin Shopper',
              },
            },
          );
          expect(response.status(), await response.text()).toBe(200);
        } finally {
          await pool.end();
        }
      }
      const screenshotDir = join(
        'artifacts/playwright',
        testInfo.project.name,
        `${viewport.width}px`,
        signedIn ? 'logged-in' : 'logged-out',
      );
      await mkdir(screenshotDir, { recursive: true });
      async function saveScreenshot(name: string) {
        const path = join(screenshotDir, `${name}.png`);
        await page.screenshot({ path, fullPage: true });
        await testInfo.attach(name, { path, contentType: 'image/png' });
      }
      await page.goto(origin);
      await page
        .locator('.hero-image')
        .evaluate(async (image: HTMLImageElement) => image.decode());
      await saveScreenshot('home');
      const nav = page.getByRole('navigation', { name: 'Main navigation' });
      const controls = nav.locator(':scope > a, :scope > details > summary');
      for (const control of await controls.all()) {
        await insideViewport(control, viewport.width);
      }
      const home = page.locator('.home-link');
      await insideViewport(home, viewport.width);
      const homeBox = (await home.boundingBox())!;
      const navBox = (await nav.boundingBox())!;
      expect(
        homeBox.x + homeBox.width <= navBox.x + 1 ||
          homeBox.y + homeBox.height <= navBox.y + 1,
      ).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(viewport.width);
      await insideViewport(
        page.getByRole('heading', { name: 'Fresh produce. Delivered.' }),
        viewport.width,
      );
      for (const action of await page.locator('.hero-actions a').all()) {
        await insideViewport(action, viewport.width);
      }
      // A DOM visibility assertion passes even when Safari paints a solid
      // rectangle. Compare the lettering itself, without platform-specific fonts.
      await expect(
        page.getByRole('img', { name: 'Silverstreak Produce', exact: true }),
      ).toHaveScreenshot(`logo-${viewport.width}.png`, {
        maxDiffPixelRatio: 0.02,
      });
      if (signedIn) {
        await page.getByText('Hello Benjamin').click();
        await insideViewport(
          page.getByRole('link', { name: 'Manage account' }),
          viewport.width,
        );
        await insideViewport(
          page.getByRole('link', { name: 'See orders' }),
          viewport.width,
        );
      }
      if (signedIn) await saveScreenshot('home-profile-menu');
    });
  }
}
