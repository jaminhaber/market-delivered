import type { APIContext } from 'astro';
import { marketConfig } from './market';

// Only the storefront's API surface belongs on this origin. In particular,
// network management, platform administration, MCP, and jobs are not proxied.
const storefrontProcedures = new Set([
  'me',
  'produce.categories',
  'produce.list',
  'markets.list',
  'markets.runs',
  'markets.inventory',
  'invitation',
  'acceptInvitation',
  'profile.save',
  'orders.mine',
  'orders.place',
  'orders.cancel',
]);

const json = (message: string, status: number) =>
  Response.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );

export async function proxyMarketRequest({ request, url }: APIContext) {
  const isAuth = url.pathname.startsWith('/api/auth/');
  const procedures = url.pathname.slice('/trpc/'.length).split(',');
  if (!isAuth && !procedures.every((name) => storefrontProcedures.has(name)))
    return json('Not found', 404);

  // Keep the browser's actual origin: never turn an untrusted request into a
  // trusted one by rewriting Origin to the API host.
  const origin = request.headers.get('origin');
  if (
    (origin && origin !== url.origin) ||
    (request.method === 'POST' && !origin)
  )
    return json('Origin not allowed', 403);

  let upstream: URL;
  let networkId: string;
  try {
    const config = marketConfig();
    upstream = new URL(config.origin);
    networkId = config.networkId;
    if (upstream.origin === url.origin)
      throw new Error('Invalid upstream origin');
  } catch {
    return json('The shop is not available yet.', 503);
  }
  upstream.pathname = url.pathname;
  upstream.search = url.search;
  upstream.searchParams.delete('network');

  // Construct a new header set instead of forwarding host, forwarding headers,
  // or a caller-supplied network selector.
  const headers = new Headers({ 'x-network-id': networkId });
  for (const name of [
    'accept',
    'content-type',
    'cookie',
    'origin',
    'x-invite-token',
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? await request.text() : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    const outgoing = new Headers({ 'Cache-Control': 'no-store' });
    const contentType = response.headers.get('content-type');
    if (contentType) outgoing.set('content-type', contentType);
    // Preserve separate Set-Cookie headers. Better Auth uses host-only cookies,
    // so the browser stores them on Silverstreak's domain through this proxy.
    for (const cookie of response.headers.getSetCookie())
      outgoing.append('set-cookie', cookie);
    const location = response.headers.get('location');
    if (location) {
      const destination = new URL(location, upstream);
      if (destination.origin === upstream.origin) {
        destination.protocol = url.protocol;
        destination.host = url.host;
      }
      outgoing.set('location', destination.href);
    }
    return new Response(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    // Do not log URLs, headers, or bodies that may contain credentials/tokens.
    console.error('Market Delivered request failed');
    return json(
      'The shop is temporarily unavailable. Please try again shortly.',
      502,
    );
  }
}
