import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.ADMIN_PORT ?? '5173'),
    strictPort: true,
    proxy: Object.fromEntries(
      [
        '/admin/trpc',
        '/admin/auth',
        '/mcp',
        '^/oauth/auth/',
        '^/networks/[0-9a-f-]+/oauth/auth/',
        '/.well-known/oauth-protected-resource/mcp',
        '/.well-known/oauth-authorization-server/oauth/auth',
        '^/\\.well-known/oauth-authorization-server/networks/',
      ].map((path) => [
        path,
        `http://127.0.0.1:${process.env.API_PORT ?? '3001'}`,
      ]),
    ),
  },
});
