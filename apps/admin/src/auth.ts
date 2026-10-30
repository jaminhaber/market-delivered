import { createAuthClient } from 'better-auth/react';
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/admin/auth',
});

const networkId = location.pathname.match(
  /^\/oauth\/networks\/([0-9a-f-]+)\//,
)?.[1];
export const oauthBasePath = networkId
  ? `/networks/${networkId}/oauth/auth`
  : '/oauth/auth';
export const oauthPagePath = (page: string) =>
  (networkId ? `/oauth/networks/${networkId}` : '/oauth') + '/' + page;

export const oauthClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: oauthBasePath,
});

export async function signOut() {
  const response = await authClient.signOut();
  if (response.error) throw new Error(response.error.message);
  location.replace('/');
}
