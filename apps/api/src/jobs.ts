import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  runMarketRunsJob,
  runCloseMarketsJob,
  type Database,
} from '@market/db';
export function registerJobs(
  server: FastifyInstance,
  db: Database,
  secret?: string,
) {
  for (const [path, job, run] of [
    ['/internal/jobs/market-runs', 'generate-market-runs', runMarketRunsJob],
    [
      '/internal/jobs/close-markets',
      'close-expired-markets',
      runCloseMarketsJob,
    ],
  ] as const)
    server.get(path, async (request, reply) => {
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
      const result = await run(db, 'cron');
      server.log.info({ job, ...result }, 'Scheduled job finished');
      return result;
    });
}
