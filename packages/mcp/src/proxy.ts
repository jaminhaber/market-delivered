// Server-side proxy for an app's fixed network. Request headers and query
// parameters cannot select another network or turn this into an admin proxy.
export async function proxyNetworkMcp(
  request: Request,
  publicUrl: URL,
  config: { origin: string; networkId: string },
) {
  const upstream = new URL(config.origin);
  if (
    upstream.origin === publicUrl.origin ||
    !['http:', 'https:'].includes(upstream.protocol) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      config.networkId,
    )
  )
    throw new Error('Invalid MCP backend origin');
  const metadata = '/.well-known/oauth-protected-resource/api/mcp';
  if (publicUrl.pathname !== '/api/mcp' && publicUrl.pathname !== metadata)
    return new Response(null, { status: 404 });
  upstream.pathname =
    `/networks/${encodeURIComponent(config.networkId)}` +
    (publicUrl.pathname === '/api/mcp' ? '/mcp' : metadata);
  const headers = new Headers();
  for (const name of [
    'authorization',
    'accept',
    'content-type',
    'origin',
    'access-control-request-method',
    'access-control-request-headers',
    'mcp-protocol-version',
    'mcp-session-id',
    'last-event-id',
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === 'POST' ? await request.text() : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const outgoing = new Headers({ 'Cache-Control': 'no-store' });
  for (const name of [
    'content-type',
    'www-authenticate',
    'allow',
    'vary',
    'access-control-allow-origin',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'access-control-expose-headers',
    'access-control-max-age',
    'mcp-session-id',
    'mcp-protocol-version',
  ]) {
    const value = response.headers.get(name);
    if (value) outgoing.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    headers: outgoing,
  });
}
