import { createHash } from 'node:crypto';
import { mcp } from '@better-auth/mcp';
import { createCimdClientDiscovery } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { APIError } from 'better-auth/api';
import { permissions } from './networks.js';
import type { Database } from '@market/db';
import type { drizzleAdapter } from '@better-auth/drizzle-adapter';

export const OAUTH_ACCESS_PREFIX = 'md_oauth_';
export const OAUTH_REFRESH_PREFIX = 'md_refresh_';
export const MCP_SCOPE = 'mcp:business';
export const ADMIN_MCP_SCOPE = 'mcp:platform';
export const ADMIN_OAUTH_REFERENCE = 'platform';
export const hashOAuthToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export const networkMcpPath = (networkSlug: string) =>
  `/networks/${encodeURIComponent(networkSlug)}/mcp`;
export const networkOAuthPath = (networkSlug: string) =>
  `/networks/${encodeURIComponent(networkSlug)}/auth`;
export type McpOAuth = { networkId: string | null; resource: string };

export function scopeOAuthAdapter(
  factory: ReturnType<typeof drizzleAdapter>,
  oauth?: McpOAuth,
): ReturnType<typeof drizzleAdapter> {
  return (options) => {
    const adapter = factory(options);
    if (!oauth) return adapter;
    const referenceId = oauth.networkId ?? ADMIN_OAUTH_REFERENCE;
    // The provider invalidates replayed refresh-token families by client/user.
    // Restrict its family lookup and deletion to this authorization surface.
    const scope = <
      T extends { model: string; where?: { field: string; value: unknown }[] },
    >(
      data: T,
    ) =>
      data.model === 'oauthRefreshToken'
        ? {
            ...data,
            where: [
              ...(data.where ?? []),
              { field: 'referenceId', value: referenceId },
            ],
          }
        : data;
    return {
      ...adapter,
      findMany: (data) => adapter.findMany(scope(data)),
      deleteMany: (data) => adapter.deleteMany(scope(data)),
    };
  };
}

export function oauthPlugins(db: Database, oauth: McpOAuth) {
  const referenceId = oauth.networkId ?? ADMIN_OAUTH_REFERENCE;
  const scope = oauth.networkId ? MCP_SCOPE : ADMIN_MCP_SCOPE;
  const consentPage = oauth.networkId ? '/mcp/authorize' : '/oauth/authorize';
  const discovery = createCimdClientDiscovery({
    fetchClientMetadataResource,
    metadataProfile: 'mcp-2026-07-28',
  });
  return [
    mcp({
      extensions: [
        {
          clientDiscovery: {
            ...discovery,
            async resolve(...args) {
              // Inspect the client only after CIMD's bounded fetch and validation.
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
      resource: oauth.resource,
      loginPage: oauth.networkId ? '/mcp/login' : '/oauth/login',
      consentPage,
      // Opaque tokens allow immediate revocation with the existing database.
      disableJwtPlugin: true,
      // CIMD client records are shared across issuers. Persist the same client
      // capabilities everywhere; each surface restricts actual grants below.
      scopes: [MCP_SCOPE, ADMIN_MCP_SCOPE, 'offline_access'],
      advertisedMetadata: { scopes_supported: [scope, 'offline_access'] },
      dpop: { signingAlgorithms: [] },
      grantTypes: ['authorization_code', 'refresh_token'],
      accessTokenExpiresIn: 15 * 60,
      refreshTokenExpiresIn: 90 * 24 * 60 * 60,
      refreshTokenReuseInterval: 0,
      storeTokens: { hash: hashOAuthToken },
      prefix: {
        opaqueAccessToken: OAUTH_ACCESS_PREFIX,
        refreshToken: OAUTH_REFRESH_PREFIX,
      },
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: 'infer',
      clientPrivileges: () => false,
      postLogin: {
        page: consentPage,
        shouldRedirect: () => false,
        consentReferenceId: async ({ user }) => {
          const access = await permissions(
            db,
            user.id,
            oauth.networkId ?? undefined,
          );
          if (!access.globalAdmin && !(oauth.networkId && access.networkAdmin))
            throw new APIError('FORBIDDEN', {
              message: 'Administrator access is required.',
            });
          return referenceId;
        },
      },
      customTokenResponseFields: async ({
        user,
        verificationValue,
        scopes,
      }) => {
        if (
          !user ||
          (verificationValue &&
            verificationValue.referenceId !== referenceId) ||
          scopes.some((value) => value !== scope && value !== 'offline_access')
        )
          throw new APIError('BAD_REQUEST', { error: 'invalid_grant' });
        const access = await permissions(
          db,
          user.id,
          oauth.networkId ?? undefined,
        );
        if (!access.globalAdmin && !(oauth.networkId && access.networkAdmin))
          throw new APIError('FORBIDDEN', { error: 'access_denied' });
        return {};
      },
    }),
  ];
}
