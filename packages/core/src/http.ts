import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { TRPCError } from '@trpc/server';
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '@market/db';
import type { Auth } from './auth.js';

export function createHttpServer(db: Database) {
  const server = Fastify({
    logger: {
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url?.split('?')[0],
            host: request.hostname,
            remoteAddress: request.ip,
          };
        },
      },
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-invite-token',
        'req.body',
        'res.headers["set-cookie"]',
      ],
    },
    bodyLimit: 1024 * 1024,
  });
  server.setErrorHandler((error, _request, reply) => {
    const problem =
      error instanceof Error ? error : new Error('Request failed');
    const trpcStatus =
      problem instanceof TRPCError
        ? (
            {
              BAD_REQUEST: 400,
              UNAUTHORIZED: 401,
              FORBIDDEN: 403,
              NOT_FOUND: 404,
              CONFLICT: 409,
              PRECONDITION_FAILED: 412,
            } as Record<string, number>
          )[problem.code]
        : undefined;
    const status =
      trpcStatus ||
      ('statusCode' in problem && typeof problem.statusCode === 'number'
        ? problem.statusCode
        : 500);
    if (status >= 500) server.log.error({ err: problem }, 'Request failed');
    return reply.code(status).send({
      error:
        status >= 500 ? 'Unable to complete the request.' : problem.message,
    });
  });
  server.addHook('onRequest', async (request, reply) => {
    if (
      request.url.startsWith('/trpc') ||
      request.url.startsWith('/api/auth/') ||
      request.url.startsWith('/admin/')
    )
      reply.header('Cache-Control', 'no-store');
  });
  server.get('/health', async () => ({ status: 'ok' }));
  server.get('/ready', async (_request, reply) => {
    try {
      await db.execute(sql`select 1` as SQL);
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  return server;
}
export async function forwardAuth(
  auth: Auth,
  baseURL: string,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const response = await auth.handler(
    new Request(new URL(request.url, baseURL), {
      method: request.method,
      headers: fromNodeHeaders(request.headers),
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    }),
  );
  reply.code(response.status);
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') reply.header(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) reply.header('set-cookie', cookies);
  return reply.send(await response.text());
}
