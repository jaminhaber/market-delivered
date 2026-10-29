import {
  expect,
  request as requests,
  type APIRequestContext,
} from '@playwright/test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const oauthOrigin = 'http://localhost:5190';
export const mcpUrl = oauthOrigin + '/mcp';
export const oauthPath = '/oauth/auth';

// Real public-client registration, PKCE, sign-in, consent, and code exchange.
// Business tests use the same account-wide flow as the browser integration.
export async function connectAssistant(
  email: string,
  password: string,
  context?: APIRequestContext,
) {
  const client =
    context ?? (await requests.newContext({ baseURL: oauthOrigin }));
  try {
    const registration = await client.post(oauthPath + '/oauth2/register', {
      data: {
        client_name: 'Test assistant',
        redirect_uris: ['http://localhost:9999/callback'],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'mcp offline_access',
      },
    });
    expect(registration.status(), await registration.text()).toBe(201);
    const { client_id: clientId } = await registration.json();
    const login = await client.post(oauthPath + '/sign-in/email', {
      headers: { Origin: oauthOrigin },
      data: { email, password },
    });
    expect(login.status(), await login.text()).toBe(200);
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://localhost:9999/callback',
      response_type: 'code',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      scope: 'mcp offline_access',
      resource: mcpUrl,
      state: randomUUID(),
    });
    const authorization = await client.get(
      oauthPath + '/oauth2/authorize?' + query,
      { maxRedirects: 0 },
    );
    expect([302, 303], await authorization.text()).toContain(
      authorization.status(),
    );
    const consentUrl = new URL(authorization.headers().location!, oauthOrigin);
    expect(consentUrl.pathname).toBe('/oauth/authorize');
    const consent = await client.post(oauthPath + '/oauth2/consent', {
      headers: { Origin: oauthOrigin },
      data: { accept: true, oauth_query: consentUrl.search.slice(1) },
    });
    expect(consent.status(), await consent.text()).toBe(200);
    const callback = new URL((await consent.json()).url);
    const exchange = await client.post(oauthPath + '/oauth2/token', {
      form: {
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: 'http://localhost:9999/callback',
        code: callback.searchParams.get('code')!,
        code_verifier: verifier,
        resource: mcpUrl,
      },
    });
    expect(exchange.status(), await exchange.text()).toBe(200);
    const tokens = await exchange.json();
    return {
      token: tokens.access_token as string,
      refreshToken: tokens.refresh_token as string,
      clientId,
    };
  } finally {
    if (!context) await client.dispose();
  }
}
