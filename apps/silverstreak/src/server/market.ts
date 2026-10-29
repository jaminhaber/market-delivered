import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@market/api/router';
import type { APIContext } from 'astro';

type Context = Pick<APIContext, 'request' | 'url'>;
export function marketConfig() {
  const value =
    process.env.MARKET_API_ORIGIN || import.meta.env.MARKET_API_ORIGIN;
  const networkId =
    process.env.SILVERSTREAK_NETWORK_ID ||
    import.meta.env.SILVERSTREAK_NETWORK_ID;
  if (!value || !networkId)
    throw new Error('The shop is not configured yet. Please check back soon.');
  const origin = new URL(value);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    (import.meta.env.PROD && origin.protocol !== 'https:')
  )
    throw new Error('The shop is temporarily unavailable.');
  return { origin: origin.origin, networkId };
}
export function marketApi(context: Context) {
  const config = marketConfig();
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: config.origin + '/trpc',
        headers: {
          'x-network-id': config.networkId,
          cookie: context.request.headers.get('cookie') || '',
          origin: context.url.origin,
        },
        fetch: (url, options) =>
          fetch(url, { ...options, signal: AbortSignal.timeout(15_000) }),
      }),
    ],
  });
}
export async function authRequest(
  context: Context,
  path: string,
  body: Record<string, unknown>,
  invite = '',
) {
  const config = marketConfig();
  return fetch(config.origin + '/api/auth/' + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: context.request.headers.get('cookie') || '',
      origin: context.url.origin,
      'x-network-id': config.networkId,
      ...(invite ? { 'x-invite-token': invite } : {}),
    },
    body: JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
}
export function redirectAfterAuth(response: Response, destination: string) {
  const headers = new Headers({
    location: destination,
    'Cache-Control': 'no-store',
  });
  for (const cookie of response.headers.getSetCookie())
    headers.append('set-cookie', cookie);
  return new Response(null, { status: 303, headers });
}
export function messageFor(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/not a member of this network/i.test(message))
    return 'This account does not have access to Silverstreak yet. Use your invitation to join.';
  if (
    !message ||
    /Network not found|X-Network-Id|frontend origin|fetch failed|Failed to fetch/i.test(
      message,
    )
  )
    return 'The shop is temporarily unavailable. Please try again shortly.';
  return message;
}
export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  );
export const dateLabel = (date: string, timezone: string) =>
  new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(date));

export async function oauthRequest(
  context: Context,
  path: string,
  body?: Record<string, unknown>,
) {
  const config = marketConfig();
  const url = new URL(
    `/networks/${encodeURIComponent(config.networkId)}/auth${path}`,
    config.origin,
  );
  return fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      origin: context.url.origin,
      cookie: context.request.headers.get('cookie') || '',
      'x-network-id': config.networkId,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
}
