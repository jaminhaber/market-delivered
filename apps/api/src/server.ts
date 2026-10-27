import { TRPCError } from '@trpc/server';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { sql, eq, asc, and, isNull } from 'drizzle-orm';
import {
  networkMemberships,
  networks,
  user,
  verification,
  type Database,
} from '@market/db';
import { appRouter } from './router.js';
import { createAuth, type AuthConfig } from './auth.js';
import {
  permissions,
  findNetwork,
  networkOperations,
  networkEmailConfig,
  publicNetworkColumns,
} from './networks.js';
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
        'req.body',
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
      const selector = request.headers['x-network-id'];
      const network = await findNetwork(
        db,
        typeof selector === 'string' ? selector : undefined,
      );
      if (!network) {
        const current = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        const body = request.body as
          { email?: string; token?: string } | undefined;
        let userId = current?.user.id;
        if (typeof body?.email === 'string') {
          const [person] = await db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, body.email.toLowerCase()));
          userId = person?.id;
        } else if (typeof body?.token === 'string') {
          const [reset] = await db
            .select()
            .from(verification)
            .where(eq(verification.identifier, `reset-password:${body.token}`));
          userId = reset?.value;
        }
        if (!userId || !(await permissions(db, userId)).globalAdmin)
          return reply.code(404).send({ error: 'No network configured' });
      }
      const email = network
        ? await networkEmailConfig(db, network.id, config)
        : config;
      const networkAuth = createAuth(db, { ...config, ...email });
      const response = await networkAuth.handler(
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
        const selector = req.headers['x-network-id'];
        const network = await findNetwork(
          db,
          typeof selector === 'string' ? selector : undefined,
        );
        const access = current
          ? await permissions(db, current.user.id, network?.id)
          : { globalAdmin: false, networkAdmin: false, member: false };
        if (!network && !access.globalAdmin)
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'No network configured',
          });
        const actor = current
          ? {
              id: current.user.id,
              name: current.user.name,
              email: current.user.email,
              ...access,
              admin: access.globalAdmin || access.networkAdmin,
            }
          : null;
        return {
          db,
          network,
          actor,
          googleMapsKey: config.googleMapsKey,
          networkOps: networkOperations(
            db,
            actor || { id: '' },
            network?.id ?? null,
            config.secret,
          ),
          accessibleNetworks: async () =>
            !actor
              ? network
                ? [{ id: network.id, name: network.name, slug: network.slug }]
                : []
              : actor.globalAdmin
                ? db
                    .select(publicNetworkColumns)
                    .from(networks)
                    .where(isNull(networks.deletedAt))
                    .orderBy(asc(networks.name))
                : db
                    .select(publicNetworkColumns)
                    .from(networkMemberships)
                    .innerJoin(
                      networks,
                      eq(networkMemberships.networkId, networks.id),
                    )
                    .where(
                      and(
                        eq(networkMemberships.userId, actor.id),
                        isNull(networks.deletedAt),
                      ),
                    )
                    .orderBy(asc(networks.name)),
        };
      },
      onError({ error, path }: { error: TRPCError; path: string | undefined }) {
        if (error.code === 'INTERNAL_SERVER_ERROR')
          server.log.error({ err: error, path }, 'API request failed');
      },
    },
  });
  registerMcp(server, db, config.webOrigin, config);
  registerJobs(server, db, config.cronSecret);
  return server;
}
