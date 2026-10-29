import type { FastifyInstance } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { and, eq } from 'drizzle-orm';
import * as s from '@market/db';
import { createAuth } from './auth.js';
import { forwardAuth } from './http.js';
import { permissions } from './networks.js';
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

export function createOAuth(db: s.Database, config: ServerConfig) {
  const origin = config.adminOrigin;
  const resource = new URL('/mcp', origin).href;
  const auth = createAuth(db, {
    ...config,
    secret: config.adminSecret,
    baseURL: origin,
    webOrigin: origin,
    basePath: OAUTH_BASE_PATH,
    surface: 'oauth',
    cookiePrefix: 'md-oauth',
    appName: 'Market Delivered',
    oauth: { resource },
  });
  return { auth, origin, resource };
}
export type OAuth = ReturnType<typeof createOAuth>;

export async function registerOAuthRoutes(
  app: FastifyInstance,
  db: s.Database,
  oauth: OAuth,
) {
  const { auth, origin } = oauth;
  await app.register(async (app) => {
    app.get('/.well-known/oauth-protected-resource/mcp', (request, reply) =>
      forwardAuth(
        auth,
        origin,
        request,
        reply,
        '/.well-known/oauth-protected-resource/mcp',
      ),
    );
    app.get(
      '/.well-known/oauth-authorization-server/oauth/auth',
      (request, reply) =>
        forwardAuth(
          auth,
          origin,
          request,
          reply,
          `${OAUTH_BASE_PATH}/.well-known/oauth-authorization-server`,
        ),
    );
    app.route({
      method: ['GET', 'POST'],
      url: `${OAUTH_BASE_PATH}/*`,
      async handler(request, reply) {
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
              .where(eq(s.oauthConsent.userId, current.user.id));
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
                ),
              )
              .returning();
            if (!grant) return;
            const match = [
              eq(s.oauthAccessToken.userId, current.user.id),
              eq(s.oauthAccessToken.clientId, grant.clientId),
            ];
            await tx.delete(s.oauthAccessToken).where(and(...match));
            await tx
              .update(s.oauthRefreshToken)
              .set({ revoked: new Date(), rotationReplayResponse: null })
              .where(
                and(
                  eq(s.oauthRefreshToken.userId, current.user.id),
                  eq(s.oauthRefreshToken.clientId, grant.clientId),
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
