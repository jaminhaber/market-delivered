// Keep browser requests and session cookies on the frontend origin.
if (!process.env.API_ORIGIN)
  throw new Error('Set API_ORIGIN to the HTTPS origin of the API project');
const backend = new URL(process.env.API_ORIGIN);
if (
  backend.protocol !== 'https:' ||
  backend.username ||
  backend.password ||
  backend.pathname !== '/' ||
  backend.search ||
  backend.hash
)
  throw new Error('API_ORIGIN must be the HTTPS origin of the API project');

export const config = {
  framework: 'vite',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [
    { source: '/trpc/:path*', destination: `${backend.origin}/trpc/:path*` },
    {
      source: '/api/auth/:path*',
      destination: `${backend.origin}/api/auth/:path*`,
    },
  ],
  headers: [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    },
    ...['/trpc/:path*', '/api/auth/:path*'].map((source) => ({
      source,
      headers: [{ key: 'Cache-Control', value: 'no-store' }],
    })),
  ],
};
