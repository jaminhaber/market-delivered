import { fileURLToPath } from 'node:url';
import { createDatabase, runMigrations, type Database } from '@market/db';
import { attachDatabasePool } from '@vercel/functions';
import { parseEnvironment } from './config.js';
import type { FastifyInstance } from 'fastify';

export async function startServer(
  create: (
    db: Database,
    env: ReturnType<typeof parseEnvironment>,
  ) => Promise<FastifyInstance>,
) {
  const env = parseEnvironment(process.env);
  const { db, pool } = createDatabase(env.DATABASE_URL);
  if (process.env.VERCEL === '1') attachDatabasePool(pool);
  pool.on('error', () => console.error('Unexpected database pool error'));
  try {
    await runMigrations(
      db,
      fileURLToPath(new URL('../../../packages/db/drizzle', import.meta.url)),
    );
    const server = await create(db, env);
    server.addHook('onClose', async () => {
      await pool.end();
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void server.close().catch(() => {
          process.exitCode = 1;
        });
      });
    // Vercel captures this listener; do not await listen during module import.
    void server
      .listen({
        host: env.API_HOST,
        port: env.API_PORT,
      })
      .catch(async (error: unknown) => {
        server.log.error(error);
        await server.close();
        process.exitCode = 1;
      });
    return server;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
