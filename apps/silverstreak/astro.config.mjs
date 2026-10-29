import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',
  server: { port: Number(process.env.SILVERSTREAK_PORT || 4321) },
  adapter: vercel(),
});
