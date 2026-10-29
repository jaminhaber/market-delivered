import type { FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { TRPCError } from '@trpc/server';
import { fromNodeHeaders } from 'better-auth/node';
import { isNull } from 'drizzle-orm';
import { networks, type Database } from '@market/db';
import { appRouter } from './router.js';
import { createAuth } from './auth.js';
import { permissions, resolveNetwork, networkEmailConfig } from './networks.js';
import { registerJobs } from './jobs.js';
import { registerMcp } from './mcp.js';
import { webOrigins } from './origins.js';
import { createHttpServer, forwardAuth } from './http.js';
import { registerAdminRoutes } from './admin-routes.js';
import { registerNetworkOAuth } from './oauth-routes.js';

export type ServerConfig = {
  secret: string;
  adminSecret: string;
  adminOrigin: string;
  production?: boolean;
  resendKey?: string;
  emailFrom?: string;
  cronSecret?: string;
  googleMapsKey?: string;
};
export async function createServer(db: Database, config: ServerConfig) {
  const server = createHttpServer(db);
  await server.register(async (server) => {
    await server.register(cors, {
      credentials: true,
      exposedHeaders: ['WWW-Authenticate'],
      origin(origin, callback) {
        if (!origin) return callback(null, false);
        void db
          .select({ origin: networks.frontendOrigin })
          .from(networks)
          .where(isNull(networks.deletedAt))
          .then(
            (rows) => {
              callback(
                null,
                rows.some(
                  (row) =>
                    row.origin &&
                    webOrigins({
                      webOrigin: row.origin,
                      production: config.production,
                    }).includes(origin),
                ),
              );
            },
            () => callback(new Error('Unable to validate origin'), false),
          );
      },
    });
    async function requestAuth(headers: {
      [key: string]: string | string[] | undefined;
    }) {
      const selector = headers['x-network-id'];
      if (typeof selector !== 'string' || !selector)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'X-Network-Id is required',
        });
      const network = await resolveNetwork(db, selector);
      if (
        !network.frontendOrigin ||
        (config.production &&
          new URL(network.frontendOrigin).protocol !== 'https:')
      )
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This network has no configured frontend origin',
        });
      const origin = headers.origin;
      const origins = webOrigins({
        webOrigin: network.frontendOrigin,
        production: config.production,
      });
      if (origin && (typeof origin !== 'string' || !origins.includes(origin)))
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Origin not allowed',
        });
      const email = await networkEmailConfig(db, network.id, config);
      const auth = createAuth(db, {
        ...config,
        ...email,
        baseURL: network.frontendOrigin,
        webOrigin: network.frontendOrigin,
        surface: 'business',
        cookiePrefix: `md-business-${network.id}`,
      });
      return { network, auth };
    }
    server.route({
      method: ['GET', 'POST'],
      url: '/api/auth/*',
      async handler(request, reply) {
        const { network, auth } = await requestAuth(request.headers);
        return forwardAuth(auth, network.frontendOrigin!, request, reply);
      },
    });
    await server.register(fastifyTRPCPlugin, {
      prefix: '/trpc',
      trpcOptions: {
        router: appRouter,
        createContext: async ({ req }: { req: FastifyRequest }) => {
          const { network, auth } = await requestAuth(req.headers);
          const current = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
          });
          const access = current
            ? await permissions(db, current.user.id, network.id)
            : null;
          return {
            db,
            network,
            googleMapsKey: config.googleMapsKey,
            actor:
              current && access
                ? {
                    id: current.user.id,
                    name: current.user.name,
                    email: current.user.email,
                    ...access,
                    admin: access.globalAdmin || access.networkAdmin,
                  }
                : null,
          };
        },
      },
    });
    registerMcp(server, db, config);
    registerNetworkOAuth(server, db, config);
    registerJobs(server, db, config.cronSecret);
  });
  await server.register(
    async (admin) => {
      await registerAdminRoutes(
        admin,
        db,
        {
          secret: config.adminSecret,
          networkSecret: config.secret,
          baseURL: config.adminOrigin,
          webOrigin: config.adminOrigin,
          production: config.production,
          resendKey: config.resendKey,
          emailFrom: config.emailFrom,
        },
        server,
      );
    },
    { prefix: '/admin' },
  );
  return server;
}
