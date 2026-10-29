import type { FastifyInstance, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { and, eq, gt } from 'drizzle-orm';
import * as s from '@market/db';
import { createAuth, type Auth } from './auth.js';
import { forwardAuth } from './http.js';
import { resolveNetwork, networkEmailConfig, permissions } from './networks.js';
import type { AuthConfig } from './auth.js';
import type { ServerConfig } from './server.js';
import {
  hashOAuthToken,
  MCP_SCOPE,
  networkMcpPath,
  networkOAuthPath,
  OAUTH_REFRESH_PREFIX,
  OAUTH_ACCESS_PREFIX,
  ADMIN_MCP_SCOPE,
  ADMIN_OAUTH_REFERENCE,
} from './oauth.js';

const providerPaths = new Set([
  '/oauth2/authorize',
  '/oauth2/token',
  '/oauth2/register',
  '/oauth2/revoke',
  '/oauth2/consent',
  '/oauth2/public-client',
]);

type OAuthContext = {
  referenceId: string;
  origin: string;
  name: string;
  resource: string;
  basePath: string;
  auth: Auth;
};

export function registerOAuthRoutes(
  app: FastifyInstance,
  db: s.Database,
  config: { secret: string },
  context: (request: FastifyRequest) => Promise<OAuthContext>,
  global = false,
  routesApp = app,
) {
  const scope = global ? ADMIN_MCP_SCOPE : MCP_SCOPE;
  const resourcePath = global ? '/admin/mcp' : '/networks/:network/mcp';
  const authPath = global ? '/admin/auth' : '/networks/:network/auth';
  app.get(
    '/.well-known/oauth-protected-resource' + resourcePath,
    async (request, reply) => {
      const { name, origin, resource, basePath } = await context(request);
      return reply.header('Cache-Control', 'no-store').send({
        resource,
        resource_name: `${name} administration`,
        authorization_servers: [new URL(basePath, origin).href],
        scopes_supported: [scope],
        bearer_methods_supported: ['header'],
      });
    },
  );

  app.get(
    '/.well-known/oauth-authorization-server' + authPath,
    async (request, reply) => {
      const { origin, basePath, auth } = await context(request);
      return forwardAuth(
        auth,
        origin,
        request,
        reply,
        `${basePath}/.well-known/oauth-authorization-server`,
      );
    },
  );

  routesApp.route({
    method: ['GET', 'POST'],
    url: (global ? '/auth' : authPath) + '/*',
    async handler(request, reply) {
      reply.header('Cache-Control', 'no-store');
      const { referenceId, origin, resource, basePath, auth } =
        await context(request);
      const suffix = '/' + (request.params as { '*': string })['*'];
      const body =
        typeof request.body === 'string'
          ? Object.fromEntries(new URLSearchParams(request.body))
          : ((request.body ?? {}) as Record<string, unknown>);
      const fail = (error: string) => reply.code(400).send({ error });
      const currentSession = () =>
        auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      const sameResource = (resources: unknown) =>
        Array.isArray(resources) &&
        resources.length === 1 &&
        resources[0] === resource;

      // Grants are owned by a user and bound to this authorization surface.
      if (suffix === '/connections') {
        const current = await currentSession();
        if (!current)
          return reply.code(401).send({ error: 'Sign in to continue.' });
        const access = await permissions(
          db,
          current.user.id,
          global ? undefined : referenceId,
        );
        if (!access.globalAdmin && !(!global && access.networkAdmin))
          return reply
            .code(403)
            .send({ error: 'Administrator access is required.' });
        if (request.method === 'GET') {
          const rows = await db
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
                eq(s.oauthConsent.referenceId, referenceId),
              ),
            );
          return { resource, connections: rows };
        }
        if (request.headers.origin !== origin)
          return reply.code(403).send({ error: 'Origin not allowed' });
        if (typeof body.id !== 'string') return fail('invalid_request');
        await db.transaction(async (tx) => {
          const [grant] = await tx
            .delete(s.oauthConsent)
            .where(
              and(
                eq(s.oauthConsent.id, body.id as string),
                eq(s.oauthConsent.userId, current.user.id),
                eq(s.oauthConsent.referenceId, referenceId),
              ),
            )
            .returning();
          if (!grant) return;
          const match = { userId: current.user.id, clientId: grant.clientId };
          await tx
            .update(s.oauthAccessToken)
            .set({ revoked: new Date() })
            .where(
              and(
                eq(s.oauthAccessToken.userId, match.userId),
                eq(s.oauthAccessToken.clientId, match.clientId),
                eq(s.oauthAccessToken.referenceId, referenceId),
              ),
            );
          await tx
            .update(s.oauthRefreshToken)
            .set({ revoked: new Date(), rotationReplayResponse: null })
            .where(
              and(
                eq(s.oauthRefreshToken.userId, match.userId),
                eq(s.oauthRefreshToken.clientId, match.clientId),
                eq(s.oauthRefreshToken.referenceId, referenceId),
              ),
            );
        });
        return { success: true };
      }
      if (!providerPaths.has(suffix)) {
        if (global && !suffix.startsWith('/oauth2/'))
          return forwardAuth(auth, origin, request, reply);
        return reply.code(404).send({ error: 'Not found' });
      }
      if (suffix === '/oauth2/authorize') {
        const query = new URL(request.url, origin).searchParams;
        if (!sameResource(query.getAll('resource')))
          return fail('invalid_target');
        const scopes = (query.get('scope') ?? `${scope} offline_access`)
          .split(' ')
          .filter(Boolean);
        if (
          scopes.some((value) => value !== scope && value !== 'offline_access')
        )
          return fail('invalid_scope');
        query.set('scope', scopes.join(' '));
        return forwardAuth(
          auth,
          origin,
          request,
          reply,
          `${basePath}${suffix}?${query}`,
        );
      }
      if (
        suffix === '/oauth2/register' &&
        body.resources !== undefined &&
        !sameResource(body.resources)
      )
        return fail('invalid_target');
      if (suffix === '/oauth2/consent' || suffix === '/oauth2/public-client') {
        const query =
          suffix === '/oauth2/consent'
            ? body.oauth_query
            : new URL(request.url, origin).searchParams.get('oauth_query');
        if (
          typeof query !== 'string' ||
          !(await verifyOAuthQueryParams(query, config.secret)) ||
          !sameResource(new URLSearchParams(query).getAll('resource'))
        )
          return fail('invalid_request');
      }
      if (suffix === '/oauth2/token' && body.grant_type === 'refresh_token') {
        const token =
          typeof body.refresh_token === 'string' ? body.refresh_token : '';
        if (!token.startsWith(OAUTH_REFRESH_PREFIX))
          return fail('invalid_grant');
        const [stored] = await db
          .select()
          .from(s.oauthRefreshToken)
          .where(
            and(
              eq(
                s.oauthRefreshToken.token,
                hashOAuthToken(token.slice(OAUTH_REFRESH_PREFIX.length)),
              ),
              eq(s.oauthRefreshToken.referenceId, referenceId),
              gt(s.oauthRefreshToken.expiresAt, new Date()),
            ),
          );
        if (!stored || !sameResource(stored.resources))
          return fail('invalid_grant');
      }
      if (suffix === '/oauth2/revoke' && typeof body.token === 'string') {
        const token = body.token;
        const table = token.startsWith(OAUTH_REFRESH_PREFIX)
          ? s.oauthRefreshToken
          : s.oauthAccessToken;
        const prefix = token.startsWith(OAUTH_REFRESH_PREFIX)
          ? OAUTH_REFRESH_PREFIX
          : OAUTH_ACCESS_PREFIX;
        const [stored] = await db
          .select({ referenceId: table.referenceId })
          .from(table)
          .where(eq(table.token, hashOAuthToken(token.slice(prefix.length))));
        if (stored && stored.referenceId !== referenceId)
          return fail('invalid_target');
      }
      return forwardAuth(
        auth,
        origin,
        request,
        reply,
        basePath +
          suffix +
          (request.url.includes('?')
            ? request.url.slice(request.url.indexOf('?'))
            : ''),
      );
    },
  });
}

export function registerNetworkOAuth(
  app: FastifyInstance,
  db: s.Database,
  config: ServerConfig,
) {
  const instances = new Map<string, { key: string; auth: Auth }>();
  async function context(request: FastifyRequest) {
    const { network: selector } = request.params as { network: string };
    const network = await resolveNetwork(db, selector);
    if (!network.frontendOrigin)
      throw Object.assign(
        new Error('This business has no website configured.'),
        { statusCode: 412 },
      );
    const header = request.headers['x-network-id'];
    if (header && header !== network.id && header !== network.slug)
      throw Object.assign(new Error('Network does not match the URL.'), {
        statusCode: 403,
      });
    const basePath = networkOAuthPath(network.slug);
    const resource = new URL(
      networkMcpPath(network.slug),
      network.frontendOrigin,
    ).href;
    const email = await networkEmailConfig(db, network.id, config);
    const key = JSON.stringify([network.slug, network.frontendOrigin, email]);
    let cached = instances.get(network.id);
    if (!cached || cached.key !== key) {
      cached = {
        key,
        auth: createAuth(db, {
          ...config,
          ...email,
          baseURL: network.frontendOrigin,
          webOrigin: network.frontendOrigin,
          basePath,
          surface: 'business',
          cookiePrefix: `md-business-${network.id}`,
          oauth: { networkId: network.id, resource },
        }),
      };
      instances.set(network.id, cached);
    }
    return {
      referenceId: network.id,
      origin: network.frontendOrigin,
      name: network.name,
      resource,
      basePath,
      auth: cached.auth,
    };
  }

  registerOAuthRoutes(app, db, config, context);
}

export function registerAdminOAuth(
  app: FastifyInstance,
  db: s.Database,
  config: AuthConfig,
  auth: Auth,
  routesApp: FastifyInstance,
) {
  registerOAuthRoutes(
    app,
    db,
    config,
    async () => ({
      referenceId: ADMIN_OAUTH_REFERENCE,
      name: 'Market Delivered platform',
      origin: config.baseURL,
      resource: new URL('/admin/mcp', config.baseURL).href,
      basePath: '/admin/auth',
      auth,
    }),
    true,
    routesApp,
  );
}
