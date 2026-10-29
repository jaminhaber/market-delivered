import { createAuthClient } from 'better-auth/react';
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/admin/auth',
});

export async function signOut() {
  const response = await authClient.signOut();
  if (response.error) throw new Error(response.error.message);
  location.replace('/');
}
