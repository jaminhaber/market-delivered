import type { TRPCError } from '@trpc/server';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { sql } from 'drizzle-orm';
import type { Database } from '@market/db';
import { appRouter } from './router.js';
import { createAuth, type AuthConfig } from './auth.js';
import { isAdmin } from './queries.js';
import { registerJobs } from './jobs.js';
import { registerMcp } from './mcp.js';
import { webOrigins } from './origins.js';
export async function createServer(
  db: Database,
  config: AuthConfig & { cronSecret?: string; googleMapsKey?: string },
) {
  const server = Fastify({
    logger: {
      // Query inputs can contain invitation or reset tokens. Never log query strings.
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
        'res.headers["set-cookie"]',
      ],
    },
    bodyLimit: 1024 * 1024,
  });
  server.setErrorHandler((error, _request, reply) => {
    server.log.error({ err: error }, 'Request failed');
    const problem =
      error instanceof Error ? error : new Error('Request failed');
    const code = 'statusCode' in problem ? problem.statusCode : 500;
    const status =
      typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    return reply.code(status).send({
      error:
        status === 500 ? 'Unable to complete the request.' : problem.message,
    });
  });
  const auth = createAuth(db, config);
  const origins = webOrigins(config);
  await server.register(cors, { origin: origins, credentials: true });
  server.addHook('onRequest', async (request, reply) => {
    const browserEndpoint =
      request.url.startsWith('/trpc') || request.url.startsWith('/api/auth/');
    if (browserEndpoint) reply.header('Cache-Control', 'no-store');
    if (
      browserEndpoint &&
      request.method === 'POST' &&
      request.headers.origin &&
      !origins.includes(request.headers.origin)
    )
      return reply.code(403).send({ error: 'Origin not allowed' });
  });
  server.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const response = await auth.handler(
        new Request(new URL(request.url, config.baseURL), {
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
    },
  });
  server.get('/health', async () => ({ status: 'ok' }));
  server.get('/ready', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ok' };
    } catch (error) {
      server.log.error({ err: error }, 'Database unavailable');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  await server.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: async ({
        req,
      }: {
        req: { headers: Parameters<typeof fromNodeHeaders>[0] };
      }) => {
        const current = await auth.api.getSession({
          headers: fromNodeHeaders(req.headers),
        });
        return {
          db,
          googleMapsKey: config.googleMapsKey,
          actor: current
            ? {
                id: current.user.id,
                name: current.user.name,
                email: current.user.email,
                admin: await isAdmin(db, current.user.id),
              }
            : null,
        };
      },
      onError({ error, path }: { error: TRPCError; path: string | undefined }) {
        if (error.code === 'INTERNAL_SERVER_ERROR')
          server.log.error({ err: error, path }, 'API request failed');
      },
    },
  });
  registerMcp(server, db, config.webOrigin);
  registerJobs(server, db, config.cronSecret);
  return server;
}
