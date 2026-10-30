import { mcp } from '@better-auth/mcp';
import { createCimdClientDiscovery } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { getOAuthProviderApi } from '@better-auth/oauth-provider';
import { APIError } from 'better-auth/api';
import { and, arrayContains, eq, isNull } from 'drizzle-orm';
import * as s from '@market/db';
import type { Auth } from './auth.js';

export const MCP_SCOPE = 'mcp';
export const OAUTH_ACCESS_PREFIX = 'md_oauth_';
export const OAUTH_REFRESH_PREFIX = 'md_refresh_';
export const OAUTH_BASE_PATH = '/oauth/auth';
export type McpOAuth = {
  resource: string;
  networkId?: string;
  loginPage?: string;
  consentPage?: string;
};
type OAuthContext = Parameters<typeof getOAuthProviderApi>[0];

export function oauthPlugins(oauth: McpOAuth) {
  const discovery = createCimdClientDiscovery({
    fetchClientMetadataResource,
    metadataProfile: 'mcp-2026-07-28',
  });
  return [
    mcp({
      resource: oauth.resource,
      loginPage: oauth.loginPage ?? '/oauth/login',
      consentPage: oauth.consentPage ?? '/oauth/authorize',
      disableJwtPlugin: true,
      scopes: [MCP_SCOPE, 'offline_access'],
      postLogin: {
        page: oauth.consentPage ?? '/oauth/authorize',
        consentReferenceId: () => oauth.networkId,
        shouldRedirect: () => false,
      },
      // Reference IDs are persisted on codes and tokens and survive refresh.
      // Derive the claim from stored grant data, never the requested endpoint.
      customAccessTokenClaims: ({ referenceId }) => ({
        network_id: referenceId ?? null,
      }),
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
export async function checkOAuthRequest(ctx: OAuthContext, oauth: McpOAuth) {
  if (!ctx.path?.startsWith('/oauth2/')) return;
  const requested = ctx.query?.resource ?? ctx.body?.resource;
  if (
    requested !== undefined &&
    (Array.isArray(requested) ? requested : [requested]).some(
      (resource) => resource !== oauth.resource,
    )
  )
    throw new APIError('BAD_REQUEST', { error: 'invalid_target' });
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
  const provider = getOAuthProviderApi(
    ctx,
    ctx.context.getPlugin('oauth-provider')!.options,
  );
  if (ctx.path === '/oauth2/token') {
    if (typeof ctx.body?.code === 'string') {
      const code = await ctx.context.internalAdapter.findVerificationValue(
        await provider.hashToken(ctx.body.code, 'authorization_code'),
      );
      if (code) {
        const value = JSON.parse(code.value);
        const resources = value.resource ?? value.query?.resource;
        if (
          (value.referenceId ?? null) !== (oauth.networkId ?? null) ||
          !(Array.isArray(resources) ? resources : [resources]).every(
            (resource) => resource === oauth.resource,
          )
        )
          throw new APIError('BAD_REQUEST', { error: 'invalid_grant' });
      }
    }
    if (typeof ctx.body?.refresh_token === 'string') {
      const raw = ctx.body.refresh_token;
      if (raw.startsWith(OAUTH_REFRESH_PREFIX)) {
        const stored = await ctx.context.adapter.findOne<{
          resources: string[];
          referenceId?: string | null;
        }>({
          model: 'oauthRefreshToken',
          where: [
            {
              field: 'token',
              value: await provider.hashToken(
                raw.slice(OAUTH_REFRESH_PREFIX.length),
                'refresh_token',
              ),
            },
          ],
        });
        if (
          stored &&
          (!stored.resources?.includes(oauth.resource) ||
            !stored.resources.every(
              (resource) => resource === oauth.resource,
            ) ||
            (stored.referenceId ?? null) !== (oauth.networkId ?? null))
        )
          throw new APIError('BAD_REQUEST', { error: 'invalid_grant' });
      }
    }
  }
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
  networkId?: string,
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
      claims.network_id !== (networkId ?? null) ||
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
          arrayContains(s.oauthConsent.resources, [resource]),
          networkId
            ? eq(s.oauthConsent.referenceId, networkId)
            : isNull(s.oauthConsent.referenceId),
        ),
      );
    return consent ? claims.sub : null;
  } catch (error) {
    if (error instanceof APIError) return null;
    throw error;
  }
}
