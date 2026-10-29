import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.ADMIN_PORT ?? '5173'),
    strictPort: true,
    proxy: Object.fromEntries(
      ['/admin/trpc', '/admin/auth', '/admin/mcp'].map((path) => [
        path,
        `http://127.0.0.1:${process.env.API_PORT ?? '3001'}`,
      ]),
    ),
  },
});
