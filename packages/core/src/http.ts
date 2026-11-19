import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { TRPCError } from '@trpc/server';
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '@market/db';
import type { Auth } from './auth.js';
import { CLIENT_IP_HEADER, requestClientIp } from './client-ip.js';
import { createRequestBudget } from './rate-limit.js';
import { cachedRead } from './read-cache.js';

export const RPC_BATCH_LIMIT = 10;

export function logRequestPath(url = '') {
  try {
    return decodeURIComponent(url.split('?')[0]!).replace(
      /(\/reset-password\/).*$/is,
      '$1[REDACTED]',
    );
  } catch {
    return '/[UNPARSEABLE_PATH]';
  }
}

export function createHttpServer(db: Database) {
  const budget = createRequestBudget();
  const enforceBudget = process.env.NODE_ENV !== 'test';
  const ready = cachedRead(async () => {
    try {
      await db.execute(sql`select 1` as SQL);
      return true;
    } catch {
      return false;
    }
  }, 1000);
  const server = Fastify({
    logger: {
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: logRequestPath(request.url),
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
  server.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );
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
    const ip = requestClientIp(request);
    request.headers[CLIENT_IP_HEADER] = ip;
    const path = request.url.split('?')[0]!;
    if (path === '/health') return;
    const rpc = /^\/(?:admin\/)?trpc\/(.+)$/.exec(path);
    let procedures: string[] = [];
    try {
      procedures = rpc ? decodeURIComponent(rpc[1]!).split(',') : [];
    } catch {
      return reply.code(400).send({ error: 'Invalid RPC path' });
    }
    const count = procedures.length || 1;
    if (count > RPC_BATCH_LIMIT)
      return reply
        .header('Cache-Control', 'no-store')
        .code(400)
        .send({ error: 'RPC batch exceeds maximum size' });
    const cost =
      count *
      (path === '/ready' ||
      path.startsWith('/api/public/') ||
      procedures.includes('invitation')
        ? 5
        : 1);
    const retryAfter = enforceBudget ? budget(ip, cost) : 0;
    if (retryAfter)
      return reply
        .header('Cache-Control', 'no-store')
        .header('Retry-After', retryAfter)
        .code(429)
        .send({ error: 'Too many requests. Please try again shortly.' });
  });
  server.get('/health', async () => ({ status: 'ok' }));
  server.get('/ready', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return (await ready())
      ? { status: 'ok' }
      : reply.code(503).send({ status: 'unavailable' });
  });
  return server;
}
export async function forwardAuth(
  auth: Auth,
  baseURL: string,
  request: FastifyRequest,
  reply: FastifyReply,
  path = request.url,
) {
  const response = await auth.handler(
    new Request(new URL(path, baseURL), {
      method: request.method,
      headers: fromNodeHeaders(request.headers),
      ...(request.body
        ? {
            body:
              typeof request.body === 'string'
                ? request.body
                : JSON.stringify(request.body),
          }
        : {}),
    }),
  );
  reply.code(response.status);
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') reply.header(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) reply.header('set-cookie', cookies);
  const body = await response.text();
  if (
    request.method === 'GET' &&
    path.split('?')[0]?.endsWith('/oauth2/authorize') &&
    response.ok &&
    response.headers.get('content-type')?.includes('application/json')
  ) {
    const result = JSON.parse(body);
    if (result.redirect === true && typeof result.url === 'string')
      return reply.code(303).redirect(result.url);
  }
  return reply.send(body);
}
