import { startServer } from '@market/core/runtime';
import { createServer } from '@market/core/server';
import { registerMcp } from '@market/mcp';
await startServer((db, env) =>
  createServer(
    db,
    {
      secret: env.BETTER_AUTH_SECRET,
      adminSecret: env.ADMIN_AUTH_SECRET,
      adminOrigin: env.ADMIN_ORIGIN,
      production: process.env.NODE_ENV === 'production',
      resendKey: env.RESEND_API_KEY,
      emailFrom: env.EMAIL_FROM,
      cronSecret: env.CRON_SECRET,
      googleMapsKey: env.GOOGLE_MAPS_API_KEY,
      images:
        env.CLOUDFLARE_ACCOUNT_ID &&
        env.CLOUDFLARE_IMAGES_API_TOKEN &&
        env.CLOUDFLARE_IMAGES_DELIVERY_HASH
          ? {
              accountId: env.CLOUDFLARE_ACCOUNT_ID,
              apiToken: env.CLOUDFLARE_IMAGES_API_TOKEN,
              deliveryHash: env.CLOUDFLARE_IMAGES_DELIVERY_HASH,
            }
          : undefined,
    },
    registerMcp,
  ),
);
