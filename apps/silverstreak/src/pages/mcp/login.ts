import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ url }) => {
  const returnTo = '/mcp/authorize' + url.search;
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/account?reauth=1&returnTo=' + encodeURIComponent(returnTo),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'same-origin',
    },
  });
};
