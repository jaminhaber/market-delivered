import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { runMarketRunsJob, type Database } from '@market/db';
export function registerJobs(
  server: FastifyInstance,
  db: Database,
  secret?: string,
) {
  server.get('/internal/jobs/market-runs', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!secret)
      return reply
        .code(503)
        .send({ error: 'Scheduled jobs are not configured' });
    const digest = (value: string) =>
      createHash('sha256').update(value).digest();
    if (
      !timingSafeEqual(
        digest(request.headers.authorization ?? ''),
        digest(`Bearer ${secret}`),
      )
    )
      return reply.code(401).send({ error: 'Unauthorized' });
    const result = await runMarketRunsJob(db, 'cron');
    server.log.info(
      { job: 'generate-market-runs', ...result },
      'Scheduled job finished',
    );
    return result;
  });
}
