import { next, rewrite } from '@vercel/functions';

// Keep dashboard cookies on its own domain; all authentication and business
// logic runs in the shared backend. The target is server configuration only.
export default function proxy(request: Request) {
  const url = new URL(request.url);
  if (
    !/^\/(?:mcp|oauth\/auth\/.+|admin\/(?:trpc(?:\/[^/]+)?|auth\/.+))$/.test(
      url.pathname,
    ) &&
    !/^\/networks\/[0-9a-f-]+\/oauth\/auth\/.+$/.test(url.pathname) &&
    !/^\/\.well-known\/oauth-authorization-server\/networks\/[0-9a-f-]+\/oauth\/auth$/.test(
      url.pathname,
    ) &&
    !/^\/\.well-known\/oauth-(?:protected-resource\/mcp|authorization-server\/oauth\/auth)$/.test(
      url.pathname,
    )
  )
    return next();
  try {
    const target = new URL(process.env.MARKET_API_ORIGIN || '');
    if (
      !['http:', 'https:'].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.pathname !== '/' ||
      target.search ||
      target.hash ||
      target.origin === url.origin ||
      (process.env.NODE_ENV === 'production' && target.protocol !== 'https:')
    )
      throw new Error('Invalid backend origin');
    target.pathname = url.pathname;
    target.search = url.search;
    return rewrite(target, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { error: 'The administrator dashboard is temporarily unavailable.' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
