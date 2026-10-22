import { createDatabase } from '@market/db';
import { attachDatabasePool } from '@vercel/functions';
import { env } from './env.js';
import { createServer } from './server.js';

const { db, pool } = createDatabase(env.DATABASE_URL);
if (process.env.VERCEL === '1') attachDatabasePool(pool);
pool.on('error', (error) =>
  console.error('Unexpected database pool error', error),
);
const server = await createServer(db, {
  cronSecret: env.CRON_SECRET,
  googleMapsKey: env.GOOGLE_MAPS_API_KEY,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  webOrigin: env.WEB_ORIGIN,
  resendKey: env.RESEND_API_KEY,
  emailFrom: env.EMAIL_FROM,
  production: process.env.NODE_ENV === 'production',
});
server.addHook('onClose', async () => {
  await pool.end();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}
try {
  await server.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  server.log.error(error);
  await server.close();
  process.exitCode = 1;
}
