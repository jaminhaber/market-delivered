import { mcp } from '@better-auth/mcp';
import { createCimdClientDiscovery } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { getOAuthProviderApi } from '@better-auth/oauth-provider';
import { APIError } from 'better-auth/api';
import { and, eq } from 'drizzle-orm';
import * as s from '@market/db';
import type { Auth } from './auth.js';

export const MCP_SCOPE = 'mcp';
export const OAUTH_ACCESS_PREFIX = 'md_oauth_';
export const OAUTH_REFRESH_PREFIX = 'md_refresh_';
export const OAUTH_BASE_PATH = '/oauth/auth';
export type McpOAuth = { resource: string };
type OAuthContext = Parameters<typeof getOAuthProviderApi>[0];

export function oauthPlugins(oauth: McpOAuth) {
  const discovery = createCimdClientDiscovery({
    fetchClientMetadataResource,
    metadataProfile: 'mcp-2026-07-28',
  });
  return [
    mcp({
      resource: oauth.resource,
      loginPage: '/oauth/login',
      consentPage: '/oauth/authorize',
      disableJwtPlugin: true,
      scopes: [MCP_SCOPE, 'offline_access'],
      dpop: { signingAlgorithms: [] },
      grantTypes: ['authorization_code', 'refresh_token'],
      accessTokenExpiresIn: 15 * 60,
      refreshTokenExpiresIn: 90 * 24 * 60 * 60,
      refreshTokenReuseInterval: 0,
      prefix: {
        opaqueAccessToken: OAUTH_ACCESS_PREFIX,
        refreshToken: OAUTH_REFRESH_PREFIX,
      },
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: 'infer',
      clientPrivileges: () => false,
      extensions: [
        {
          clientDiscovery: {
            ...discovery,
            async resolve(...args) {
              const client = await discovery.resolve(...args);
              if (client?.dpopBoundAccessTokens)
                throw new APIError('BAD_REQUEST', {
                  error: 'invalid_client_metadata',
                  error_description:
                    'DPoP is not supported. Use Bearer tokens.',
                });
              return client;
            },
          },
        },
      ],
    }),
  ];
}

// Keep the provider's revocation implementation, but reject cross-client token
// ownership before its revoked-token replay cleanup can affect another client.
export async function checkOAuthRequest(ctx: OAuthContext) {
  if (!ctx.path?.startsWith('/oauth2/')) return;
  if (
    ctx.headers?.has('dpop') ||
    ctx.query?.dpop_jkt !== undefined ||
    ctx.body?.dpop_jkt !== undefined ||
    ctx.body?.dpop_bound_access_tokens === true
  )
    throw new APIError('BAD_REQUEST', {
      error: 'invalid_request',
      error_description: 'DPoP is not supported. Use Bearer tokens.',
    });
  if (ctx.path !== '/oauth2/revoke' || typeof ctx.body?.token !== 'string')
    return;
  const token = ctx.body.token.replace(/^(?:Bearer|DPoP) +/i, '');
  if (!token.startsWith(OAUTH_REFRESH_PREFIX)) return;
  let clientId = ctx.body.client_id;
  const authorization = ctx.headers?.get('authorization');
  try {
    if (authorization && /^Basic +/i.test(authorization)) {
      const credentials = Buffer.from(
        authorization.replace(/^Basic +/i, ''),
        'base64',
      ).toString();
      clientId = decodeURIComponent(
        credentials.slice(0, credentials.indexOf(':')).replace(/\+/g, ' '),
      );
    } else if (!clientId && typeof ctx.body.client_assertion === 'string') {
      // This only checks consistency; the provider verifies the assertion later.
      clientId = JSON.parse(
        Buffer.from(
          ctx.body.client_assertion.split('.')[1] || '',
          'base64url',
        ).toString(),
      ).iss;
    }
  } catch {
    throw new APIError('BAD_REQUEST', { error: 'invalid_client' });
  }
  const provider = getOAuthProviderApi(
    ctx,
    ctx.context.getPlugin('oauth-provider')!.options,
  );
  const stored = await ctx.context.adapter.findOne<{ clientId: string }>({
    model: 'oauthRefreshToken',
    where: [
      {
        field: 'token',
        value: await provider.hashToken(
          token.slice(OAUTH_REFRESH_PREFIX.length),
          'refresh_token',
        ),
      },
    ],
  });
  if (stored && stored.clientId !== clientId)
    throw new APIError('BAD_REQUEST', { error: 'invalid_grant' });
}

export async function oauthIdentity(
  db: s.Database,
  auth: Auth,
  headers: Headers,
  resource: string,
) {
  const authorization = headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const context = await auth.$context;
  const provider = getOAuthProviderApi(
    { context, headers } as OAuthContext,
    context.getPlugin('oauth-provider')!.options,
  );
  try {
    const claims = await provider.requireActiveAccessToken(
      authorization.slice(7),
    );
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      claims.iss !== context.baseURL ||
      !audiences.includes(resource) ||
      typeof claims.sub !== 'string' ||
      typeof claims.client_id !== 'string' ||
      !String(claims.scope || '')
        .split(' ')
        .includes(MCP_SCOPE) ||
      claims.cnf
    )
      return null;
    // Disconnect applies immediately, including to a token issued concurrently.
    const [consent] = await db
      .select({ id: s.oauthConsent.id })
      .from(s.oauthConsent)
      .where(
        and(
          eq(s.oauthConsent.userId, claims.sub),
          eq(s.oauthConsent.clientId, claims.client_id),
        ),
      );
    return consent ? claims.sub : null;
  } catch (error) {
    if (error instanceof APIError) return null;
    throw error;
  }
}
