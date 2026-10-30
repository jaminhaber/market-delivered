import type { FastifyInstance, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { and, arrayContains, eq, isNull } from 'drizzle-orm';
import * as s from '@market/db';
import { createAuth } from './auth.js';
import { forwardAuth } from './http.js';
import { permissions, resolveNetwork } from './networks.js';
import { TRPCError } from '@trpc/server';
import { OAUTH_BASE_PATH } from './oauth.js';
import type { ServerConfig } from './server.js';

const oauthEndpoints = new Set([
  'oauth2/authorize',
  'oauth2/token',
  'oauth2/register',
  'oauth2/revoke',
  'oauth2/introspect',
  'oauth2/consent',
  'oauth2/public-client',
]);

export function createOAuth(
  db: s.Database,
  config: ServerConfig,
  network?: {
    id: string;
    name: string;
    slug: string;
    frontendOrigin: string | null;
  },
) {
  const origin = config.adminOrigin;
  if (
    network &&
    (!network.frontendOrigin ||
      (config.production &&
        new URL(network.frontendOrigin).protocol !== 'https:'))
  )
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'Configure the network frontend origin before connecting an assistant.',
    });
  const basePath = network
    ? `/networks/${network.id}${OAUTH_BASE_PATH}`
    : OAUTH_BASE_PATH;
  const pagePath = network ? `/oauth/networks/${network.id}` : '/oauth';
  const resource = new URL(
    network ? '/api/mcp' : '/mcp',
    network?.frontendOrigin ?? origin,
  ).href;
  const resourceMetadataPath =
    '/.well-known/oauth-protected-resource' + new URL(resource).pathname;
  const auth = createAuth(db, {
    ...config,
    secret: config.adminSecret,
    baseURL: origin,
    webOrigin: origin,
    basePath,
    surface: 'oauth',
    cookiePrefix: network ? `md-oauth-${network.id}` : 'md-oauth',
    appName: 'Market Delivered',
    oauth: {
      resource,
      networkId: network?.id,
      loginPage: pagePath + '/login',
      consentPage: pagePath + '/authorize',
    },
  });
  return {
    auth,
    origin,
    resource,
    basePath,
    resourceMetadataPath,
    network: network
      ? { id: network.id, name: network.name, slug: network.slug }
      : undefined,
  };
}
export type OAuth = ReturnType<typeof createOAuth>;
export type OAuthSource = OAuth | ((request: FastifyRequest) => Promise<OAuth>);
export const resolveOAuth = (source: OAuthSource, request: FastifyRequest) =>
  typeof source === 'function' ? source(request) : source;

export async function networkOAuth(
  db: s.Database,
  config: ServerConfig,
  request: FastifyRequest,
) {
  const { networkId } = request.params as { networkId: string };
  const network = await resolveNetwork(db, networkId);
  return createOAuth(db, config, network);
}

export async function registerOAuthRoutes(
  app: FastifyInstance,
  db: s.Database,
  source: OAuthSource,
  paths = {
    auth: OAUTH_BASE_PATH,
    resource: '/.well-known/oauth-protected-resource/mcp',
    discovery: '/.well-known/oauth-authorization-server/oauth/auth',
  },
) {
  await app.register(async (app) => {
    app.get(paths.resource, async (request, reply) => {
      const { auth, origin, resourceMetadataPath } = await resolveOAuth(
        source,
        request,
      );
      return forwardAuth(auth, origin, request, reply, resourceMetadataPath);
    });
    app.get(paths.discovery, async (request, reply) => {
      const { auth, origin, basePath } = await resolveOAuth(source, request);
      return forwardAuth(
        auth,
        origin,
        request,
        reply,
        `${basePath}/.well-known/oauth-authorization-server`,
      );
    });
    app.route({
      method: ['GET', 'POST'],
      url: `${paths.auth}/*`,
      async handler(request, reply) {
        const { auth, origin, resource, network } = await resolveOAuth(
          source,
          request,
        );
        reply.header('Cache-Control', 'no-store');
        const suffix = (request.params as { '*': string })['*'];
        // Connection management has one owner-checked disconnect path. Do not
        // expose the provider's separate client/consent administration APIs.
        if (
          (suffix.startsWith('oauth2/') && !oauthEndpoints.has(suffix)) ||
          suffix.startsWith('admin/')
        )
          return reply.code(404).send({ error: 'Not found' });
        if (suffix === 'identity' || suffix === 'connections') {
          const current = await auth.api.getSession({
            headers: fromNodeHeaders(request.headers),
          });
          if (!current)
            return reply.code(401).send({ error: 'Sign in to continue.' });
          if (suffix === 'identity') {
            if (request.method !== 'GET')
              return reply.code(405).send({ error: 'Use GET' });
            return {
              ...current.user,
              ...(await permissions(db, current.user.id)),
              connection: { resource, network },
            };
          }
          if (request.method === 'GET') {
            const connections = await db
              .select({
                id: s.oauthConsent.id,
                name: s.oauthClient.name,
                clientId: s.oauthConsent.clientId,
                createdAt: s.oauthConsent.createdAt,
              })
              .from(s.oauthConsent)
              .innerJoin(
                s.oauthClient,
                eq(s.oauthClient.clientId, s.oauthConsent.clientId),
              )
              .where(
                and(
                  eq(s.oauthConsent.userId, current.user.id),
                  arrayContains(s.oauthConsent.resources, [resource]),
                  network
                    ? eq(s.oauthConsent.referenceId, network.id)
                    : isNull(s.oauthConsent.referenceId),
                ),
              );
            return { connections };
          }
          if (request.headers.origin !== origin)
            return reply.code(403).send({ error: 'Origin not allowed' });
          const body = request.body as { id?: unknown } | null;
          if (typeof body?.id !== 'string')
            return reply.code(400).send({ error: 'Choose a connection.' });
          await db.transaction(async (tx) => {
            const [grant] = await tx
              .delete(s.oauthConsent)
              .where(
                and(
                  eq(s.oauthConsent.id, body.id as string),
                  eq(s.oauthConsent.userId, current.user.id),
                  arrayContains(s.oauthConsent.resources, [resource]),
                  network
                    ? eq(s.oauthConsent.referenceId, network.id)
                    : isNull(s.oauthConsent.referenceId),
                ),
              )
              .returning();
            if (!grant) return;
            const match = [
              eq(s.oauthAccessToken.userId, current.user.id),
              eq(s.oauthAccessToken.clientId, grant.clientId),
              arrayContains(s.oauthAccessToken.resources, [resource]),
              network
                ? eq(s.oauthAccessToken.referenceId, network.id)
                : isNull(s.oauthAccessToken.referenceId),
            ];
            await tx.delete(s.oauthAccessToken).where(and(...match));
            await tx
              .update(s.oauthRefreshToken)
              .set({ revoked: new Date(), rotationReplayResponse: null })
              .where(
                and(
                  eq(s.oauthRefreshToken.userId, current.user.id),
                  eq(s.oauthRefreshToken.clientId, grant.clientId),
                  arrayContains(s.oauthRefreshToken.resources, [resource]),
                  network
                    ? eq(s.oauthRefreshToken.referenceId, network.id)
                    : isNull(s.oauthRefreshToken.referenceId),
                ),
              );
          });
          return { success: true };
        }
        return forwardAuth(auth, origin, request, reply);
      },
    });
  });
}
