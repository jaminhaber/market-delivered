import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',
  server: { port: Number(process.env.SILVERSTREAK_PORT || 4321) },
  // Let API endpoints answer preflight requests with their own CORS policy.
  vite: { server: { cors: false } },
  adapter: vercel(),
});
