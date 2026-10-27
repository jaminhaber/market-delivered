import { createAuthClient } from 'better-auth/react';
export const authClient = createAuthClient({
  fetchOptions: {
    headers: new URLSearchParams(location.search).get('network')
      ? { 'x-network-id': new URLSearchParams(location.search).get('network')! }
      : {},
  },
  baseURL: import.meta.env.VITE_AUTH_URL || window.location.origin,
});

export async function signOut() {
  const response = await authClient.signOut();
  if (response.error) throw new Error(response.error.message);
  const url = new URL(location.href);
  // Keep email links intact when signing out to use a different account.
  url.searchParams.delete('page');
  url.searchParams.delete('tab');
  location.replace(url.href);
}
