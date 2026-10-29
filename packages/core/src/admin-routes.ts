import type { FastifyInstance, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { Database } from '@market/db';
import { adminRouter } from './admin-router.js';
import { createAuth, type AuthConfig } from './auth.js';
import { permissions } from './networks.js';
import { webOrigins } from './origins.js';
import { forwardAuth } from './http.js';

export async function registerAdminRoutes(
  server: FastifyInstance,
  db: Database,
  config: AuthConfig & { networkSecret: string },
) {
  const auth = createAuth(db, {
    ...config,
    surface: 'admin',
    basePath: '/admin/auth',
    cookiePrefix: 'md-admin',
    appName: 'Market Delivered',
  });
  const origins = webOrigins(config);
  await server.register(cors, {
    origin: origins,
    credentials: true,
    exposedHeaders: ['WWW-Authenticate'],
  });
  server.addHook('onRequest', async (request, reply) => {
    if (request.headers.origin && !origins.includes(request.headers.origin))
      return reply.code(403).send({ error: 'Origin not allowed' });
  });
  server.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    handler: (request, reply) =>
      forwardAuth(auth, config.baseURL, request, reply),
  });
  await server.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: adminRouter,
      createContext: async ({ req }: { req: FastifyRequest }) => {
        const current = await auth.api.getSession({
          headers: fromNodeHeaders(req.headers),
        });
        const access = current ? await permissions(db, current.user.id) : null;
        return {
          db,
          secret: config.networkSecret,
          production: config.production,
          actor:
            current && access
              ? {
                  id: current.user.id,
                  name: current.user.name,
                  email: current.user.email,
                  ...access,
                  admin: access.globalAdmin,
                }
              : null,
        };
      },
    },
  });
}
