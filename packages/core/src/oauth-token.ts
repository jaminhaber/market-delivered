import { and, eq, gt, isNull } from 'drizzle-orm';
import * as s from '@market/db';
import { hashOAuthToken, OAUTH_ACCESS_PREFIX } from './oauth.js';

export async function verifyMcpOAuthToken(
  db: s.Database,
  token: string,
  {
    referenceId,
    resource,
    scope,
  }: { referenceId: string; resource: string; scope: string },
): Promise<string | null> {
  if (!token.startsWith(OAUTH_ACCESS_PREFIX)) return null;
  const [stored] = await db
    .select({ token: s.oauthAccessToken, client: s.oauthClient })
    .from(s.oauthAccessToken)
    .innerJoin(
      s.oauthClient,
      eq(s.oauthClient.clientId, s.oauthAccessToken.clientId),
    )
    .where(
      and(
        eq(
          s.oauthAccessToken.token,
          hashOAuthToken(token.slice(OAUTH_ACCESS_PREFIX.length)),
        ),
        eq(s.oauthAccessToken.referenceId, referenceId),
        isNull(s.oauthAccessToken.revoked),
        gt(s.oauthAccessToken.expiresAt, new Date()),
      ),
    );
  if (
    stored?.token.userId &&
    !stored.client.disabled &&
    !stored.token.confirmation &&
    stored.token.resources?.length === 1 &&
    stored.token.resources[0] === resource &&
    stored.token.scopes.includes(scope)
  ) {
    const [consent] = await db
      .select({ id: s.oauthConsent.id })
      .from(s.oauthConsent)
      .where(
        and(
          eq(s.oauthConsent.userId, stored.token.userId),
          eq(s.oauthConsent.clientId, stored.token.clientId),
          eq(s.oauthConsent.referenceId, referenceId),
        ),
      );
    const [session] = stored.token.sessionId
      ? await db
          .select({ id: s.session.id })
          .from(s.session)
          .where(
            and(
              eq(s.session.id, stored.token.sessionId),
              gt(s.session.expiresAt, new Date()),
            ),
          )
      : [];
    const [refresh] = stored.token.refreshId
      ? await db
          .select({ revoked: s.oauthRefreshToken.revoked })
          .from(s.oauthRefreshToken)
          .where(eq(s.oauthRefreshToken.id, stored.token.refreshId))
      : [];
    if (
      consent &&
      session &&
      (!stored.token.refreshId || (refresh && !refresh.revoked))
    )
      return stored.token.userId;
  }
  return null;
}
